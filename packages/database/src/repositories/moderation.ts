import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  moderationActions,
  moderationRules,
  platformUsers,
  warnings,
} from '../schema.js';

export type PlatformUserRow = typeof platformUsers.$inferSelect;
export type WarningRow = typeof warnings.$inferSelect;
export type ModerationActionRow = typeof moderationActions.$inferSelect;
export type ModerationRuleRow = typeof moderationRules.$inferSelect;
export type ModerationActionTypeValue = ModerationActionRow['actionType'];

export function createModerationRepo(db: Db) {
  return {
    async upsertPlatformUser(input: {
      adapterKey: string;
      externalId: string;
      username?: string;
    }): Promise<PlatformUserRow> {
      const rows = await db
        .insert(platformUsers)
        .values({
          adapterKey: input.adapterKey,
          externalId: input.externalId,
          username: input.username ?? '',
        })
        .onConflictDoUpdate({
          target: [platformUsers.adapterKey, platformUsers.externalId],
          set: {
            ...(input.username !== undefined ? { username: input.username } : {}),
            lastSeenAt: sql`now()`,
          },
        })
        .returning();
      if (!rows[0]) throw new Error('failed to upsert platform user');
      return rows[0];
    },

    async addWarning(input: {
      guildId: string;
      userId: string;
      moderatorId: string;
      reason: string;
    }): Promise<WarningRow> {
      const rows = await db.insert(warnings).values(input).returning();
      if (!rows[0]) throw new Error('failed to add warning');
      return rows[0];
    },

    async revokeWarning(id: string): Promise<void> {
      await db.update(warnings).set({ revokedAt: sql`now()` }).where(eq(warnings.id, id));
    },

    async listWarnings(limit = 50): Promise<WarningRow[]> {
      return db
        .select()
        .from(warnings)
        .orderBy(desc(warnings.createdAt))
        .limit(Math.min(limit, 200));
    },

    async addAction(input: {
      guildId: string;
      userId?: string | undefined;
      moderatorId: string;
      actionType: ModerationActionTypeValue;
      reason?: string;
      metadata?: Record<string, unknown>;
      expiresAt?: Date;
    }): Promise<ModerationActionRow> {
      const rows = await db
        .insert(moderationActions)
        .values({
          guildId: input.guildId,
          userId: input.userId ?? null,
          moderatorId: input.moderatorId,
          actionType: input.actionType,
          reason: input.reason ?? '',
          metadata: input.metadata ?? {},
          expiresAt: input.expiresAt ?? null,
        })
        .returning();
      if (!rows[0]) throw new Error('failed to add moderation action');
      return rows[0];
    },

    async listActions(limit = 50): Promise<ModerationActionRow[]> {
      return db
        .select()
        .from(moderationActions)
        .orderBy(desc(moderationActions.createdAt))
        .limit(Math.min(limit, 200));
    },

    async listRules(): Promise<ModerationRuleRow[]> {
      return db.select().from(moderationRules).orderBy(moderationRules.ruleType);
    },

    async upsertRule(input: {
      id?: string;
      guildId?: string | undefined;
      ruleType: string;
      name: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    }): Promise<ModerationRuleRow> {
      if (input.id) {
        const rows = await db
          .update(moderationRules)
          .set({
            name: input.name,
            config: input.config ?? {},
            enabled: input.enabled ?? false,
            updatedAt: sql`now()`,
          })
          .where(eq(moderationRules.id, input.id))
          .returning();
        if (!rows[0]) throw new Error('rule not found');
        return rows[0];
      }
      const rows = await db
        .insert(moderationRules)
        .values({
          guildId: input.guildId ?? null,
          ruleType: input.ruleType,
          name: input.name,
          config: input.config ?? {},
          enabled: input.enabled ?? false,
        })
        .returning();
      if (!rows[0]) throw new Error('failed to create rule');
      return rows[0];
    },

    async setRuleEnabled(id: string, enabled: boolean): Promise<void> {
      await db
        .update(moderationRules)
        .set({ enabled, updatedAt: sql`now()` })
        .where(eq(moderationRules.id, id));
    },
  };
}

export type ModerationRepo = ReturnType<typeof createModerationRepo>;
