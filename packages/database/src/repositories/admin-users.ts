import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { adminUsers } from '../schema.js';

export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminRole = AdminUser['role'];

export function createAdminUsersRepo(db: Db) {
  return {
    async findByEmail(email: string): Promise<AdminUser | undefined> {
      const rows = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, email.toLowerCase()))
        .limit(1);
      return rows[0];
    },

    async findById(id: string): Promise<AdminUser | undefined> {
      const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
      return rows[0];
    },

    async create(input: {
      email: string;
      passwordHash: string;
      role?: AdminRole;
    }): Promise<AdminUser> {
      const rows = await db
        .insert(adminUsers)
        .values({
          email: input.email.toLowerCase(),
          passwordHash: input.passwordHash,
          role: input.role ?? 'admin',
        })
        .returning();
      if (!rows[0]) throw new Error('failed to create admin user');
      return rows[0];
    },

    async recordLogin(id: string): Promise<void> {
      await db
        .update(adminUsers)
        .set({ lastLoginAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(adminUsers.id, id));
    },

    async count(): Promise<number> {
      const rows = await db.select({ value: sql<number>`count(*)::int` }).from(adminUsers);
      return rows[0]?.value ?? 0;
    },
  };
}

export type AdminUsersRepo = ReturnType<typeof createAdminUsersRepo>;
