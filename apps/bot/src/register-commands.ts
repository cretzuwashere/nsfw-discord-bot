/* eslint-disable no-console */
import { createAudioModule } from '@botplatform/audio-module';
import { loadConfig } from '@botplatform/config';
import { registerSlashCommands } from '@botplatform/discord-adapter';
import { createLogger } from '@botplatform/logger';
import { createModerationModule } from '@botplatform/moderation-module';

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

  // Modules are constructed without persistence — we only need their
  // command definitions for registration.
  const audio = createAudioModule({ config, logger, playback: null });
  const moderation = createModerationModule({ config, logger, db: null });
  const commands = [...audio.module.commands, ...moderation.module.commands];

  const count = await registerSlashCommands({
    token: config.discord.token,
    clientId: config.discord.clientId,
    guildId: config.discord.guildId || undefined,
    commands,
    logger,
  });

  const scope = config.discord.guildId
    ? `guild ${config.discord.guildId} (instant)`
    : 'all servers (global — may take up to an hour to appear)';
  console.log(`Registered ${count} slash commands for ${scope}.`);
}

main().catch((error) => {
  console.error('command registration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
