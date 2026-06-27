import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type LevelMemberRow = typeof schema.levelMembers.$inferSelect;
export type LevelSettingsRow = typeof schema.levelSettings.$inferSelect;
export type LevelRewardRow = typeof schema.levelRewards.$inferSelect;

export interface LevelConfigInput {
  enabled?: boolean;
  announceChannelId?: string | null;
  levelUpMessage?: string;
  noXpChannelIds?: string[];
  xpMin?: number;
  xpMax?: number;
  cooldownSeconds?: number;
}

export function createLevelsRepo(db: Db) {
  const m = schema.levelMembers;
  const r = schema.levelRewards;
  const s = schema.levelSettings;

  async function ensureMember(guildId: string, userExternalId: string): Promise<LevelMemberRow> {
    await db.insert(m).values({ guildId, userExternalId }).onConflictDoNothing();
    const rows = await db
      .select()
      .from(m)
      .where(and(eq(m.guildId, guildId), eq(m.userExternalId, userExternalId)))
      .limit(1);
    if (!rows[0]) throw new Error('failed to ensure level member');
    return rows[0];
  }

  return {
    ensureMember,

    async getMember(guildId: string, userExternalId: string): Promise<LevelMemberRow | undefined> {
      const rows = await db
        .select()
        .from(m)
        .where(and(eq(m.guildId, guildId), eq(m.userExternalId, userExternalId)))
        .limit(1);
      return rows[0];
    },

    /** Apply an XP award (sets absolute xp/level, bumps message count + lastAwardAt). */
    async applyAward(
      guildId: string,
      userExternalId: string,
      newXp: number,
      newLevel: number,
      now: Date
    ): Promise<void> {
      await db
        .update(m)
        .set({ xp: newXp, level: newLevel, messages: sql`${m.messages} + 1`, lastAwardAt: now })
        .where(and(eq(m.guildId, guildId), eq(m.userExternalId, userExternalId)));
    },

    async topByXp(guildId: string, limit: number, offset: number): Promise<LevelMemberRow[]> {
      return db
        .select()
        .from(m)
        .where(eq(m.guildId, guildId))
        .orderBy(desc(m.xp))
        .limit(limit)
        .offset(offset);
    },

    async countMembers(guildId: string): Promise<number> {
      const rows = await db.select({ v: sql<number>`count(*)::int` }).from(m).where(eq(m.guildId, guildId));
      return rows[0]?.v ?? 0;
    },

    async rankOf(guildId: string, xp: number): Promise<number> {
      const rows = await db
        .select({ v: sql<number>`count(*)::int` })
        .from(m)
        .where(and(eq(m.guildId, guildId), gt(m.xp, xp)));
      return (rows[0]?.v ?? 0) + 1;
    },

    // --- rewards ---
    async addReward(guildId: string, level: number, roleId: string): Promise<void> {
      await db
        .insert(r)
        .values({ guildId, level, roleId })
        .onConflictDoUpdate({ target: [r.guildId, r.level], set: { roleId } });
    },
    async removeReward(guildId: string, level: number): Promise<void> {
      await db.delete(r).where(and(eq(r.guildId, guildId), eq(r.level, level)));
    },
    async listRewards(guildId: string): Promise<LevelRewardRow[]> {
      return db.select().from(r).where(eq(r.guildId, guildId)).orderBy(r.level);
    },
    /** Reward roles for levels in (oldLevel, newLevel]. */
    async rewardsBetween(guildId: string, oldLevel: number, newLevel: number): Promise<LevelRewardRow[]> {
      const all = await db.select().from(r).where(eq(r.guildId, guildId));
      return all.filter((row) => row.level > oldLevel && row.level <= newLevel);
    },

    // --- settings ---
    async getSettings(guildId: string): Promise<LevelSettingsRow | undefined> {
      const rows = await db.select().from(s).where(eq(s.guildId, guildId)).limit(1);
      return rows[0];
    },
    async ensureSettings(guildId: string): Promise<LevelSettingsRow> {
      await db.insert(s).values({ guildId }).onConflictDoNothing();
      const rows = await db.select().from(s).where(eq(s.guildId, guildId)).limit(1);
      if (!rows[0]) throw new Error('failed to ensure level settings');
      return rows[0];
    },
    async setConfig(guildId: string, patch: LevelConfigInput): Promise<void> {
      await db
        .insert(s)
        .values({ guildId, ...patch })
        .onConflictDoUpdate({ target: s.guildId, set: { ...patch, updatedAt: new Date() } });
    },
  };
}

export type LevelsRepo = ReturnType<typeof createLevelsRepo>;
