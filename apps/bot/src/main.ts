import { createAnnouncementsModule } from '@botplatform/announcements-module';
import { createAudioModule } from '@botplatform/audio-module';
import { createCardsModule } from '@botplatform/cards-module';
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

  kernel.health.register(createDbHealthIndicator(database.db));
  kernel.health.register({
    name: 'discord',
    async check() {
      const status = adapter.getStatus();
      // 'disabled' is a valid configuration, not a failure.
      return status.state === 'error'
        ? { status: 'error', detail: status.detail }
        : { status: 'ok', detail: status.state };
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
