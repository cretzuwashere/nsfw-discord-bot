import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type AnnouncementRow = typeof schema.announcements.$inferSelect;
export type AnnouncementStatus = AnnouncementRow['status'];
export type NewAnnouncement = typeof schema.announcements.$inferInsert;

/** Data access for the announcements table. */
export function createAnnouncementRepo(db: Db) {
  const t = schema.announcements;
  return {
    async create(input: NewAnnouncement): Promise<AnnouncementRow> {
      const rows = await db.insert(t).values(input).returning();
      if (!rows[0]) throw new Error('failed to create announcement');
      return rows[0];
    },

    async update(id: string, patch: Partial<NewAnnouncement>): Promise<AnnouncementRow | undefined> {
      const rows = await db
        .update(t)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(t.id, id))
        .returning();
      return rows[0];
    },

    async getById(id: string): Promise<AnnouncementRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return rows[0];
    },

    async listByGuild(
      guildId: string,
      options: { includeTemplates?: boolean; limit?: number } = {}
    ): Promise<AnnouncementRow[]> {
      const where = options.includeTemplates
        ? eq(t.guildId, guildId)
        : and(eq(t.guildId, guildId), eq(t.isTemplate, false));
      return db
        .select()
        .from(t)
        .where(where)
        .orderBy(desc(t.createdAt))
        .limit(Math.min(options.limit ?? 50, 200));
    },

    async listTemplates(guildId: string): Promise<AnnouncementRow[]> {
      return db
        .select()
        .from(t)
        .where(and(eq(t.guildId, guildId), eq(t.isTemplate, true)))
        .orderBy(desc(t.createdAt));
    },

    /** Scheduled announcements whose time has come, across all guilds. */
    async listDue(now: Date): Promise<AnnouncementRow[]> {
      return db
        .select()
        .from(t)
        .where(
          and(eq(t.status, 'scheduled'), eq(t.isTemplate, false), lte(t.scheduledFor, now))
        )
        .limit(50);
    },

    async setStatus(
      id: string,
      status: AnnouncementStatus,
      extra: Partial<NewAnnouncement> = {}
    ): Promise<void> {
      await db
        .update(t)
        .set({ status, ...extra, updatedAt: sql`now()` })
        .where(eq(t.id, id));
    },

    async delete(id: string): Promise<void> {
      await db.delete(t).where(eq(t.id, id));
    },
  };
}

export type AnnouncementRepo = ReturnType<typeof createAnnouncementRepo>;
