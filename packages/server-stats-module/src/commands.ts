import type { CommandContext, CommandDefinition } from '@botplatform/core';
import { clampDow, clampHour } from './logic.js';
import type { ServerStatsService } from './service.js';

export interface ServerStatsCommandDeps {
  service: ServerStatsService;
  now?: () => Date;
}

async function replyEmbed(ctx: CommandContext, message: Awaited<ReturnType<ServerStatsService['serverStats']>>): Promise<void> {
  if (ctx.replyRich) {
    await ctx.replyRich(message);
  } else {
    await ctx.reply(`**${message.embed?.title ?? ''}**\n${message.embed?.description ?? ''}`);
  }
}

export function buildServerStatsCommands(deps: ServerStatsCommandDeps): CommandDefinition[] {
  const now = deps.now ?? (() => new Date());

  const serverStats: CommandDefinition = {
    name: 'serverstats',
    description: 'Show server activity stats',
    guildOnly: true,
    async execute(ctx) {
      if (!ctx.guildId) {
        await ctx.reply({ content: 'Use this in a server.', ephemeral: true });
        return;
      }
      await ctx.defer();
      const msg = await deps.service.serverStats(ctx.guildId, now());
      await replyEmbed(ctx, msg);
    },
  };

  const myActivity: CommandDefinition = {
    name: 'myactivity',
    description: 'Show your (or another member’s) message activity',
    guildOnly: true,
    options: [{ name: 'user', description: 'Member to look up (default: you)', type: 'user' }],
    async execute(ctx) {
      if (!ctx.guildId) {
        await ctx.reply({ content: 'Use this in a server.', ephemeral: true });
        return;
      }
      const target = ctx.options['user'] !== undefined ? String(ctx.options['user']) : ctx.user.id;
      await ctx.defer();
      const msg = await deps.service.myActivity(ctx.guildId, target, now());
      await replyEmbed(ctx, msg);
    },
  };

  const statsConfig: CommandDefinition = {
    name: 'statsconfig',
    description: 'Configure the weekly highlights recap',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    options: [
      { name: 'channel', description: 'Channel for the weekly recap', type: 'channel', required: true },
      { name: 'day', description: 'Day of week (0=Sun … 6=Sat)', type: 'integer', required: true },
      { name: 'hour', description: 'UTC hour (0-23)', type: 'integer', required: true },
      { name: 'enabled', description: 'Enable or disable the weekly recap', type: 'boolean', required: true },
    ],
    async execute(ctx) {
      if (!ctx.guildId) {
        await ctx.reply({ content: 'Use this in a server.', ephemeral: true });
        return;
      }
      const channelId = String(ctx.options['channel'] ?? '');
      const dow = clampDow(Number(ctx.options['day'] ?? 1));
      const hour = clampHour(Number(ctx.options['hour'] ?? 12));
      const enabled = ctx.options['enabled'] === true;
      await deps.service.setConfig(ctx.guildId, {
        recapChannelId: channelId,
        recapEnabled: enabled,
        recapDow: dow,
        recapHourUtc: hour,
      });
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      await ctx.reply({
        content: `Weekly recap ${enabled ? '**enabled**' : '**disabled**'} — <#${channelId}>, ${days[dow]} ${hour}:00 UTC.`,
        ephemeral: true,
      });
    },
  };

  return [serverStats, myActivity, statsConfig];
}
