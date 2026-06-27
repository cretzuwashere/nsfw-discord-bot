import type { CommandDefinition } from '@botplatform/core';
import { toSafeUserMessage, truncate } from '@botplatform/shared';
import { clampDuration, clampWinners, parseDuration } from './logic.js';
import type { GiveawayService } from './service.js';

export interface GiveawayCommandDeps {
  service: GiveawayService;
}

const ID_OPTION = {
  name: 'id',
  description: 'Giveaway id (first 8 characters shown on /giveaway list)',
  type: 'string',
  required: true,
} as const;

/** `/giveaway start|end|reroll|cancel|list` — the whole command is gated by ManageGuild. */
export function buildGiveawayCommands(deps: GiveawayCommandDeps): CommandDefinition[] {
  const { service } = deps;

  const command: CommandDefinition = {
    name: 'giveaway',
    description: 'Run server giveaways',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    subcommands: [
      {
        name: 'start',
        description: 'Start a giveaway',
        options: [
          { name: 'prize', description: 'What you are giving away', type: 'string', required: true },
          { name: 'duration', description: 'How long, e.g. 1h, 1d, 1d 6h', type: 'string', required: true },
          { name: 'winners', description: 'Number of winners (1-20, default 1)', type: 'integer' },
          { name: 'channel', description: 'Channel to post in (default: here)', type: 'channel' },
        ],
        async execute(ctx) {
          const sec = parseDuration(String(ctx.options['duration'] ?? ''));
          if (sec === null) {
            await ctx.reply({ content: 'I could not read that duration. Try `1h`, `1d` or `1d 6h`.', ephemeral: true });
            return;
          }
          const channelId =
            ctx.options['channel'] !== undefined ? String(ctx.options['channel']) : ctx.channelId;
          if (!channelId) {
            await ctx.reply({ content: 'I need a channel to post in.', ephemeral: true });
            return;
          }
          const winners = clampWinners(
            ctx.options['winners'] !== undefined ? Number(ctx.options['winners']) : 1
          );
          await ctx.defer();
          try {
            const g = await service.start({
              guildExternalId: ctx.guildId!,
              hostId: ctx.user.id,
              channelId,
              prize: String(ctx.options['prize'] ?? ''),
              durationSec: clampDuration(sec),
              winnersCount: winners,
            });
            await ctx.reply({
              content: `✅ Giveaway started in <#${channelId}> — id \`${g.id.slice(0, 8)}\`.`,
              ephemeral: true,
            });
          } catch (error) {
            await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
          }
        },
      },
      {
        name: 'end',
        description: 'End a giveaway now and draw winners',
        options: [ID_OPTION],
        async execute(ctx) {
          await ctx.defer();
          try {
            const winners = await service.endNow(ctx.guildId!, String(ctx.options['id'] ?? ''));
            await ctx.reply({
              content: winners.length ? `Drew ${winners.length} winner(s).` : 'No valid entrants.',
              ephemeral: true,
            });
          } catch (error) {
            await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
          }
        },
      },
      {
        name: 'reroll',
        description: 'Reroll the winners of an ended giveaway',
        options: [ID_OPTION],
        async execute(ctx) {
          await ctx.defer();
          try {
            const winners = await service.reroll(ctx.guildId!, String(ctx.options['id'] ?? ''));
            await ctx.reply({
              content: winners.length ? `Rerolled — ${winners.length} new winner(s).` : 'No valid entrants.',
              ephemeral: true,
            });
          } catch (error) {
            await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
          }
        },
      },
      {
        name: 'cancel',
        description: 'Cancel an active giveaway (no draw)',
        options: [ID_OPTION],
        async execute(ctx) {
          try {
            await service.cancel(ctx.guildId!, String(ctx.options['id'] ?? ''));
            await ctx.reply({ content: 'Giveaway canceled.', ephemeral: true });
          } catch (error) {
            await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
          }
        },
      },
      {
        name: 'list',
        description: 'List active giveaways',
        async execute(ctx) {
          const rows = await service.listActive(ctx.guildId!);
          if (rows.length === 0) {
            await ctx.reply({ content: 'No active giveaways.', ephemeral: true });
            return;
          }
          const lines = rows.map(
            (r) =>
              `\`${r.id.slice(0, 8)}\` ${truncate(r.prize, 60)} — ${r.winnersCount} winner(s), ends <t:${Math.floor(
                r.endsAt.getTime() / 1000
              )}:R>`
          );
          await ctx.reply({ content: lines.join('\n'), ephemeral: true });
        },
      },
    ],
  };

  return [command];
}
