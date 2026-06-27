import type { CommandContext, CommandDefinition } from '@botplatform/core';
import type { LevelConfigInput } from './repo.js';
import type { LevelsService } from './service.js';

export interface LevelsCommandDeps {
  service: LevelsService;
}

async function richReply(ctx: CommandContext, message: Awaited<ReturnType<LevelsService['rank']>>): Promise<void> {
  if (ctx.replyRich) await ctx.replyRich(message);
  else await ctx.reply(`**${message.embed?.title ?? ''}**\n${message.embed?.description ?? ''}`);
}

export function buildLevelsCommands(deps: LevelsCommandDeps): CommandDefinition[] {
  const { service } = deps;

  const rank: CommandDefinition = {
    name: 'rank',
    description: 'Show your (or another member’s) level and XP',
    guildOnly: true,
    options: [{ name: 'user', description: 'Member to look up (default: you)', type: 'user' }],
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      const target = ctx.options['user'] !== undefined ? String(ctx.options['user']) : ctx.user.id;
      await ctx.defer();
      await richReply(ctx, await service.rank(ctx.guildId, target));
    },
  };

  const levels: CommandDefinition = {
    name: 'levels',
    description: 'Show the XP leaderboard',
    guildOnly: true,
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      await ctx.defer();
      await richReply(ctx, await service.leaderboardPage(ctx.guildId, 0));
    },
  };

  const config: CommandDefinition = {
    name: 'levelconfig',
    description: 'Configure leveling (XP, announcements)',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    options: [
      { name: 'enabled', description: 'Turn leveling on/off', type: 'boolean' },
      { name: 'channel', description: 'Level-up announce channel (blank = same channel)', type: 'channel' },
      { name: 'message', description: 'Level-up message ({user}, {level})', type: 'string' },
      { name: 'xp_min', description: 'Min XP per message', type: 'integer' },
      { name: 'xp_max', description: 'Max XP per message', type: 'integer' },
      { name: 'cooldown', description: 'Seconds between XP awards per user', type: 'integer' },
    ],
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      const patch: LevelConfigInput = {};
      if (ctx.options['enabled'] !== undefined) patch.enabled = ctx.options['enabled'] === true;
      if (ctx.options['channel'] !== undefined) patch.announceChannelId = String(ctx.options['channel']);
      if (ctx.options['message'] !== undefined) patch.levelUpMessage = String(ctx.options['message']).slice(0, 300);
      if (ctx.options['xp_min'] !== undefined) patch.xpMin = Math.max(1, Number(ctx.options['xp_min']));
      if (ctx.options['xp_max'] !== undefined) patch.xpMax = Math.max(1, Number(ctx.options['xp_max']));
      if (ctx.options['cooldown'] !== undefined) patch.cooldownSeconds = Math.max(0, Number(ctx.options['cooldown']));
      await service.setConfig(ctx.guildId, patch);
      await ctx.reply({ content: 'Leveling settings updated.', ephemeral: true });
    },
  };

  const noxp: CommandDefinition = {
    name: 'levelnoxp',
    description: 'Add or remove a channel from the no-XP list',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    options: [
      { name: 'channel', description: 'Channel to toggle', type: 'channel', required: true },
      { name: 'add', description: 'true = no XP here, false = allow XP', type: 'boolean', required: true },
    ],
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      const msg = await service.toggleNoXp(ctx.guildId, String(ctx.options['channel'] ?? ''), ctx.options['add'] === true);
      await ctx.reply({ content: msg, ephemeral: true });
    },
  };

  const rewards: CommandDefinition = {
    name: 'levelrewards',
    description: 'Manage level-reward roles',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    subcommands: [
      {
        name: 'add',
        description: 'Grant a role when members reach a level',
        options: [
          { name: 'level', description: 'Level', type: 'integer', required: true },
          { name: 'role', description: 'Role to grant', type: 'role', required: true },
        ],
        async execute(ctx) {
          const msg = await service.addReward(ctx.guildId!, Math.max(1, Number(ctx.options['level'] ?? 1)), String(ctx.options['role'] ?? ''));
          await ctx.reply({ content: msg, ephemeral: true });
        },
      },
      {
        name: 'remove',
        description: 'Remove a level reward',
        options: [{ name: 'level', description: 'Level', type: 'integer', required: true }],
        async execute(ctx) {
          await ctx.reply({ content: await service.removeReward(ctx.guildId!, Number(ctx.options['level'] ?? 0)), ephemeral: true });
        },
      },
      {
        name: 'list',
        description: 'List configured level rewards',
        async execute(ctx) {
          await ctx.defer();
          await richReply(ctx, await service.listRewards(ctx.guildId!));
        },
      },
    ],
  };

  return [rank, levels, config, noxp, rewards];
}
