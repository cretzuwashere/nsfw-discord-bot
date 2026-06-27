import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type TriviaRoundRow = typeof schema.triviaRounds.$inferSelect;
export type NewTriviaRound = typeof schema.triviaRounds.$inferInsert;
export type TriviaSettingsRow = typeof schema.triviaSettings.$inferSelect;

export interface TriviaAutoConfig {
  autoChannelId: string;
  autoEnabled: boolean;
  autoIntervalMin: number;
}

export function createTriviaRepo(db: Db) {
  const r = schema.triviaRounds;
  const a = schema.triviaAnswers;
  const sc = schema.triviaScores;
  const st = schema.triviaSettings;

  return {
    async createRound(input: NewTriviaRound): Promise<TriviaRoundRow> {
      const rows = await db.insert(r).values(input).returning();
      if (!rows[0]) throw new Error('failed to create trivia round');
      return rows[0];
    },
    async setMessageId(id: string, messageId: string): Promise<void> {
      await db.update(r).set({ messageId }).where(eq(r.id, id));
    },
    async getRound(id: string): Promise<TriviaRoundRow | undefined> {
      const rows = await db.select().from(r).where(eq(r.id, id)).limit(1);
      return rows[0];
    },
    async getOpenRoundInChannel(guildId: string, channelId: string): Promise<TriviaRoundRow | undefined> {
      const rows = await db
        .select()
        .from(r)
        .where(and(eq(r.guildId, guildId), eq(r.channelId, channelId), eq(r.status, 'open')))
        .limit(1);
      return rows[0];
    },
    /** Atomically claim an open round (first correct answer wins). Returns true if claimed. */
    async resolveIfOpen(roundId: string, winnerExternalId: string | null): Promise<boolean> {
      const rows = await db
        .update(r)
        .set({ status: 'resolved', winnerExternalId })
        .where(and(eq(r.id, roundId), eq(r.status, 'open')))
        .returning({ id: r.id });
      return rows.length > 0;
    },
    async listOpenExpired(cutoff: Date): Promise<TriviaRoundRow[]> {
      return db
        .select()
        .from(r)
        .where(and(eq(r.status, 'open'), lte(r.startedAt, cutoff)))
        .limit(50);
    },
    /** Record an answer; returns false if the user already answered this round. */
    async recordAnswer(roundId: string, userExternalId: string, correct: boolean): Promise<boolean> {
      const rows = await db
        .insert(a)
        .values({ roundId, userExternalId, correct })
        .onConflictDoNothing()
        .returning({ id: a.id });
      return rows.length > 0;
    },
    async incrementScore(guildId: string, userExternalId: string): Promise<void> {
      await db
        .insert(sc)
        .values({ guildId, userExternalId, wins: 1 })
        .onConflictDoUpdate({
          target: [sc.guildId, sc.userExternalId],
          set: { wins: sql`${sc.wins} + 1` },
        });
    },
    async topScores(guildId: string, limit: number): Promise<Array<{ userExternalId: string; wins: number }>> {
      const rows = await db
        .select({ u: sc.userExternalId, w: sc.wins })
        .from(sc)
        .where(eq(sc.guildId, guildId))
        .orderBy(desc(sc.wins))
        .limit(limit);
      return rows.map((row) => ({ userExternalId: row.u, wins: row.w }));
    },
    async getSettings(guildId: string): Promise<TriviaSettingsRow | undefined> {
      const rows = await db.select().from(st).where(eq(st.guildId, guildId)).limit(1);
      return rows[0];
    },
    async ensureSettings(guildId: string): Promise<TriviaSettingsRow> {
      await db.insert(st).values({ guildId }).onConflictDoNothing();
      const rows = await db.select().from(st).where(eq(st.guildId, guildId)).limit(1);
      if (!rows[0]) throw new Error('failed to ensure trivia settings');
      return rows[0];
    },
    async setRecent(guildId: string, recent: number[]): Promise<void> {
      await db.update(st).set({ recent, updatedAt: new Date() }).where(eq(st.guildId, guildId));
    },
    async setConfig(guildId: string, cfg: TriviaAutoConfig): Promise<void> {
      await db
        .insert(st)
        .values({ guildId, ...cfg })
        .onConflictDoUpdate({ target: st.guildId, set: { ...cfg, updatedAt: new Date() } });
    },
    async markAuto(guildId: string, at: Date): Promise<void> {
      await db.update(st).set({ lastAutoAt: at, updatedAt: new Date() }).where(eq(st.guildId, guildId));
    },
    async listAutoEnabled(): Promise<TriviaSettingsRow[]> {
      return db
        .select()
        .from(st)
        .where(and(eq(st.autoEnabled, true), isNotNull(st.autoChannelId)));
    },
  };
}

export type TriviaRepo = ReturnType<typeof createTriviaRepo>;
