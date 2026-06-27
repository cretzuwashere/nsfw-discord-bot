import type {
  BotModule,
  ComponentInteractionEvent,
  GuildServiceProvider,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildMinigameCommands } from './commands.js';
import { createMinigameRepo } from './repo.js';
import { createMinigamesService, type MinigamesService } from './service.js';

export interface MinigamesModuleOptions {
  logger: Logger;
  db: Db;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface MinigamesModuleHandle {
  module: BotModule;
  service: MinigamesService;
  schedulerJob: ScheduledJob;
}

const EXPIRE_TICK_MS = 60_000;

export function createMinigamesModule(options: MinigamesModuleOptions): MinigamesModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.minigames });
  const adapterKey = options.adapterKey ?? 'discord';
  const repo = createMinigameRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createMinigamesService({
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    logger,
    adapterKey,
  });

  const module: BotModule = {
    key: MODULE_KEYS.minigames,
    name: 'Mini-games',
    description: 'Head-to-head Tic-Tac-Toe and Connect Four played with buttons.',
    metadata: {
      requiredPermissions: ['SendMessages'],
      requiredIntents: ['Guilds'],
    },
    commands: buildMinigameCommands({ service }),
    events: [
      {
        type: 'component.interaction',
        handle: (event) => service.handleInteraction(event as ComponentInteractionEvent),
      },
    ],
    onLoad() {
      logger.info('minigames module ready');
    },
  };

  const schedulerJob: ScheduledJob = {
    name: 'minigames.expire-stale',
    intervalMs: EXPIRE_TICK_MS,
    run: async () => {
      const expired = await service.expireStale(new Date());
      if (expired > 0) logger.info({ expired }, 'expired stale minigames');
    },
  };

  return { module, service, schedulerJob };
}

export { createMinigameRepo } from './repo.js';
export type { MinigameRepo, MinigameRow } from './repo.js';
export { createMinigamesService } from './service.js';
export type { MinigamesService } from './service.js';
export * from './ttt.js';
export * from './connect4.js';
