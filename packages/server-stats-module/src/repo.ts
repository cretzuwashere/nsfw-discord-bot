import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type ServerStatsSettingsRow = typeof schema.serverStatsSettings.$inferSelect;

export interface RecapConfigInput {
  recapChannelId: string;
  recapEnabled: boolean;
  recapDow: number;
  recapHourUtc: number;
}

export interface RankedEntry {
  id: string;
  messages: number;
}

export function createServerStatsRepo(db: Db) {
  const u = schema.activityUserDaily;
  const c = schema.activityChannelDaily;
  const s = schema.serverStatsSettings;

  return {
    async addUserMessages(guildId: string, userExternalId: string, date: string, count: number): Promise<void> {
      await db
        .insert(u)
        .values({ guildId, userExternalId, date, messages: count })
        .onConflictDoUpdate({
          target: [u.guildId, u.userExternalId, u.date],
          set: { messages: sql`${u.messages} + ${count}` },
        });
    },
    async addChannelMessages(guildId: string, channelId: string, date: string, count: number): Promise<void> {
      await db
        .insert(c)
        .values({ guildId, channelId, date, messages: count })
        .onConflictDoUpdate({
          target: [c.guildId, c.channelId, c.date],
          set: { messages: sql`${c.messages} + ${count}` },
        });
    },
    async totalMessages(guildId: string, sinceDate: string): Promise<number> {
      const rows = await db
        .select({ m: sql<number>`coalesce(sum(${u.messages}),0)::int` })
        .from(u)
        .where(and(eq(u.guildId, guildId), gte(u.date, sinceDate)));
      return rows[0]?.m ?? 0;
    },
    async topUsers(guildId: string, sinceDate: string, limit: number): Promise<RankedEntry[]> {
      const rows = await db
        .select({ id: u.userExternalId, m: sql<number>`sum(${u.messages})::int` })
        .from(u)
        .where(and(eq(u.guildId, guildId), gte(u.date, sinceDate)))
        .groupBy(u.userExternalId)
        .orderBy(desc(sql`sum(${u.messages})`))
        .limit(limit);
      return rows.map((r) => ({ id: r.id, messages: r.m }));
    },
    async topChannels(guildId: string, sinceDate: string, limit: number): Promise<RankedEntry[]> {
      const rows = await db
        .select({ id: c.channelId, m: sql<number>`sum(${c.messages})::int` })
        .from(c)
        .where(and(eq(c.guildId, guildId), gte(c.date, sinceDate)))
        .groupBy(c.channelId)
        .orderBy(desc(sql`sum(${c.messages})`))
        .limit(limit);
      return rows.map((r) => ({ id: r.id, messages: r.m }));
    },
    async activeUserCount(guildId: string, sinceDate: string): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`count(distinct ${u.userExternalId})::int` })
        .from(u)
        .where(and(eq(u.guildId, guildId), gte(u.date, sinceDate)));
      return rows[0]?.n ?? 0;
    },
    async userMessages(guildId: string, userExternalId: string, sinceDate: string): Promise<number> {
      const rows = await db
        .select({ m: sql<number>`coalesce(sum(${u.messages}),0)::int` })
        .from(u)
        .where(and(eq(u.guildId, guildId), eq(u.userExternalId, userExternalId), gte(u.date, sinceDate)));
      return rows[0]?.m ?? 0;
    },
    async userTotal(guildId: string, userExternalId: string): Promise<number> {
      const rows = await db
        .select({ m: sql<number>`coalesce(sum(${u.messages}),0)::int` })
        .from(u)
        .where(and(eq(u.guildId, guildId), eq(u.userExternalId, userExternalId)));
      return rows[0]?.m ?? 0;
    },
    /** Returns this user's weekly rank (1-based) and the number of ranked members. */
    async userWeeklyRank(
      guildId: string,
      userExternalId: string,
      sinceDate: string
    ): Promise<{ rank: number; total: number }> {
      const rows = await db
        .select({ id: u.userExternalId, m: sql<number>`sum(${u.messages})::int` })
        .from(u)
        .where(and(eq(u.guildId, guildId), gte(u.date, sinceDate)))
        .groupBy(u.userExternalId);
      const sorted = rows.map((r) => ({ id: r.id, m: r.m })).sort((a, b) => b.m - a.m);
      const idx = sorted.findIndex((r) => r.id === userExternalId);
      return { rank: idx < 0 ? 0 : idx + 1, total: sorted.length };
    },
    async getSettings(guildId: string): Promise<ServerStatsSettingsRow | undefined> {
      const rows = await db.select().from(s).where(eq(s.guildId, guildId)).limit(1);
      return rows[0];
    },
    async setConfig(guildId: string, cfg: RecapConfigInput): Promise<void> {
      await db
        .insert(s)
        .values({ guildId, ...cfg })
        .onConflictDoUpdate({ target: s.guildId, set: { ...cfg, updatedAt: new Date() } });
    },
    async markRecapPosted(guildId: string, date: string): Promise<void> {
      await db.update(s).set({ lastRecapDate: date, updatedAt: new Date() }).where(eq(s.guildId, guildId));
    },
    async listRecapEnabled(): Promise<ServerStatsSettingsRow[]> {
      return db
        .select()
        .from(s)
        .where(and(eq(s.recapEnabled, true), isNotNull(s.recapChannelId)));
    },
  };
}

export type ServerStatsRepo = ReturnType<typeof createServerStatsRepo>;
