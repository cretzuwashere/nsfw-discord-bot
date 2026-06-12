import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { modules } from '../schema.js';

export type ModuleRow = typeof modules.$inferSelect;

export function createModulesRepo(db: Db) {
  return {
    /** Idempotently register a module; never downgrades user's enabled choice. */
    async ensure(input: {
      key: string;
      name: string;
      description?: string;
      defaultEnabled?: boolean;
    }): Promise<void> {
      await db
        .insert(modules)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? '',
          enabled: input.defaultEnabled ?? true,
        })
        .onConflictDoUpdate({
          target: modules.key,
          set: {
            name: input.name,
            description: input.description ?? '',
            updatedAt: sql`now()`,
          },
        });
    },

    async list(): Promise<ModuleRow[]> {
      return db.select().from(modules).orderBy(modules.key);
    },

    async get(key: string): Promise<ModuleRow | undefined> {
      const rows = await db.select().from(modules).where(eq(modules.key, key)).limit(1);
      return rows[0];
    },

    /** Missing row counts as enabled — modules registered in code are live by default. */
    async isEnabled(key: string): Promise<boolean> {
      const row = await this.get(key);
      return row?.enabled ?? true;
    },

    async setEnabled(key: string, enabled: boolean): Promise<ModuleRow | undefined> {
      const rows = await db
        .update(modules)
        .set({ enabled, updatedAt: sql`now()` })
        .where(eq(modules.key, key))
        .returning();
      return rows[0];
    },
  };
}

export type ModulesRepo = ReturnType<typeof createModulesRepo>;
