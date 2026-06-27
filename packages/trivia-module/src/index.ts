import type {
  BotModule,
  ComponentInteractionEvent,
  GuildServiceProvider,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildTriviaCommands } from './commands.js';
import { createTriviaRepo } from './repo.js';
import { createTriviaService, type TriviaService } from './service.js';

export interface TriviaModuleOptions {
  logger: Logger;
  db: Db;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface TriviaModuleHandle {
  module: BotModule;
  service: TriviaService;
  schedulerJobs: ScheduledJob[];
}

const RESOLVE_TICK_MS = 30_000;
const AUTO_TICK_MS = 60_000;

export function createTriviaModule(options: TriviaModuleOptions): TriviaModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.trivia });
  const adapterKey = options.adapterKey ?? 'discord';
  const repo = createTriviaRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createTriviaService({
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    logger,
    adapterKey,
  });

  const module: BotModule = {
    key: MODULE_KEYS.trivia,
    name: 'Trivia',
    description: 'Channel trivia rounds with button answers, a bundled question bank and a win leaderboard.',
    metadata: {
      requiredPermissions: ['SendMessages', 'EmbedLinks'],
      requiredIntents: ['Guilds'],
    },
    commands: buildTriviaCommands({ service }),
    events: [
      {
        type: 'component.interaction',
        handle: (event) => service.handleAnswer(event as ComponentInteractionEvent),
      },
    ],
    onLoad() {
      logger.info('trivia module ready');
    },
  };

  const resolveJob: ScheduledJob = {
    name: 'trivia.resolve-expired',
    intervalMs: RESOLVE_TICK_MS,
    run: async () => {
      const resolved = await service.resolveExpired(new Date());
      if (resolved > 0) logger.info({ resolved }, 'resolved expired trivia rounds');
    },
  };

  const autoJob: ScheduledJob = {
    name: 'trivia.auto',
    intervalMs: AUTO_TICK_MS,
    run: async () => {
      const started = await service.runAutoTrivia(new Date());
      if (started > 0) logger.info({ started }, 'started auto-trivia rounds');
    },
  };

  return { module, service, schedulerJobs: [resolveJob, autoJob] };
}

export { createTriviaRepo } from './repo.js';
export type { TriviaRepo } from './repo.js';
export { createTriviaService } from './service.js';
export type { TriviaService } from './service.js';
export * from './logic.js';
export * from './bank.js';
