import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type BirthdayRow = typeof schema.birthdays.$inferSelect;
export type BirthdaySettingsRow = typeof schema.birthdaySettings.$inferSelect;

export function createBirthdayRepo(db: Db) {
  const b = schema.birthdays;
  const settings = schema.birthdaySettings;
  const announced = schema.birthdayAnnouncements;
  return {
    /** Opt-in: store/update a user's birthday. */
    async set(input: {
      guildId: string;
      userExternalId: string;
      month: number;
      day: number;
      year?: number | null;
      timezone?: string;
      visibility?: string;
    }): Promise<BirthdayRow> {
      const rows = await db
        .insert(b)
        .values({
          guildId: input.guildId,
          userExternalId: input.userExternalId,
          month: input.month,
          day: input.day,
          year: input.year ?? null,
          timezone: input.timezone ?? 'UTC',
          visibility: input.visibility ?? 'members',
        })
        .onConflictDoUpdate({
          target: [b.guildId, b.userExternalId],
          set: {
            month: input.month,
            day: input.day,
            year: input.year ?? null,
            timezone: input.timezone ?? 'UTC',
            visibility: input.visibility ?? 'members',
            updatedAt: sql`now()`,
          },
        })
        .returning();
      if (!rows[0]) throw new Error('failed to set birthday');
      return rows[0];
    },

    async get(guildId: string, userExternalId: string): Promise<BirthdayRow | undefined> {
      const rows = await db
        .select()
        .from(b)
        .where(and(eq(b.guildId, guildId), eq(b.userExternalId, userExternalId)))
        .limit(1);
      return rows[0];
    },

    /** Privacy: hard-delete a user's birthday. */
    async remove(guildId: string, userExternalId: string): Promise<boolean> {
      const rows = await db
        .delete(b)
        .where(and(eq(b.guildId, guildId), eq(b.userExternalId, userExternalId)))
        .returning({ id: b.id });
      return rows.length > 0;
    },

    async forGuild(guildId: string): Promise<BirthdayRow[]> {
      return db.select().from(b).where(eq(b.guildId, guildId)).orderBy(asc(b.month), asc(b.day));
    },

    async onMonthDay(guildId: string, month: number, day: number): Promise<BirthdayRow[]> {
      return db
        .select()
        .from(b)
        .where(and(eq(b.guildId, guildId), eq(b.month, month), eq(b.day, day)));
    },

    async getSettings(guildId: string): Promise<BirthdaySettingsRow | undefined> {
      const rows = await db.select().from(settings).where(eq(settings.guildId, guildId)).limit(1);
      return rows[0];
    },

    async upsertSettings(guildId: string, patch: Partial<typeof settings.$inferInsert>): Promise<BirthdaySettingsRow> {
      const rows = await db
        .insert(settings)
        .values({ guildId, ...patch })
        .onConflictDoUpdate({ target: settings.guildId, set: { ...patch, updatedAt: sql`now()` } })
        .returning();
      if (!rows[0]) throw new Error('failed to upsert birthday settings');
      return rows[0];
    },

    async allEnabledSettings(): Promise<BirthdaySettingsRow[]> {
      return db.select().from(settings).where(eq(settings.enabled, true));
    },

    /** Returns true if this is the first announcement for (guild,user,date). */
    async markAnnounced(guildId: string, userExternalId: string, dateKey: string): Promise<boolean> {
      const rows = await db
        .insert(announced)
        .values({ guildId, userExternalId, announcedOn: dateKey })
        .onConflictDoNothing()
        .returning({ id: announced.id });
      return rows.length > 0;
    },
  };
}

export type BirthdayRepo = ReturnType<typeof createBirthdayRepo>;
