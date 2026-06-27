import type {
  BotModule,
  GuildServiceProvider,
  MessageCreateEvent,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildServerStatsCommands } from './commands.js';
import { ActivityAccumulator, ymdUtc } from './logic.js';
import { createServerStatsRepo } from './repo.js';
import { createServerStatsService, type ServerStatsService } from './service.js';

export interface ServerStatsModuleOptions {
  logger: Logger;
  db: Db;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface ServerStatsModuleHandle {
  module: BotModule;
  service: ServerStatsService;
  schedulerJobs: ScheduledJob[];
}

const FLUSH_MS = 60_000;
const RECAP_TICK_MS = 5 * 60_000;

export function createServerStatsModule(options: ServerStatsModuleOptions): ServerStatsModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.serverStats });
  const adapterKey = options.adapterKey ?? 'discord';
  const accumulator = new ActivityAccumulator();
  const repo = createServerStatsRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createServerStatsService({
    accumulator,
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    logger,
    adapterKey,
  });

  const module: BotModule = {
    key: MODULE_KEYS.serverStats,
    name: 'Server Stats',
    description: 'Message-activity stats and a weekly highlights recap (counts only, no message content).',
    metadata: {
      requiredPermissions: ['SendMessages', 'EmbedLinks'],
      requiredIntents: ['Guilds'],
    },
    commands: buildServerStatsCommands({ service }),
    events: [
      {
        type: 'message.create',
        handle: (event) => {
          const e = event as MessageCreateEvent;
          if (e.author.bot || !e.guild) return;
          accumulator.record(e.guild.externalId, e.author.externalId, e.channelId);
        },
      },
    ],
    onLoad() {
      logger.info('server-stats module ready');
    },
  };

  const flushJob: ScheduledJob = {
    name: 'server-stats.flush',
    intervalMs: FLUSH_MS,
    run: async () => {
      if (accumulator.size === 0) return;
      const writes = await service.flush(ymdUtc(new Date()));
      if (writes > 0) logger.debug({ writes }, 'flushed activity counts');
    },
  };

  const recapJob: ScheduledJob = {
    name: 'server-stats.weekly-recap',
    intervalMs: RECAP_TICK_MS,
    run: async () => {
      const posted = await service.deliverWeeklyRecaps(new Date());
      if (posted > 0) logger.info({ posted }, 'posted weekly recaps');
    },
  };

  return { module, service, schedulerJobs: [flushJob, recapJob] };
}

export { createServerStatsRepo } from './repo.js';
export type { ServerStatsRepo } from './repo.js';
export { createServerStatsService } from './service.js';
export type { ServerStatsService } from './service.js';
export * from './logic.js';
