import { and, eq, lte, or, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type MinigameRow = typeof schema.minigameSessions.$inferSelect;
export type NewMinigame = typeof schema.minigameSessions.$inferInsert;

export interface MinigameStateUpdate {
  board?: number[];
  turn?: string;
  status?: string;
  winner?: string | null;
}

export function createMinigameRepo(db: Db) {
  const t = schema.minigameSessions;
  return {
    async create(input: NewMinigame): Promise<MinigameRow> {
      const rows = await db.insert(t).values(input).returning();
      if (!rows[0]) throw new Error('failed to create minigame session');
      return rows[0];
    },
    async setMessageId(id: string, messageId: string): Promise<void> {
      await db.update(t).set({ messageId }).where(eq(t.id, id));
    },
    async getById(id: string): Promise<MinigameRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return rows[0];
    },
    async updateState(id: string, fields: MinigameStateUpdate): Promise<void> {
      await db.update(t).set({ ...fields, updatedAt: new Date() }).where(eq(t.id, id));
    },
    async countActiveForUser(guildId: string, userExternalId: string): Promise<number> {
      const rows = await db
        .select({ v: sql<number>`count(*)::int` })
        .from(t)
        .where(
          and(
            eq(t.guildId, guildId),
            or(eq(t.status, 'pending'), eq(t.status, 'active')),
            or(eq(t.playerX, userExternalId), eq(t.playerO, userExternalId))
          )
        );
      return rows[0]?.v ?? 0;
    },
    async listExpired(pendingCutoff: Date, activeCutoff: Date): Promise<MinigameRow[]> {
      return db
        .select()
        .from(t)
        .where(
          or(
            and(eq(t.status, 'pending'), lte(t.createdAt, pendingCutoff)),
            and(eq(t.status, 'active'), lte(t.updatedAt, activeCutoff))
          )
        )
        .limit(50);
    },
  };
}

export type MinigameRepo = ReturnType<typeof createMinigameRepo>;
