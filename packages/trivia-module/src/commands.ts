import type { CommandDefinition } from '@botplatform/core';
import { toSafeUserMessage } from '@botplatform/shared';
import { clampInterval } from './logic.js';
import type { TriviaService } from './service.js';

export interface TriviaCommandDeps {
  service: TriviaService;
}

export function buildTriviaCommands(deps: TriviaCommandDeps): CommandDefinition[] {
  const { service } = deps;

  const trivia: CommandDefinition = {
    name: 'trivia',
    description: 'Start a trivia round in this channel',
    guildOnly: true,
    async execute(ctx) {
      if (!ctx.guildId || !ctx.channelId) {
        await ctx.reply({ content: 'Use this in a server channel.', ephemeral: true });
        return;
      }
      await ctx.defer();
      try {
        await service.start(ctx.guildId, ctx.channelId);
        await ctx.reply({ content: '🧠 Trivia round started — answer with the buttons!', ephemeral: true });
      } catch (error) {
        await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
      }
    },
  };

  const leaderboard: CommandDefinition = {
    name: 'trivia-leaderboard',
    description: 'Show the trivia win leaderboard',
    guildOnly: true,
    async execute(ctx) {
      if (!ctx.guildId) {
        await ctx.reply({ content: 'Use this in a server.', ephemeral: true });
        return;
      }
      await ctx.defer();
      const msg = await service.leaderboard(ctx.guildId);
      if (ctx.replyRich) await ctx.replyRich(msg);
      else await ctx.reply(`**${msg.embed?.title ?? ''}**\n${msg.embed?.description ?? ''}`);
    },
  };

  const config: CommandDefinition = {
    name: 'triviaconfig',
    description: 'Configure automatic trivia rounds',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    options: [
      { name: 'channel', description: 'Channel for auto-trivia', type: 'channel', required: true },
      { name: 'interval', description: 'Minutes between rounds (min 5)', type: 'integer', required: true },
      { name: 'enabled', description: 'Enable or disable auto-trivia', type: 'boolean', required: true },
    ],
    async execute(ctx) {
      if (!ctx.guildId) {
        await ctx.reply({ content: 'Use this in a server.', ephemeral: true });
        return;
      }
      const channelId = String(ctx.options['channel'] ?? '');
      const interval = clampInterval(Number(ctx.options['interval'] ?? 360));
      const enabled = ctx.options['enabled'] === true;
      await service.setConfig(ctx.guildId, {
        autoChannelId: channelId,
        autoEnabled: enabled,
        autoIntervalMin: interval,
      });
      await ctx.reply({
        content: `Auto-trivia ${enabled ? '**enabled**' : '**disabled**'} — <#${channelId}>, every ${interval} min.`,
        ephemeral: true,
      });
    },
  };

  return [trivia, leaderboard, config];
}
