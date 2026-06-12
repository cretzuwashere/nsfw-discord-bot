import type { Db } from '@botplatform/database';
import { schema } from '@botplatform/database';
import { and, eq, inArray } from 'drizzle-orm';

export type PermissionMappingRow = typeof schema.permissionMappings.$inferSelect;

/**
 * Repo-style wrapper around the permission_mappings table. Lives here (not in
 * @botplatform/database) because role-based permissions are a moderation
 * concern; it moves down a layer once other modules need it.
 */
export function createPermissionsRepo(db: Db) {
  return {
    /** True when at least one of the given roles grants the permission in the guild. */
    async hasAny(input: {
      adapterKey: string;
      guildExternalId: string;
      roleExternalIds: string[];
      permission: string;
    }): Promise<boolean> {
      if (input.roleExternalIds.length === 0) return false;
      const rows = await db
        .select({ id: schema.permissionMappings.id })
        .from(schema.permissionMappings)
        .innerJoin(schema.guilds, eq(schema.permissionMappings.guildId, schema.guilds.id))
        .where(
          and(
            eq(schema.guilds.adapterKey, input.adapterKey),
            eq(schema.guilds.externalId, input.guildExternalId),
            eq(schema.permissionMappings.permission, input.permission),
            inArray(schema.permissionMappings.externalRoleId, input.roleExternalIds)
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    /** Idempotent: granting an existing mapping returns the existing row. */
    async grant(input: {
      guildId: string;
      externalRoleId: string;
      permission: string;
    }): Promise<PermissionMappingRow> {
      const inserted = await db
        .insert(schema.permissionMappings)
        .values(input)
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) return inserted[0];
      const existing = await db
        .select()
        .from(schema.permissionMappings)
        .where(
          and(
            eq(schema.permissionMappings.guildId, input.guildId),
            eq(schema.permissionMappings.externalRoleId, input.externalRoleId),
            eq(schema.permissionMappings.permission, input.permission)
          )
        )
        .limit(1);
      if (!existing[0]) throw new Error('failed to grant permission');
      return existing[0];
    },

    async revoke(input: {
      guildId: string;
      externalRoleId: string;
      permission: string;
    }): Promise<void> {
      await db
        .delete(schema.permissionMappings)
        .where(
          and(
            eq(schema.permissionMappings.guildId, input.guildId),
            eq(schema.permissionMappings.externalRoleId, input.externalRoleId),
            eq(schema.permissionMappings.permission, input.permission)
          )
        );
    },

    async listForGuild(guildId: string): Promise<PermissionMappingRow[]> {
      return db
        .select()
        .from(schema.permissionMappings)
        .where(eq(schema.permissionMappings.guildId, guildId))
        .orderBy(schema.permissionMappings.permission, schema.permissionMappings.externalRoleId);
    },
  };
}

export type PermissionsRepo = ReturnType<typeof createPermissionsRepo>;
