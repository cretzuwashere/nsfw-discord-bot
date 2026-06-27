import type { BotModule, ComponentInteractionEvent, GuildServiceProvider } from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildEconomyCommands } from './commands.js';
import { createEconomyRepo } from './repo.js';
import { createEconomyService, type EconomyService } from './service.js';

export interface EconomyModuleOptions {
  logger: Logger;
  db: Db;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface EconomyModuleHandle {
  module: BotModule;
  service: EconomyService;
}

export function createEconomyModule(options: EconomyModuleOptions): EconomyModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.economy });
  const adapterKey = options.adapterKey ?? 'discord';
  const repo = createEconomyRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createEconomyService({
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    logger,
    adapterKey,
  });

  const module: BotModule = {
    key: MODULE_KEYS.economy,
    name: 'Economy',
    description: 'Virtual currency: balances, daily/streak rewards, member transfers and a role shop.',
    metadata: {
      requiredPermissions: ['SendMessages', 'ManageRoles'],
      requiredIntents: ['Guilds'],
    },
    commands: buildEconomyCommands({ service }),
    events: [
      {
        type: 'component.interaction',
        handle: (event) => service.handleInteraction(event as ComponentInteractionEvent),
      },
    ],
    onLoad() {
      logger.info('economy module ready');
    },
  };

  return { module, service };
}

export { createEconomyRepo } from './repo.js';
export type { EconomyRepo } from './repo.js';
export { createEconomyService } from './service.js';
export type { EconomyService } from './service.js';
export * from './logic.js';
