import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type ReminderRow = typeof schema.reminders.$inferSelect;
export type NewReminder = typeof schema.reminders.$inferInsert;

export function createReminderRepo(db: Db) {
  const t = schema.reminders;
  return {
    async create(input: NewReminder): Promise<ReminderRow> {
      const rows = await db.insert(t).values(input).returning();
      if (!rows[0]) throw new Error('failed to create reminder');
      return rows[0];
    },
    async getById(id: string): Promise<ReminderRow | undefined> {
      const rows = await db.select().from(t).where(eq(t.id, id)).limit(1);
      return rows[0];
    },
    async listForUser(userExternalId: string): Promise<ReminderRow[]> {
      return db
        .select()
        .from(t)
        .where(and(eq(t.userExternalId, userExternalId), eq(t.active, true)))
        .orderBy(asc(t.dueAt))
        .limit(50);
    },
    async listDue(now: Date): Promise<ReminderRow[]> {
      return db
        .select()
        .from(t)
        .where(and(eq(t.active, true), lte(t.dueAt, now)))
        .orderBy(asc(t.dueAt))
        .limit(50);
    },
    async deactivate(id: string): Promise<void> {
      await db.update(t).set({ active: false }).where(eq(t.id, id));
    },
    async reschedule(id: string, dueAt: Date): Promise<void> {
      await db.update(t).set({ dueAt }).where(eq(t.id, id));
    },
    async remove(id: string, userExternalId: string): Promise<boolean> {
      const rows = await db
        .delete(t)
        .where(and(eq(t.id, id), eq(t.userExternalId, userExternalId)))
        .returning({ id: t.id });
      return rows.length > 0;
    },
    async countActiveForUser(userExternalId: string): Promise<number> {
      const rows = await db
        .select({ v: sql<number>`count(*)::int` })
        .from(t)
        .where(and(eq(t.userExternalId, userExternalId), eq(t.active, true)));
      return rows[0]?.v ?? 0;
    },
  };
}

export type ReminderRepo = ReturnType<typeof createReminderRepo>;
