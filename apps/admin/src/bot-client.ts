import type { AppConfig } from '@botplatform/config';
import type { Logger } from '@botplatform/logger';
import {
  INTERNAL_API_PATHS,
  INTERNAL_TOKEN_HEADER,
  type InternalActionResult,
  type InternalBotStatus,
} from '@botplatform/shared';

export type AudioAdminAction = 'skip' | 'stop' | 'clear-queue';

/**
 * Client for the bot worker's internal API (Docker network only).
 * NEVER throws — the admin panel must render an honest "bot offline" state
 * instead of error pages when the worker is down.
 */
export interface BotStatusClient {
  getStatus(): Promise<InternalBotStatus | null>;
  audioAction(guildId: string, action: AudioAdminAction): Promise<InternalActionResult>;
}

const REQUEST_TIMEOUT_MS = 3_000;

export function createBotClient(config: AppConfig, logger: Logger): BotStatusClient {
  const base = config.bot.internalUrl.replace(/\/+$/, '');
  const headers = { [INTERNAL_TOKEN_HEADER]: config.bot.internalApiToken };

  return {
    async getStatus(): Promise<InternalBotStatus | null> {
      try {
        const response = await fetch(`${base}${INTERNAL_API_PATHS.status}`, {
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          logger.debug({ status: response.status }, 'bot status request rejected');
          return null;
        }
        return (await response.json()) as InternalBotStatus;
      } catch (error) {
        logger.debug({ err: error }, 'bot worker unreachable');
        return null;
      }
    },

    async audioAction(guildId: string, action: AudioAdminAction): Promise<InternalActionResult> {
      const path =
        action === 'skip'
          ? INTERNAL_API_PATHS.audioSkip(guildId)
          : action === 'stop'
            ? INTERNAL_API_PATHS.audioStop(guildId)
            : INTERNAL_API_PATHS.audioClearQueue(guildId);
      try {
        const response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          return { ok: false, message: 'The bot rejected the request.' };
        }
        return (await response.json()) as InternalActionResult;
      } catch {
        return { ok: false, message: 'The bot is not reachable right now.' };
      }
    },
  };
}
