import type { CommandContext, CommandDefinition } from '@botplatform/core';
import type { PromptCategory } from './banks.js';
import { clampHour, createCooldownStore, hitCooldown } from './logic.js';
import type { PromptService } from './service.js';

export interface PromptCommandDeps {
  service: PromptService;
  cooldownMs?: number;
  now?: () => number;
  rng?: () => number;
}

export function buildPromptCommands(deps: PromptCommandDeps): CommandDefinition[] {
  const cooldownMs = deps.cooldownMs ?? 5000;
  const now = deps.now ?? (() => Date.now());
  const rng = deps.rng ?? Math.random;
  const cooldown = createCooldownStore();

  async function post(ctx: CommandContext, category: PromptCategory, name: string): Promise<void> {
    const guildId = ctx.guildId;
    if (!guildId) {
      await ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      return;
    }
    const r = hitCooldown(cooldown, `${ctx.user.id}:${name}`, cooldownMs, now());
    if (!r.ok) {
      await ctx.reply({
        content: `Slow down — try again in ${Math.ceil(r.retryAfterMs / 1000)}s.`,
        ephemeral: true,
      });
      return;
    }
    const msg = await deps.service.promptFor(guildId, category);
    if (ctx.replyRich) {
      await ctx.replyRich(msg);
    } else {
      await ctx.reply(`**${msg.embed?.title ?? ''}**\n${msg.embed?.description ?? ''}`);
    }
  }

  const simple = (
    name: string,
    description: string,
    category: PromptCategory
  ): CommandDefinition => ({
    name,
    description,
    guildOnly: true,
    async execute(ctx) {
      await post(ctx, category, name);
    },
  });

  const truthOrDare: CommandDefinition = {
    name: 'truthordare',
    description: 'Get a truth or a dare',
    guildOnly: true,
    options: [{ name: 'kind', description: 'truth, dare or random', type: 'string' }],
    async execute(ctx) {
      const kind = String(ctx.options['kind'] ?? 'random').toLowerCase();
      const category: PromptCategory =
        kind === 'truth' ? 'truth' : kind === 'dare' ? 'dare' : rng() < 0.5 ? 'truth' : 'dare';
      await post(ctx, category, 'truthordare');
    },
  };

  const promptConfig: CommandDefinition = {
    name: 'promptconfig',
    description: 'Configure the daily Question of the Day',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    options: [
      { name: 'channel', description: 'Channel to post the daily QOTD in', type: 'channel', required: true },
      { name: 'hour', description: 'UTC hour (0-23) to post at', type: 'integer', required: true },
      { name: 'enabled', description: 'Enable or disable the daily QOTD', type: 'boolean', required: true },
    ],
    async execute(ctx) {
      const guildId = ctx.guildId;
      if (!guildId) {
        await ctx.reply({ content: 'Use this in a server.', ephemeral: true });
        return;
      }
      const channelId = String(ctx.options['channel'] ?? '');
      const hour = clampHour(Number(ctx.options['hour'] ?? 12));
      const enabled = ctx.options['enabled'] === true;
      await deps.service.setConfig(guildId, {
        qotdChannelId: channelId,
        qotdEnabled: enabled,
        qotdHourUtc: hour,
      });
      await ctx.reply({
        content: `Daily QOTD ${enabled ? '**enabled**' : '**disabled**'} — channel <#${channelId}>, ${hour}:00 UTC.`,
        ephemeral: true,
      });
    },
  };

  return [
    simple('qotd', 'Post a Question of the Day', 'qotd'),
    simple('wyr', 'Would You Rather…', 'wyr'),
    simple('neverhaveiever', 'A Never Have I Ever prompt', 'nhie'),
    simple('mostlikelyto', "Who's most likely to…", 'mostlikely'),
    truthOrDare,
    promptConfig,
  ];
}
