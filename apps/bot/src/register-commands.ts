/* eslint-disable no-console */
import { createAnnouncementsModule } from '@botplatform/announcements-module';
import { createAudioModule } from '@botplatform/audio-module';
import { createBirthdaysModule } from '@botplatform/birthdays-module';
import { loadConfig } from '@botplatform/config';
import type { GuildService, GuildServiceProvider } from '@botplatform/core';
import { createDatabase, createDbAuditLog } from '@botplatform/database';
import { registerSlashCommands } from '@botplatform/discord-adapter';
import { createLogger } from '@botplatform/logger';
import { createCustomCommandsModule } from '@botplatform/custom-commands-module';
import { createModerationModule } from '@botplatform/moderation-module';
import { createRemindersModule } from '@botplatform/reminders-module';
import { createRoleMenusModule } from '@botplatform/role-menus-module';

/** Registration only needs command shapes — modules never act here. */
const NOOP_GUILD_PROVIDER: GuildServiceProvider = {
  isReady: () => false,
  forGuild: () => null as GuildService | null,
};

/**
 * CLI: register all module slash commands with Discord.
 * Run inside Docker:  docker compose exec app pnpm discord:register-commands
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.discord.enabled) {
    console.error(
      'Discord is not configured. Set DISCORD_TOKEN and DISCORD_CLIENT_ID in your .env ' +
        '(see docs/DISCORD_SETUP.md), then re-run this command.'
    );
    process.exit(1);
  }

  const logger = createLogger({ name: 'register-commands', level: config.logLevel, pretty: true });
  const database = createDatabase(config.database.url);
  const audit = createDbAuditLog(database.db, logger);

  // Modules are built only to collect their command definitions; nothing is
  // executed, so the no-op guild provider is fine.
  const audio = createAudioModule({ config, logger, playback: null });
  const moderation = createModerationModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: NOOP_GUILD_PROVIDER,
  });
  const announcements = createAnnouncementsModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: NOOP_GUILD_PROVIDER,
  });
  const roleMenus = createRoleMenusModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: NOOP_GUILD_PROVIDER,
  });
  const customCommands = createCustomCommandsModule({ config, logger, db: database.db, audit });
  const reminders = createRemindersModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: NOOP_GUILD_PROVIDER,
  });
  const birthdays = createBirthdaysModule({
    config,
    logger,
    db: database.db,
    audit,
    guildServiceProvider: NOOP_GUILD_PROVIDER,
  });
  const commands = [
    ...audio.module.commands,
    ...moderation.module.commands,
    ...announcements.module.commands,
    ...roleMenus.module.commands,
    ...customCommands.module.commands,
    ...reminders.module.commands,
    ...birthdays.module.commands,
  ];

  const count = await registerSlashCommands({
    token: config.discord.token,
    clientId: config.discord.clientId,
    guildId: config.discord.guildId || undefined,
    commands,
    logger,
  });
  await database.close();

  const scope = config.discord.guildId
    ? `guild ${config.discord.guildId} (instant)`
    : 'all servers (global — may take up to an hour to appear)';
  console.log(`Registered ${count} slash commands for ${scope}.`);
}

main().catch((error) => {
  console.error('command registration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
