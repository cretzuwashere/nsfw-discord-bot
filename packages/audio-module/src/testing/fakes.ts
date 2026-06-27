import type {
  AudioStreamSource,
  PlaybackEvent,
  VoiceCapability,
  VoiceSession,
} from '@botplatform/core';
import type { PlaybackRepo } from '@botplatform/database';
import type { PlaybackStatus } from '@botplatform/shared';
import { Readable } from 'node:stream';
import type { ResolvedTrack } from '../resolver/types.js';
import type { FlatPlaylist, YtDlpRunner } from '../resolver/ytdlp-runner.js';

/** Controllable VoiceSession double mirroring the Discord adapter's behavior. */
export class FakeVoiceSession implements VoiceSession {
  status: PlaybackStatus = 'idle';
  destroyed = false;
  playCalls: AudioStreamSource[] = [];
  playShouldFail = 0; // fail the next N play() calls
  private onEvent: ((event: PlaybackEvent) => void) | null = null;

  constructor(
    readonly guildId = 'guild-1',
    readonly channelId = 'chan-1',
    readonly channelName: string | undefined = 'general'
  ) {}

  async play(source: AudioStreamSource, onEvent: (event: PlaybackEvent) => void): Promise<void> {
    if (this.playShouldFail > 0) {
      this.playShouldFail--;
      throw new Error('stream open failed');
    }
    this.playCalls.push(source);
    this.onEvent = onEvent;
    this.status = 'playing';
    onEvent({ type: 'started' });
  }

  /** Simulate natural end of track (Discord emits Idle). */
  emitFinished(): void {
    this.status = 'idle';
    this.onEvent?.({ type: 'finished' });
  }

  emitError(error: Error): void {
    this.status = 'idle';
    this.onEvent?.({ type: 'error', error });
  }

  pause(): boolean {
    if (this.status !== 'playing') return false;
    this.status = 'paused';
    return true;
  }

  resume(): boolean {
    if (this.status !== 'paused') return false;
    this.status = 'playing';
    return true;
  }

  /** Like the real adapter, stopping surfaces a 'finished' event. */
  stop(): void {
    if (this.status === 'idle') return;
    this.status = 'idle';
    this.onEvent?.({ type: 'finished' });
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.status = 'idle';
  }
}

export class FakeVoiceCapability implements VoiceCapability {
  userChannel: { id: string; name: string } | null = { id: 'chan-1', name: 'general' };
  activeSession: FakeVoiceSession | null = null;
  joinCalls: string[] = [];

  async getUserVoiceChannel(): Promise<{ id: string; name: string } | null> {
    return this.userChannel;
  }

  getActiveSession(): VoiceSession | null {
    return this.activeSession;
  }

  async join(channelId: string): Promise<VoiceSession> {
    this.joinCalls.push(channelId);
    this.activeSession = new FakeVoiceSession('guild-1', channelId, 'general');
    return this.activeSession;
  }
}

/**
 * In-memory YtDlpRunner double. Configure `jsonResult`/`flatPlaylistResult`
 * (or the `*ShouldFail` flags) per test; `streamCalls` records every stream
 * invocation so the lazy-open contract can be asserted.
 */
export class FakeYtDlpRunner implements YtDlpRunner {
  jsonResult: unknown = {};
  flatPlaylistResult: FlatPlaylist = { entries: [] };
  isAvailable = true;
  jsonShouldFail = false;
  flatPlaylistShouldFail = false;
  readonly streamCalls: string[][] = [];

  async json(): Promise<unknown> {
    if (this.jsonShouldFail) throw new Error('yt-dlp json failed');
    return this.jsonResult;
  }

  async flatPlaylist(): Promise<FlatPlaylist> {
    if (this.flatPlaylistShouldFail) throw new Error('yt-dlp playlist failed');
    return this.flatPlaylistResult;
  }

  stream(args: string[]): Readable {
    this.streamCalls.push(args);
    return Readable.from([Buffer.from('audio')]);
  }

  async available(): Promise<boolean> {
    return this.isAvailable;
  }
}

export function fakeTrack(title: string): ResolvedTrack {
  const metadata = { title, url: `https://example.com/${title}.mp3`, provider: 'direct-http' };
  return {
    metadata,
    source: {
      inputType: 'arbitrary',
      metadata,
      createStream: async () => Readable.from([Buffer.from('x')]),
    },
  };
}

export interface RecordedHistory {
  id: number;
  track: string;
  status: string;
  errorMessage?: string | undefined;
}

/** In-memory PlaybackRepo double; set `throwing` to simulate a dead database. */
export function fakePlaybackRepo(options: { throwing?: boolean } = {}) {
  let nextId = 1;
  const history: RecordedHistory[] = [];
  const queues = new Map<string, unknown[]>();
  const boom = () => {
    if (options.throwing) throw new Error('db down');
  };

  const repo = {
    history,
    queues,
    async startHistoryEntry(input: { guildExternalId: string; track: { title: string } }) {
      boom();
      const id = nextId++;
      history.push({ id, track: input.track.title, status: 'playing' });
      return id;
    },
    async finishHistoryEntry(id: number, status: string, errorMessage?: string) {
      boom();
      const entry = history.find((row) => row.id === id);
      if (entry) {
        entry.status = status;
        entry.errorMessage = errorMessage;
      }
    },
    async listRecentHistory() {
      boom();
      return [];
    },
    async listRecentErrors() {
      boom();
      return [];
    },
    async replaceQueue(guildExternalId: string, tracks: unknown[]) {
      boom();
      queues.set(guildExternalId, tracks);
    },
    async getQueue() {
      boom();
      return [];
    },
    async clearQueue(guildExternalId: string) {
      boom();
      queues.delete(guildExternalId);
    },
  };
  return repo as unknown as PlaybackRepo & typeof repo;
}
