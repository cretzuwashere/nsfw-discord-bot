import type {
  BotModule,
  ComponentInteractionEvent,
  GuildServiceProvider,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildGiveawayCommands } from './commands.js';
import { createGiveawayRepo } from './repo.js';
import { createGiveawayService, type GiveawayService } from './service.js';

export interface GiveawaysModuleOptions {
  logger: Logger;
  db: Db;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface GiveawaysModuleHandle {
  module: BotModule;
  service: GiveawayService;
  schedulerJob: ScheduledJob;
}

const TICK_MS = 30_000;

export function createGiveawaysModule(options: GiveawaysModuleOptions): GiveawaysModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.giveaways });
  const adapterKey = options.adapterKey ?? 'discord';
  const repo = createGiveawayRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createGiveawayService({
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    logger,
    adapterKey,
  });

  const module: BotModule = {
    key: MODULE_KEYS.giveaways,
    name: 'Giveaways',
    description: 'Run giveaways with a one-tap Enter button and an automatic scheduled draw.',
    metadata: {
      requiredPermissions: ['SendMessages', 'EmbedLinks'],
      requiredIntents: ['Guilds'],
      auditEvents: [],
    },
    commands: buildGiveawayCommands({ service }),
    events: [
      {
        type: 'component.interaction',
        handle: (event) => service.enter(event as ComponentInteractionEvent),
      },
    ],
    onLoad() {
      logger.info('giveaways module ready');
    },
  };

  const schedulerJob: ScheduledJob = {
    name: 'giveaways.draw-due',
    intervalMs: TICK_MS,
    run: async () => {
      const drawn = await service.drawDue(new Date());
      if (drawn > 0) logger.info({ drawn }, 'drew due giveaways');
    },
  };

  return { module, service, schedulerJob };
}

export { createGiveawayRepo } from './repo.js';
export type { GiveawayRepo, GiveawayRow } from './repo.js';
export { createGiveawayService } from './service.js';
export type { GiveawayService } from './service.js';
export * from './logic.js';
