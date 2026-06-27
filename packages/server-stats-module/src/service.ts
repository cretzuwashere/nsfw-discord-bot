import type { GuildServiceProvider, OutgoingMessage } from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { isRecapDue, startOfWindowUtc, ymdUtc } from './logic.js';
import type { ActivityAccumulator, RecapDueState } from './logic.js';
import type { RankedEntry, RecapConfigInput, ServerStatsRepo } from './repo.js';

const COLOR = 0x5865f2;
const WEEK_DAYS = 7;

export interface ServerStatsServiceDeps {
  accumulator: ActivityAccumulator;
  repo: ServerStatsRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  logger: Logger;
  adapterKey: string;
}

function rankList(entries: RankedEntry[], render: (id: string) => string): string {
  if (entries.length === 0) return '_No activity yet._';
  const medals = ['🥇', '🥈', '🥉'];
  return entries
    .map((e, i) => `${medals[i] ?? `**${i + 1}.**`} ${render(e.id)} — ${e.messages.toLocaleString()}`)
    .join('\n');
}

export function createServerStatsService(deps: ServerStatsServiceDeps) {
  async function resolveGuildId(externalId: string): Promise<string> {
    const guild = await deps.guilds.upsertByExternalId({ adapterKey: deps.adapterKey, externalId });
    return guild.id;
  }

  async function buildRecap(guildId: string, now: Date): Promise<OutgoingMessage> {
    const weekStart = startOfWindowUtc(now, WEEK_DAYS);
    const [total, active, topUsers, topChannels] = await Promise.all([
      deps.repo.totalMessages(guildId, weekStart),
      deps.repo.activeUserCount(guildId, weekStart),
      deps.repo.topUsers(guildId, weekStart, 5),
      deps.repo.topChannels(guildId, weekStart, 3),
    ]);
    return {
      embed: {
        title: '📊 Weekly Highlights',
        description: `In the last 7 days: **${total.toLocaleString()}** messages from **${active.toLocaleString()}** members.`,
        color: COLOR,
        fields: [
          { name: '🏆 Top chatters', value: rankList(topUsers, (id) => `<@${id}>`) },
          { name: '💬 Busiest channels', value: rankList(topChannels, (id) => `<#${id}>`) },
        ],
      },
      allowMentions: { everyone: false, roles: [], users: [] },
    };
  }

  return {
    /** Drain the accumulator into batched per-day upserts. */
    async flush(date: string): Promise<number> {
      const batches = deps.accumulator.drain();
      let writes = 0;
      for (const b of batches) {
        const guildId = await resolveGuildId(b.guildExternalId);
        for (const [userId, count] of b.users) {
          await deps.repo.addUserMessages(guildId, userId, date, count);
          writes++;
        }
        for (const [channelId, count] of b.channels) {
          await deps.repo.addChannelMessages(guildId, channelId, date, count);
        }
      }
      return writes;
    },

    async deliverWeeklyRecaps(now: Date): Promise<number> {
      const rows = await deps.repo.listRecapEnabled();
      let posted = 0;
      for (const s of rows) {
        if (!isRecapDue(s as RecapDueState, now)) continue;
        const guild = await deps.guilds.getById(s.guildId).catch(() => undefined);
        if (!guild) continue;
        const svc = deps.guildServiceProvider.forGuild(guild.externalId);
        if (!svc) continue; // bot offline — retry next tick
        try {
          const msg = await buildRecap(s.guildId, now);
          await svc.sendMessage(s.recapChannelId!, msg);
          await deps.repo.markRecapPosted(s.guildId, ymdUtc(now));
          posted++;
        } catch (error) {
          deps.logger.warn({ err: error, guildId: s.guildId }, 'weekly recap failed');
          await deps.repo.markRecapPosted(s.guildId, ymdUtc(now));
        }
      }
      return posted;
    },

    async serverStats(guildExternalId: string, now: Date): Promise<OutgoingMessage> {
      const guildId = await resolveGuildId(guildExternalId);
      const today = ymdUtc(now);
      const weekStart = startOfWindowUtc(now, WEEK_DAYS);
      const [todayTotal, weekTotal, active, topUsers, topChannels] = await Promise.all([
        deps.repo.totalMessages(guildId, today),
        deps.repo.totalMessages(guildId, weekStart),
        deps.repo.activeUserCount(guildId, weekStart),
        deps.repo.topUsers(guildId, weekStart, 5),
        deps.repo.topChannels(guildId, weekStart, 3),
      ]);
      return {
        embed: {
          title: '📊 Server Stats',
          description: `**Today:** ${todayTotal.toLocaleString()} messages\n**This week:** ${weekTotal.toLocaleString()} messages from ${active.toLocaleString()} members`,
          color: COLOR,
          fields: [
            { name: '🏆 Top chatters (7d)', value: rankList(topUsers, (id) => `<@${id}>`) },
            { name: '💬 Busiest channels (7d)', value: rankList(topChannels, (id) => `<#${id}>`) },
          ],
        },
        allowMentions: { everyone: false, roles: [], users: [] },
      };
    },

    async myActivity(guildExternalId: string, userExternalId: string, now: Date): Promise<OutgoingMessage> {
      const guildId = await resolveGuildId(guildExternalId);
      const today = ymdUtc(now);
      const weekStart = startOfWindowUtc(now, WEEK_DAYS);
      const [todayCount, weekCount, total, rank] = await Promise.all([
        deps.repo.userMessages(guildId, userExternalId, today),
        deps.repo.userMessages(guildId, userExternalId, weekStart),
        deps.repo.userTotal(guildId, userExternalId),
        deps.repo.userWeeklyRank(guildId, userExternalId, weekStart),
      ]);
      const rankText = rank.rank > 0 ? `#${rank.rank} of ${rank.total}` : 'unranked';
      return {
        embed: {
          title: '📈 Your Activity',
          description: `<@${userExternalId}>`,
          color: COLOR,
          fields: [
            { name: 'Today', value: todayCount.toLocaleString(), inline: true },
            { name: 'This week', value: weekCount.toLocaleString(), inline: true },
            { name: 'All time', value: total.toLocaleString(), inline: true },
            { name: 'Weekly rank', value: rankText, inline: true },
          ],
        },
        allowMentions: { everyone: false, roles: [], users: [] },
      };
    },

    async setConfig(guildExternalId: string, cfg: RecapConfigInput): Promise<void> {
      const guildId = await resolveGuildId(guildExternalId);
      await deps.repo.setConfig(guildId, cfg);
    },
  };
}

export type ServerStatsService = ReturnType<typeof createServerStatsService>;
