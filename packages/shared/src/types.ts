/** Well-known module keys. New modules add their key here. */
export const MODULE_KEYS = {
  audioPlayer: 'audio-player',
  moderation: 'moderation',
} as const;
export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

/** Well-known channel adapter keys. */
export const ADAPTER_KEYS = {
  discord: 'discord',
} as const;
export type AdapterKey = (typeof ADAPTER_KEYS)[keyof typeof ADAPTER_KEYS];

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'buffering';

/** Minimal track info safe to render anywhere (no internal details). */
export interface TrackSummary {
  title: string;
  url: string;
  provider: string;
  durationSeconds?: number | undefined;
  requestedBy?: string | undefined;
}

export interface QueueSnapshot {
  guildId: string;
  channelName?: string | undefined;
  status: PlaybackStatus;
  nowPlaying: TrackSummary | null;
  queue: TrackSummary[];
  maxQueueSize: number;
}

export type AdapterConnectionState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';
