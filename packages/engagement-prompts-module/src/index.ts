import type {
  BotModule,
  ComponentInteractionEvent,
  GuildServiceProvider,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildPromptCommands } from './commands.js';
import { createPromptRepo } from './repo.js';
import { createPromptService, type PromptService } from './service.js';

export interface EngagementPromptsModuleOptions {
  logger: Logger;
  db: Db;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface EngagementPromptsModuleHandle {
  module: BotModule;
  service: PromptService;
  schedulerJob: ScheduledJob;
}

const TICK_MS = 5 * 60_000;

export function createEngagementPromptsModule(
  options: EngagementPromptsModuleOptions
): EngagementPromptsModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.engagementPrompts });
  const adapterKey = options.adapterKey ?? 'discord';
  const repo = createPromptRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createPromptService({
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    logger,
    adapterKey,
  });

  const module: BotModule = {
    key: MODULE_KEYS.engagementPrompts,
    name: 'Engagement Prompts',
    description:
      'Conversation starters: Question of the Day, Would You Rather, Truth or Dare and party games.',
    metadata: {
      requiredPermissions: ['SendMessages'],
      requiredIntents: ['Guilds'],
    },
    commands: buildPromptCommands({ service }),
    events: [
      {
        type: 'component.interaction',
        handle: (event) => service.handleInteraction(event as ComponentInteractionEvent),
      },
    ],
    onLoad() {
      logger.info('engagement-prompts module ready');
    },
  };

  const schedulerJob: ScheduledJob = {
    name: 'engagement-prompts.daily-qotd',
    intervalMs: TICK_MS,
    run: async () => {
      const posted = await service.deliverDailyQotd(new Date());
      if (posted > 0) logger.info({ posted }, 'posted daily QOTD');
    },
  };

  return { module, service, schedulerJob };
}

export { createPromptRepo } from './repo.js';
export type { PromptRepo, PromptSettingsRow } from './repo.js';
export { createPromptService } from './service.js';
export type { PromptService } from './service.js';
export * from './logic.js';
export * from './banks.js';
