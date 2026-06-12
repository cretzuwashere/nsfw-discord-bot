import type { AudioStreamSource, PlaybackEvent, VoiceSession } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import type { PlaybackStatus } from '@botplatform/shared';
import { UserFacingError } from '@botplatform/shared';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioPlayer,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from '@discordjs/voice';
import type { Readable } from 'node:stream';

export interface CreateVoiceSessionOptions {
  guildId: string;
  channelId: string;
  channelName: string | undefined;
  adapterCreator: DiscordGatewayAdapterCreator;
  logger: Logger;
  /** Called once when the session dies (adapter removes it from its map). */
  onDestroyed?: () => void;
}

export async function createDiscordVoiceSession(
  options: CreateVoiceSessionOptions
): Promise<DiscordVoiceSession> {
  const connection = joinVoiceChannel({
    channelId: options.channelId,
    guildId: options.guildId,
    adapterCreator: options.adapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    connection.destroy();
    throw new UserFacingError('VOICE_UNAVAILABLE', 'I could not connect to the voice channel.', {
      cause: error,
    });
  }

  return new DiscordVoiceSession(options, connection);
}

/**
 * VoiceSession backed by @discordjs/voice.
 *
 * Event contract (relied on by the audio engine): per play() call,
 * 'started' fires once after the player reaches Playing, then EXACTLY ONE of
 * 'finished' | 'error' fires later. Startup failures reject play() and emit
 * nothing.
 */
export class DiscordVoiceSession implements VoiceSession {
  readonly guildId: string;
  readonly channelId: string;
  readonly channelName: string | undefined;

  private readonly player: AudioPlayer;
  private readonly logger: Logger;
  private readonly onDestroyedCallback: (() => void) | undefined;

  private _destroyed = false;
  /** True when no play() callback is armed (nothing to notify). */
  private settled = true;
  private emitEvent: ((event: PlaybackEvent) => void) | null = null;
  private currentStream: Readable | null = null;

  constructor(options: CreateVoiceSessionOptions, private readonly connection: VoiceConnection) {
    this.guildId = options.guildId;
    this.channelId = options.channelId;
    this.channelName = options.channelName;
    this.logger = options.logger;
    this.onDestroyedCallback = options.onDestroyed;

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.connection.subscribe(this.player);

    this.player.on('stateChange', (oldState, newState) => {
      if (
        newState.status === AudioPlayerStatus.Idle &&
        oldState.status !== AudioPlayerStatus.Idle
      ) {
        this.finishCurrent({ type: 'finished' });
      }
    });
    this.player.on('error', (error) => {
      // The error is followed by an Idle transition; finishCurrent settles
      // first here so the duplicate 'finished' is ignored.
      this.finishCurrent({ type: 'error', error });
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      void this.handleDisconnected();
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.handleDestroyed();
    });
    this.connection.on('error', (error) => {
      this.logger.warn({ err: error, guildId: this.guildId }, 'voice connection error');
    });
  }

  get status(): PlaybackStatus {
    if (this._destroyed) return 'idle';
    switch (this.player.state.status) {
      case AudioPlayerStatus.Playing:
        return 'playing';
      case AudioPlayerStatus.Paused:
      case AudioPlayerStatus.AutoPaused:
        return 'paused';
      case AudioPlayerStatus.Buffering:
        return 'buffering';
      default:
        return 'idle';
    }
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  async play(source: AudioStreamSource, onEvent: (event: PlaybackEvent) => void): Promise<void> {
    if (this._destroyed) {
      throw new UserFacingError('VOICE_UNAVAILABLE', "I'm not connected to a voice channel.");
    }

    let stream: Readable;
    try {
      stream = await source.createStream();
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      throw new UserFacingError('AUDIO_PLAYBACK_FAILED', 'That audio could not be played.', {
        cause: error,
      });
    }

    this.cleanupStream();
    this.currentStream = stream;
    // The resource pipeline reports errors via the player; this guard only
    // prevents an unhandled 'error' crash from the raw source stream.
    stream.on('error', (error) => {
      this.logger.debug({ err: error, guildId: this.guildId }, 'source stream error');
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary, // ffmpeg transcodes whatever arrives
      metadata: source.metadata,
    });
    this.player.play(resource);

    try {
      await entersState(this.player, AudioPlayerStatus.Playing, 15_000);
    } catch (error) {
      this.cleanupStream();
      this.player.stop(true); // settled is still true — no event escapes
      throw new UserFacingError('AUDIO_PLAYBACK_FAILED', 'That audio could not be started.', {
        cause: error,
      });
    }

    // Arm event delivery only after a successful start (sync block — no
    // player event can interleave here).
    this.settled = false;
    this.emitEvent = onEvent;
    onEvent({ type: 'started' });
  }

  pause(): boolean {
    if (this.player.state.status !== AudioPlayerStatus.Playing) return false;
    return this.player.pause(true);
  }

  resume(): boolean {
    const status = this.player.state.status;
    if (status !== AudioPlayerStatus.Paused && status !== AudioPlayerStatus.AutoPaused) {
      return false;
    }
    return this.player.unpause();
  }

  stop(): void {
    this.player.stop(true);
  }

  async disconnect(): Promise<void> {
    if (this._destroyed) return;
    try {
      this.connection.destroy(); // fires Destroyed → handleDestroyed()
    } catch (error) {
      this.logger.debug({ err: error }, 'voice connection destroy failed');
      this.handleDestroyed();
    }
  }

  // -------------------------------------------------------------------------

  /** Deliver the terminal event for the current play() exactly once. */
  private finishCurrent(event: PlaybackEvent): void {
    if (this.settled) return;
    this.settled = true;
    const emit = this.emitEvent;
    this.emitEvent = null;
    this.cleanupStream();
    emit?.(event);
  }

  private cleanupStream(): void {
    if (this.currentStream && !this.currentStream.destroyed) {
      this.currentStream.destroy();
    }
    this.currentStream = null;
  }

  /** Standard @discordjs/voice pattern: brief grace period for reconnects. */
  private async handleDisconnected(): Promise<void> {
    if (this._destroyed) return;
    try {
      await Promise.race([
        entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Reconnecting (e.g. moved between channels) — keep the session alive.
    } catch {
      this.logger.info({ guildId: this.guildId }, 'voice connection lost');
      try {
        this.connection.destroy();
      } catch {
        this.handleDestroyed();
      }
    }
  }

  private handleDestroyed(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    // Settle BEFORE stopping the player — stop() emits an Idle transition
    // that would otherwise be delivered as a misleading 'finished'.
    this.finishCurrent({ type: 'error', error: new Error('voice connection closed') });
    this.player.stop(true);
    this.onDestroyedCallback?.();
  }
}
