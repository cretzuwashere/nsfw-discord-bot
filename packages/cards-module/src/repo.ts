import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type CardTemplateRow = typeof schema.cardTemplates.$inferSelect;
export type NewCardTemplate = typeof schema.cardTemplates.$inferInsert;
export type CardAssetRow = typeof schema.cardAssets.$inferSelect;

export function createCardsRepo(db: Db) {
  const t = schema.cardTemplates;
  const assets = schema.cardAssets;
  return {
    async createTemplate(input: NewCardTemplate): Promise<CardTemplateRow> {
      const rows = await db.insert(t).values(input).returning();
      if (!rows[0]) throw new Error('failed to create card template');
      return rows[0];
    },

    async updateTemplate(id: string, patch: Partial<NewCardTemplate>): Promise<CardTemplateRow | undefined> {
      const rows = await db
        .update(t)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(t.id, id))
        .returning();
      return rows[0];
    },

    async getTemplate(id: string): Promise<CardTemplateRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return rows[0];
    },

    /** Templates for a guild plus global templates. */
    async listTemplates(guildId: string | null): Promise<CardTemplateRow[]> {
      const where = guildId
        ? and(or(eq(t.guildId, guildId), isNull(t.guildId)), isNull(t.archivedAt))
        : isNull(t.archivedAt);
      return db.select().from(t).where(where).orderBy(desc(t.createdAt));
    },

    async archiveTemplate(id: string): Promise<void> {
      await db.update(t).set({ archivedAt: sql`now()` }).where(eq(t.id, id));
    },

    async createAsset(input: typeof assets.$inferInsert): Promise<CardAssetRow> {
      const rows = await db.insert(assets).values(input).returning();
      if (!rows[0]) throw new Error('failed to create card asset');
      return rows[0];
    },

    async getAsset(id: string): Promise<CardAssetRow | undefined> {
      const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
      return rows[0];
    },

    async listAssets(guildId: string | null): Promise<CardAssetRow[]> {
      const where = guildId ? or(eq(assets.guildId, guildId), isNull(assets.guildId)) : undefined;
      const query = db.select().from(assets).orderBy(desc(assets.createdAt)).limit(100);
      return where ? query.where(where) : query;
    },
  };
}

export type CardsRepo = ReturnType<typeof createCardsRepo>;
