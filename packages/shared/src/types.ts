/** Well-known module keys. New modules add their key here. */
export const MODULE_KEYS = {
  audioPlayer: 'audio-player',
  moderation: 'moderation',
  announcements: 'announcements',
  welcome: 'welcome',
  dynamicCards: 'dynamic-cards',
  roleMenus: 'role-menus',
  birthdays: 'birthdays',
  reminders: 'reminders',
  scheduledMessages: 'scheduled-messages',
  automod: 'automod',
  customCommands: 'custom-commands',
  raiseHand: 'raise-hand',
  funCommands: 'fun-commands',
  engagementPrompts: 'engagement-prompts',
  giveaways: 'giveaways',
  serverStats: 'server-stats',
  trivia: 'trivia',
  minigames: 'minigames',
  economy: 'economy',
  levels: 'levels',
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
  /** Seconds elapsed in the current track (pause-aware), when playing. */
  elapsedSeconds?: number | undefined;
}

export type AdapterConnectionState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';
