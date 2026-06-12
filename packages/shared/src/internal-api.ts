import type { AdapterConnectionState, QueueSnapshot } from './types.js';

/**
 * Contract for the bot worker's internal HTTP API.
 * Reachable only on the Docker network; authenticated with the
 * INTERNAL_API_TOKEN shared secret sent in the `x-internal-token` header.
 */

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

export const INTERNAL_API_PATHS = {
  health: '/healthz',
  status: '/internal/status',
  audioSkip: (guildId: string) => `/internal/audio/${guildId}/skip`,
  audioStop: (guildId: string) => `/internal/audio/${guildId}/stop`,
  audioClearQueue: (guildId: string) => `/internal/audio/${guildId}/clear-queue`,
} as const;

export interface InternalAdapterStatus {
  key: string;
  state: AdapterConnectionState;
  detail?: string | undefined;
  /** Bot username when connected. Never includes tokens or secrets. */
  identity?: string | undefined;
  guildCount?: number | undefined;
}

export interface InternalModuleStatus {
  key: string;
  name: string;
  enabled: boolean;
}

export interface InternalBotStatus {
  startedAt: string;
  uptimeSeconds: number;
  version: string;
  environment: string;
  adapters: InternalAdapterStatus[];
  modules: InternalModuleStatus[];
  audio: {
    sessions: QueueSnapshot[];
  };
}

export interface InternalActionResult {
  ok: boolean;
  message: string;
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  checks: Record<string, { status: 'ok' | 'error'; detail?: string | undefined }>;
}
