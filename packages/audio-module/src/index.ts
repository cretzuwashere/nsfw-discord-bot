import type { AppConfig } from '@botplatform/config';
import type { BotModule } from '@botplatform/core';
import type { PlaybackRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { InternalActionResult, QueueSnapshot } from '@botplatform/shared';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildAudioCommands } from './commands.js';
import { PlayerManager } from './engine/manager.js';
import { DirectHttpAudioProvider } from './resolver/providers/direct-http.js';
import { AudioResolver } from './resolver/resolver.js';

export interface AudioModuleOptions {
  config: AppConfig;
  logger: Logger;
  /** Null disables persistence (history/queue mirror) — test convenience. */
  playback: PlaybackRepo | null;
}

export interface AudioModuleHandle {
  module: BotModule;
  getSnapshots(): QueueSnapshot[];
  skip(guildExternalId: string): Promise<InternalActionResult>;
  stop(guildExternalId: string): Promise<InternalActionResult>;
  clearQueue(guildExternalId: string): Promise<InternalActionResult>;
}

export function createAudioModule(options: AudioModuleOptions): AudioModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.audioPlayer });
  const resolver = new AudioResolver([new DirectHttpAudioProvider()]);
  const manager = new PlayerManager(
    {
      maxQueueSize: options.config.audio.maxQueueSize,
      maxTrackDurationSeconds: options.config.audio.maxTrackDurationSeconds,
    },
    options.playback,
    logger
  );

  const module: BotModule = {
    key: MODULE_KEYS.audioPlayer,
    name: 'Audio Player',
    description: 'Voice channel audio playback with queue management.',
    commands: buildAudioCommands({
      manager,
      resolver,
      resolveCtx: {
        allowedDomains: options.config.audio.allowedDomains,
        timeoutMs: options.config.audio.requestTimeoutMs,
        logger,
      },
    }),
    onLoad(ctx) {
      ctx.logger.info(
        {
          maxQueueSize: options.config.audio.maxQueueSize,
          maxTrackDurationSeconds: options.config.audio.maxTrackDurationSeconds,
          allowedDomains: options.config.audio.allowedDomains.length || 'any public domain',
        },
        'audio player ready'
      );
    },
    async onShutdown() {
      await manager.destroyAll();
    },
  };

  return {
    module,
    getSnapshots: () => manager.getSnapshots(),
    skip: (guildExternalId) => manager.skip(guildExternalId),
    stop: (guildExternalId) => manager.stop(guildExternalId),
    clearQueue: (guildExternalId) => manager.clearQueue(guildExternalId),
  };
}

export { PlaybackQueue } from './engine/queue.js';
export { GuildPlaybackSession } from './engine/session.js';
export { PlayerManager } from './engine/manager.js';
export { AudioResolver } from './resolver/resolver.js';
export { DirectHttpAudioProvider } from './resolver/providers/direct-http.js';
export type { AudioProvider, ResolveContext, ResolvedTrack } from './resolver/types.js';
