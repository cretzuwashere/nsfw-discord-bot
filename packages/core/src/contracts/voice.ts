import type { PlaybackStatus, TrackSummary } from '@botplatform/shared';
import type { Readable } from 'node:stream';

/**
 * A playable audio source produced by the audio resolver layer.
 * Adapter-agnostic: any adapter with voice support can consume it.
 */
export interface AudioStreamSource {
  /** Open the underlying stream. Called once per playback attempt. */
  createStream(): Promise<Readable>;
  /** 'arbitrary' means the adapter must transcode (ffmpeg) to its native format. */
  inputType: 'arbitrary' | 'ogg-opus' | 'webm-opus';
  metadata: TrackSummary;
}

export type PlaybackEvent =
  | { type: 'started' }
  | { type: 'finished' }
  | { type: 'error'; error: Error };

/**
 * A live voice connection in one guild, owned by a channel adapter.
 * The audio module drives this; it never touches adapter internals.
 */
export interface VoiceSession {
  readonly guildId: string;
  readonly channelId: string;
  readonly channelName: string | undefined;
  readonly status: PlaybackStatus;
  readonly destroyed: boolean;
  /**
   * Start playing a source. Resolves once playback has started (or rejects).
   * Events report lifecycle transitions; 'finished'/'error' fire exactly once
   * per play() call.
   */
  play(source: AudioStreamSource, onEvent: (event: PlaybackEvent) => void): Promise<void>;
  /** Returns false when there was nothing to pause. */
  pause(): boolean;
  /** Returns false when there was nothing paused. */
  resume(): boolean;
  /** Stop playback, keep the connection. */
  stop(): void;
  /** Leave the channel and free resources. */
  disconnect(): Promise<void>;
}

/**
 * Voice operations an adapter exposes to commands, scoped to the
 * guild + user of one command invocation.
 */
export interface VoiceCapability {
  /** Voice channel the invoking user is currently in, if any. */
  getUserVoiceChannel(): Promise<{ id: string; name: string } | null>;
  /** The bot's active voice session in this guild, if any. */
  getActiveSession(): VoiceSession | null;
  /** Join (or move to) the given channel and return the live session. */
  join(channelId: string): Promise<VoiceSession>;
}
