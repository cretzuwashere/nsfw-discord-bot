import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type CustomCommandRow = typeof schema.customCommands.$inferSelect;
export type NewCustomCommand = typeof schema.customCommands.$inferInsert;

export function createCustomCommandRepo(db: Db) {
  const t = schema.customCommands;
  return {
    async create(input: NewCustomCommand): Promise<CustomCommandRow> {
      const rows = await db.insert(t).values(input).returning();
      if (!rows[0]) throw new Error('failed to create custom command');
      return rows[0];
    },
    async update(id: string, patch: Partial<NewCustomCommand>): Promise<CustomCommandRow | undefined> {
      const rows = await db.update(t).set({ ...patch, updatedAt: sql`now()` }).where(eq(t.id, id)).returning();
      return rows[0];
    },
    async getById(id: string): Promise<CustomCommandRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return rows[0];
    },
    async getByName(guildId: string, name: string): Promise<CustomCommandRow | undefined> {
      const rows = await db
        .select()
        .from(t)
        .where(and(eq(t.guildId, guildId), eq(t.name, name.toLowerCase())))
        .limit(1);
      return rows[0];
    },
    async listByGuild(guildId: string): Promise<CustomCommandRow[]> {
      return db.select().from(t).where(eq(t.guildId, guildId)).orderBy(desc(t.createdAt));
    },
    async incrementUse(id: string): Promise<void> {
      await db.update(t).set({ useCount: sql`${t.useCount} + 1` }).where(eq(t.id, id));
    },
    async delete(id: string): Promise<void> {
      await db.delete(t).where(eq(t.id, id));
    },
  };
}

export type CustomCommandRepo = ReturnType<typeof createCustomCommandRepo>;
