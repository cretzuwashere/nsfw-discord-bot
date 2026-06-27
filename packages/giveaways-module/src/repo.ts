import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type GiveawayRow = typeof schema.giveaways.$inferSelect;
export type NewGiveaway = typeof schema.giveaways.$inferInsert;

export function createGiveawayRepo(db: Db) {
  const g = schema.giveaways;
  const e = schema.giveawayEntries;
  return {
    async create(input: NewGiveaway): Promise<GiveawayRow> {
      const rows = await db.insert(g).values(input).returning();
      if (!rows[0]) throw new Error('failed to create giveaway');
      return rows[0];
    },
    async setMessageId(id: string, messageId: string): Promise<void> {
      await db.update(g).set({ messageId }).where(eq(g.id, id));
    },
    async getById(id: string): Promise<GiveawayRow | undefined> {
      const rows = await db.select().from(g).where(eq(g.id, id)).limit(1);
      return rows[0];
    },
    async findByShortId(guildId: string, shortId: string): Promise<GiveawayRow | undefined> {
      const rows = await db
        .select()
        .from(g)
        .where(eq(g.guildId, guildId))
        .orderBy(desc(g.createdAt))
        .limit(200);
      return rows.find((r) => r.id === shortId || r.id.startsWith(shortId));
    },
    async listActiveByGuild(guildId: string): Promise<GiveawayRow[]> {
      return db
        .select()
        .from(g)
        .where(and(eq(g.guildId, guildId), eq(g.status, 'active')))
        .orderBy(asc(g.endsAt))
        .limit(25);
    },
    async listDue(now: Date): Promise<GiveawayRow[]> {
      return db
        .select()
        .from(g)
        .where(and(eq(g.status, 'active'), lte(g.endsAt, now)))
        .limit(50);
    },
    async addEntry(giveawayId: string, userExternalId: string): Promise<boolean> {
      const rows = await db
        .insert(e)
        .values({ giveawayId, userExternalId })
        .onConflictDoNothing()
        .returning({ id: e.id });
      return rows.length > 0;
    },
    async listEntrants(giveawayId: string): Promise<string[]> {
      const rows = await db
        .select({ u: e.userExternalId })
        .from(e)
        .where(eq(e.giveawayId, giveawayId));
      return rows.map((r) => r.u);
    },
    async countEntrants(giveawayId: string): Promise<number> {
      const rows = await db
        .select({ v: sql<number>`count(*)::int` })
        .from(e)
        .where(eq(e.giveawayId, giveawayId));
      return rows[0]?.v ?? 0;
    },
    async finish(id: string, winners: string[], endedAt: Date): Promise<void> {
      await db.update(g).set({ status: 'ended', winners, endedAt }).where(eq(g.id, id));
    },
    async setWinners(id: string, winners: string[]): Promise<void> {
      await db.update(g).set({ winners }).where(eq(g.id, id));
    },
    async setCanceled(id: string): Promise<void> {
      await db.update(g).set({ status: 'canceled', endedAt: new Date() }).where(eq(g.id, id));
    },
  };
}

export type GiveawayRepo = ReturnType<typeof createGiveawayRepo>;
