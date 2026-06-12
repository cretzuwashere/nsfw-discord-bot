import type { CommandDefinition } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import { REST, Routes } from 'discord.js';
import { commandsToDiscordJson } from './command-mapper.js';

export interface RegisterCommandsOptions {
  token: string;
  clientId: string;
  /** When set, commands register instantly for one guild; otherwise globally (slow rollout). */
  guildId?: string | undefined;
  commands: CommandDefinition[];
  logger: Logger;
  /** Injectable REST client for tests. */
  rest?: { put(route: string, options: { body: unknown }): Promise<unknown> };
}

/** Register slash commands with Discord. Returns how many were registered. */
export async function registerSlashCommands(options: RegisterCommandsOptions): Promise<number> {
  const body = commandsToDiscordJson(options.commands);
  const rest =
    options.rest ?? (new REST({ version: '10' }).setToken(options.token) as unknown as {
      put(route: string, opts: { body: unknown }): Promise<unknown>;
    });

  const route = options.guildId
    ? Routes.applicationGuildCommands(options.clientId, options.guildId)
    : Routes.applicationCommands(options.clientId);

  // Never log the token; route + counts only.
  options.logger.info(
    { route, count: body.length, scope: options.guildId ? 'guild' : 'global' },
    'registering slash commands'
  );
  await rest.put(route, { body });
  return body.length;
}
