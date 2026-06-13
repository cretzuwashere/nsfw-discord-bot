import { asc, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type RoleMenuRow = typeof schema.roleMenus.$inferSelect;
export type NewRoleMenu = typeof schema.roleMenus.$inferInsert;
export type RoleMenuOptionRow = typeof schema.roleMenuOptions.$inferSelect;
export interface RoleMenuWithOptions extends RoleMenuRow {
  options: RoleMenuOptionRow[];
}

export function createRoleMenuRepo(db: Db) {
  const menus = schema.roleMenus;
  const options = schema.roleMenuOptions;
  const logs = schema.roleAssignmentLogs;

  return {
    async create(input: NewRoleMenu): Promise<RoleMenuRow> {
      const rows = await db.insert(menus).values(input).returning();
      if (!rows[0]) throw new Error('failed to create role menu');
      return rows[0];
    },

    async update(id: string, patch: Partial<NewRoleMenu>): Promise<RoleMenuRow | undefined> {
      const rows = await db
        .update(menus)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(menus.id, id))
        .returning();
      return rows[0];
    },

    async getWithOptions(id: string): Promise<RoleMenuWithOptions | undefined> {
      const menuRows = await db.select().from(menus).where(eq(menus.id, id)).limit(1);
      const menu = menuRows[0];
      if (!menu) return undefined;
      const opts = await db
        .select()
        .from(options)
        .where(eq(options.menuId, id))
        .orderBy(asc(options.position));
      return { ...menu, options: opts };
    },

    async getByMessageId(messageId: string): Promise<RoleMenuWithOptions | undefined> {
      const menuRows = await db.select().from(menus).where(eq(menus.messageId, messageId)).limit(1);
      const menu = menuRows[0];
      if (!menu) return undefined;
      return this.getWithOptions(menu.id);
    },

    async listByGuild(guildId: string): Promise<RoleMenuRow[]> {
      return db.select().from(menus).where(eq(menus.guildId, guildId)).orderBy(desc(menus.createdAt));
    },

    async replaceOptions(
      menuId: string,
      opts: Array<{ roleId: string; label: string; description?: string; emoji?: string | null }>
    ): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.delete(options).where(eq(options.menuId, menuId));
        if (opts.length > 0) {
          await tx.insert(options).values(
            opts.map((o, position) => ({
              menuId,
              roleId: o.roleId,
              label: o.label,
              description: o.description ?? '',
              emoji: o.emoji ?? null,
              position,
            }))
          );
        }
      });
    },

    async setPublished(id: string, channelId: string, messageId: string): Promise<void> {
      await db
        .update(menus)
        .set({ channelId, messageId, updatedAt: sql`now()` })
        .where(eq(menus.id, id));
    },

    async logAssignment(input: {
      guildId: string;
      menuId: string;
      userExternalId: string;
      roleId: string;
      action: 'added' | 'removed';
    }): Promise<void> {
      await db.insert(logs).values(input);
    },

    async recentLogs(guildId: string, limit = 50): Promise<(typeof logs.$inferSelect)[]> {
      return db
        .select()
        .from(logs)
        .where(eq(logs.guildId, guildId))
        .orderBy(desc(logs.createdAt))
        .limit(Math.min(limit, 200));
    },
  };
}

export type RoleMenuRepo = ReturnType<typeof createRoleMenuRepo>;
