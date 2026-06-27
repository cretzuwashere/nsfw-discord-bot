import type {
  BotModule,
  ComponentInteractionEvent,
  GuildServiceProvider,
  MessageCreateEvent,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildLevelsCommands } from './commands.js';
import { createLevelsRepo } from './repo.js';
import { createLevelsService, type LevelsService } from './service.js';

export interface LevelsModuleOptions {
  logger: Logger;
  db: Db;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface LevelsModuleHandle {
  module: BotModule;
  service: LevelsService;
}

export function createLevelsModule(options: LevelsModuleOptions): LevelsModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.levels });
  const adapterKey = options.adapterKey ?? 'discord';
  const repo = createLevelsRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createLevelsService({
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    logger,
    adapterKey,
  });

  const module: BotModule = {
    key: MODULE_KEYS.levels,
    name: 'Levels',
    description: 'Earn XP from chatting, level up (with optional reward roles) and compete on a leaderboard.',
    metadata: {
      requiredPermissions: ['SendMessages', 'ManageRoles'],
      requiredIntents: ['Guilds'],
    },
    commands: buildLevelsCommands({ service }),
    events: [
      {
        type: 'message.create',
        handle: (event) => service.handleMessage(event as MessageCreateEvent),
      },
      {
        type: 'component.interaction',
        handle: (event) => service.handleInteraction(event as ComponentInteractionEvent),
      },
    ],
    onLoad() {
      logger.info('levels module ready');
    },
  };

  return { module, service };
}

export { createLevelsRepo } from './repo.js';
export type { LevelsRepo } from './repo.js';
export { createLevelsService } from './service.js';
export type { LevelsService } from './service.js';
export * from './logic.js';
