import { createAnnouncementsModule } from '@botplatform/announcements-module';
import { createAudioModule } from '@botplatform/audio-module';
import { createAutomodModule } from '@botplatform/automod-module';
import { createBirthdaysModule } from '@botplatform/birthdays-module';
import { createCardsModule } from '@botplatform/cards-module';
import { createCustomCommandsModule } from '@botplatform/custom-commands-module';
import { createEconomyModule } from '@botplatform/economy-module';
import { createEngagementPromptsModule } from '@botplatform/engagement-prompts-module';
import { createFunCommandsModule } from '@botplatform/fun-commands-module';
import { createGiveawaysModule } from '@botplatform/giveaways-module';
import { createLevelsModule } from '@botplatform/levels-module';
import { createMinigamesModule } from '@botplatform/minigames-module';
import { createRaiseHandModule } from '@botplatform/raise-hand-module';
import { createRemindersModule } from '@botplatform/reminders-module';
import { createRoleMenusModule } from '@botplatform/role-menus-module';
import { createScheduledMessagesModule } from '@botplatform/scheduled-messages-module';
import { createServerStatsModule } from '@botplatform/server-stats-module';
import { createTriviaModule } from '@botplatform/trivia-module';
import { createWelcomeModule } from '@botplatform/welcome-module';
import { loadConfig } from '@botplatform/config';
import { BotKernel, CachedModuleState } from '@botplatform/core';
import {
  createDatabase,
  createDbAuditLog,
  createDbHealthIndicator,
  createDbModuleState,
  createGuildsRepo,
  createPlaybackRepo,
} from '@botplatform/database';
import { DiscordAdapter } from '@botplatform/discord-adapter';
import { createLogger } from '@botplatform/logger';
import { createModerationModule } from '@botplatform/moderation-module';
import { ADAPTER_KEYS } from '@botplatform/shared';
import { buildInternalApi } from './internal-api.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    name: 'bot',
    level: config.logLevel,
    pretty: config.nodeEnv === 'development',
  });

  const database = createDatabase(config.database.url);
  const audit = createDbAuditLog(database.db, logger);
  const moduleState = new CachedModuleState(createDbModuleState(database.db), logger);
  const guildsRepo = createGuildsRepo(database.db);

  const adapter = new DiscordAdapter();

  const audioHandle = createAudioModule({
    config,
    logger,
    playback: createPlaybackRepo(database.db),
  });
  const moderationHandle = createModerationModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  // The adapter implements GuildServiceProvider — community modules send
  // messages and manage roles through it.
  const announcementsHandle = createAnnouncementsModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  const cardsHandle = createCardsModule({ config, logger, db: database.db });
  const welcomeHandle = createWelcomeModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
    // Bridge cards → welcome: render a template to a PNG by id.
    renderCard: (templateId, data) => cardsHandle.service.renderById(templateId, data),
  });
  const roleMenusHandle = createRoleMenusModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  const raiseHandHandle = createRaiseHandModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  const scheduledMessagesHandle = createScheduledMessagesModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  const customCommandsHandle = createCustomCommandsModule({ config, logger, db: database.db, audit });
  const funCommandsHandle = createFunCommandsModule({ logger });
  const engagementPromptsHandle = createEngagementPromptsModule({
    logger,
    db: database.db,
    guildServiceProvider: adapter,
  });
  const giveawaysHandle = createGiveawaysModule({
    logger,
    db: database.db,
    guildServiceProvider: adapter,
  });
  const serverStatsHandle = createServerStatsModule({
    logger,
    db: database.db,
    guildServiceProvider: adapter,
  });
  const triviaHandle = createTriviaModule({
    logger,
    db: database.db,
    guildServiceProvider: adapter,
  });
  const minigamesHandle = createMinigamesModule({
    logger,
    db: database.db,
    guildServiceProvider: adapter,
  });
  const economyHandle = createEconomyModule({
    logger,
    db: database.db,
    guildServiceProvider: adapter,
  });
  const levelsHandle = createLevelsModule({
    logger,
    db: database.db,
    guildServiceProvider: adapter,
  });
  const remindersHandle = createRemindersModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  const birthdaysHandle = createBirthdaysModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  const automodHandle = createAutomodModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: adapter,
  });
  adapter.onGuildSeen = (externalId, name) => {
    void guildsRepo
      .upsertByExternalId({ adapterKey: ADAPTER_KEYS.discord, externalId, name })
      .catch((error) => logger.warn({ err: error }, 'guild upsert failed'));
  };

  let closeApi: (() => Promise<void>) | null = null;

  const kernel = new BotKernel({
    config,
    logger,
    modules: [
      audioHandle.module,
      moderationHandle.module,
      announcementsHandle.module,
      cardsHandle.module,
      welcomeHandle.module,
      roleMenusHandle.module,
      raiseHandHandle.module,
      scheduledMessagesHandle.module,
      customCommandsHandle.module,
      remindersHandle.module,
      birthdaysHandle.module,
      automodHandle.module,
      funCommandsHandle.module,
      engagementPromptsHandle.module,
      giveawaysHandle.module,
      serverStatsHandle.module,
      triviaHandle.module,
      minigamesHandle.module,
      economyHandle.module,
      levelsHandle.module,
    ],
    adapters: [adapter],
    audit,
    moduleState,
    onShutdown: async () => {
      await closeApi?.();
      await database.close();
    },
  });

  // Scheduler jobs contributed by modules.
  kernel.scheduler.register(announcementsHandle.schedulerJob);
  kernel.scheduler.register(scheduledMessagesHandle.schedulerJob);
  kernel.scheduler.register(remindersHandle.schedulerJob);
  kernel.scheduler.register(birthdaysHandle.schedulerJob);
  kernel.scheduler.register(engagementPromptsHandle.schedulerJob);
  kernel.scheduler.register(giveawaysHandle.schedulerJob);
  for (const job of serverStatsHandle.schedulerJobs) kernel.scheduler.register(job);
  for (const job of triviaHandle.schedulerJobs) kernel.scheduler.register(job);
  kernel.scheduler.register(minigamesHandle.schedulerJob);

  kernel.health.register(createDbHealthIndicator(database.db));
  kernel.health.register({
    name: 'discord',
    async check() {
      // Discord connectivity is INFORMATIONAL, not fatal to the worker's
      // health: the internal API, scheduler and DB keep working without it.
      // A bad/expired token (state 'error') must NOT make the container
      // unhealthy and trigger restart loops — the real state is surfaced on
      // the admin dashboard. Always report ok; carry the state as detail.
      const status = adapter.getStatus();
      return { status: 'ok', detail: status.detail ?? status.state };
    },
  });

  kernel.installProcessHandlers();
  await kernel.start();

  const api = buildInternalApi({
    config,
    logger,
    health: kernel.health,
    modules: { list: () => kernel.registry.list() },
    moduleState,
    adapters: [adapter],
    audio: audioHandle,
    audit,
    startedAt: kernel.startedAt,
  });
  closeApi = async () => {
    await api.close();
  };

  await api.listen({ port: config.bot.healthPort, host: '0.0.0.0' });
  logger.info({ port: config.bot.healthPort }, 'bot internal API listening');
}

main().catch((error) => {
  // Logger may not exist yet — stderr is the only safe sink here.
  console.error('bot failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
