import type { AppConfig } from '@botplatform/config';
import type { AuditLogPort, BotModule, CommandContext, CommandDefinition } from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { buildPlaceholderData, MODULE_KEYS } from '@botplatform/shared';
import { createCustomCommandRepo, type CustomCommandRepo } from './repo.js';
import { renderCustomResponse } from './render.js';

export interface CustomCommandsModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  adapterKey?: string;
}

export interface CustomCommandsModuleHandle {
  module: BotModule;
  repo: CustomCommandRepo;
}

/** Per (command,user) cooldown timestamps, kept in memory. */
const cooldowns = new Map<string, number>();

export function createCustomCommandsModule(
  options: CustomCommandsModuleOptions
): CustomCommandsModuleHandle {
  const repo = createCustomCommandRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const adapterKey = options.adapterKey ?? 'discord';

  // A single dispatcher command: /custom name:<string>. Avoids dynamic
  // slash-command registration; the admin panel manages the catalog.
  const command: CommandDefinition = {
    name: 'custom',
    description: 'Run a custom command',
    guildOnly: true,
    options: [{ name: 'name', description: 'Custom command name', type: 'string', required: true }],
    async execute(ctx: CommandContext) {
      const guild = await guilds.upsertByExternalId({ adapterKey, externalId: ctx.guildId! });
      const name = String(ctx.options['name'] ?? '').trim().toLowerCase();
      const cmd = await repo.getByName(guild.id, name);
      if (!cmd || !cmd.enabled) {
        await ctx.reply({ content: 'No such custom command.', ephemeral: true });
        return;
      }

      // Channel allowlist.
      if (cmd.allowedChannelIds.length > 0 && ctx.channelId && !cmd.allowedChannelIds.includes(ctx.channelId)) {
        await ctx.reply({ content: 'That command cannot be used in this channel.', ephemeral: true });
        return;
      }

      // Cooldown.
      if (cmd.cooldownSeconds > 0) {
        const key = `${cmd.id}:${ctx.user.id}`;
        const now = Date.now();
        const until = cooldowns.get(key) ?? 0;
        if (now < until) {
          await ctx.reply({ content: 'Please wait before using that command again.', ephemeral: true });
          return;
        }
        cooldowns.set(key, now + cmd.cooldownSeconds * 1000);
      }

      const data = buildPlaceholderData({
        user: { id: ctx.user.id, username: ctx.user.displayName, displayName: ctx.user.displayName },
        server: { name: ctx.guildId ?? '' },
      });
      const message = renderCustomResponse(cmd, data, Math.floor(Date.now() / 1000));
      // The slash reply contract is text-only; flatten the rendered message.
      await ctx.reply(flattenToText(message));
      await repo.incrementUse(cmd.id);
    },
  };

  const module: BotModule = {
    key: MODULE_KEYS.customCommands,
    name: 'Custom Commands',
    description: 'Create text, embed and random-response commands run with /custom.',
    metadata: {
      requiredPermissions: ['SendMessages'],
      requiredIntents: ['Guilds'],
      auditEvents: ['custom-command.created'],
    },
    commands: [command],
    onLoad(ctx) {
      ctx.logger.info('custom commands module ready');
    },
  };

  return { module, repo };
}

/** Flatten a rendered message to plain text for the slash reply contract. */
function flattenToText(message: import('@botplatform/core').OutgoingMessage): string {
  if (message.content && !message.embed) {
    const linkSuffix = message.buttons?.find((b) => b.url)?.url;
    return linkSuffix ? `${message.content}\n${linkSuffix}` : message.content;
  }
  if (message.embed) {
    const parts = [message.embed.title ? `**${message.embed.title}**` : '', message.embed.description ?? ''];
    return parts.filter(Boolean).join('\n') || '(empty)';
  }
  return message.content || '(empty)';
}

export { createCustomCommandRepo } from './repo.js';
export type { CustomCommandRepo, CustomCommandRow } from './repo.js';
export { renderCustomResponse, isValidCommandName } from './render.js';
export type { CustomResponseConfig } from './render.js';
