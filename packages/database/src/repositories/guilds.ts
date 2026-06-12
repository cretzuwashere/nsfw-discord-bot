import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { guildSettings, guilds } from '../schema.js';

export type GuildRow = typeof guilds.$inferSelect;
export type GuildSettingsRow = typeof guildSettings.$inferSelect;
export interface GuildWithSettings extends GuildRow {
  settings: GuildSettingsRow | null;
}

export function createGuildsRepo(db: Db) {
  return {
    async upsertByExternalId(input: {
      adapterKey: string;
      externalId: string;
      name?: string;
    }): Promise<GuildRow> {
      const rows = await db
        .insert(guilds)
        .values({
          adapterKey: input.adapterKey,
          externalId: input.externalId,
          name: input.name ?? '',
        })
        .onConflictDoUpdate({
          target: [guilds.adapterKey, guilds.externalId],
          set: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            updatedAt: sql`now()`,
          },
        })
        .returning();
      if (!rows[0]) throw new Error('failed to upsert guild');
      return rows[0];
    },

    async list(): Promise<GuildWithSettings[]> {
      const rows = await db
        .select()
        .from(guilds)
        .leftJoin(guildSettings, eq(guildSettings.guildId, guilds.id))
        .orderBy(guilds.createdAt);
      return rows.map((row) => ({ ...row.guilds, settings: row.guild_settings }));
    },

    async getById(id: string): Promise<GuildWithSettings | undefined> {
      const rows = await db
        .select()
        .from(guilds)
        .leftJoin(guildSettings, eq(guildSettings.guildId, guilds.id))
        .where(eq(guilds.id, id))
        .limit(1);
      const row = rows[0];
      return row ? { ...row.guilds, settings: row.guild_settings } : undefined;
    },

    async updateSettings(
      guildId: string,
      patch: Partial<{
        allowedAudioDomains: string[];
        maxQueueSize: number | null;
        maxTrackDurationSeconds: number | null;
        featureFlags: Record<string, boolean>;
      }>
    ): Promise<GuildSettingsRow> {
      const rows = await db
        .insert(guildSettings)
        .values({ guildId, ...patch })
        .onConflictDoUpdate({
          target: guildSettings.guildId,
          set: { ...patch, updatedAt: sql`now()` },
        })
        .returning();
      if (!rows[0]) throw new Error('failed to update guild settings');
      return rows[0];
    },
  };
}

export type GuildsRepo = ReturnType<typeof createGuildsRepo>;
