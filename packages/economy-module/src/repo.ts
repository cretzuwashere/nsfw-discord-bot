import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type EconomyAccountRow = typeof schema.economyAccounts.$inferSelect;
export type EconomySettingsRow = typeof schema.economySettings.$inferSelect;
export type ShopItemRow = typeof schema.shopItems.$inferSelect;

export interface EconomyConfigInput {
  currencyName?: string;
  currencyEmoji?: string;
  startingBalance?: number;
  dailyAmount?: number;
  dailyStreakBonus?: number;
  dailyStreakCap?: number;
}

export function createEconomyRepo(db: Db) {
  const acc = schema.economyAccounts;
  const txns = schema.economyTransactions;
  const cfg = schema.economySettings;
  const items = schema.shopItems;
  const purchases = schema.shopPurchases;

  async function ensureAccount(guildId: string, userExternalId: string, startingBalance: number): Promise<EconomyAccountRow> {
    await db
      .insert(acc)
      .values({ guildId, userExternalId, balance: startingBalance })
      .onConflictDoNothing();
    const rows = await db
      .select()
      .from(acc)
      .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)))
      .limit(1);
    if (!rows[0]) throw new Error('failed to ensure economy account');
    return rows[0];
  }

  return {
    ensureAccount,

    async getBalance(guildId: string, userExternalId: string, startingBalance: number): Promise<number> {
      const account = await ensureAccount(guildId, userExternalId, startingBalance);
      return account.balance;
    },

    async getAccount(guildId: string, userExternalId: string): Promise<EconomyAccountRow | undefined> {
      const rows = await db
        .select()
        .from(acc)
        .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)))
        .limit(1);
      return rows[0];
    },

    async topBalances(guildId: string, limit: number, offset: number): Promise<EconomyAccountRow[]> {
      return db
        .select()
        .from(acc)
        .where(eq(acc.guildId, guildId))
        .orderBy(desc(acc.balance))
        .limit(limit)
        .offset(offset);
    },

    async countAccounts(guildId: string): Promise<number> {
      const rows = await db
        .select({ v: sql<number>`count(*)::int` })
        .from(acc)
        .where(eq(acc.guildId, guildId));
      return rows[0]?.v ?? 0;
    },

    /** Admin grant/take. Clamps balance at 0; records the actual delta applied. */
    async applyDelta(
      guildId: string,
      userExternalId: string,
      delta: number,
      reason: string,
      startingBalance: number
    ): Promise<number> {
      return db.transaction(async (tx) => {
        await tx.insert(acc).values({ guildId, userExternalId, balance: startingBalance }).onConflictDoNothing();
        const rows = await tx
          .select()
          .from(acc)
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)))
          .limit(1);
        const current = rows[0]?.balance ?? startingBalance;
        const next = Math.max(0, current + delta);
        const actual = next - current;
        await tx
          .update(acc)
          .set({ balance: next, updatedAt: new Date() })
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)));
        if (actual !== 0) await tx.insert(txns).values({ guildId, userExternalId, delta: actual, reason });
        return next;
      });
    },

    /** Atomic conditional debit: only succeeds if the balance covers the amount. */
    async tryDebit(
      guildId: string,
      userExternalId: string,
      amount: number,
      reason: string,
      startingBalance: number
    ): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.insert(acc).values({ guildId, userExternalId, balance: startingBalance }).onConflictDoNothing();
        const rows = await tx
          .select()
          .from(acc)
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)))
          .limit(1);
        const current = rows[0]?.balance ?? 0;
        if (current < amount) return false;
        await tx
          .update(acc)
          .set({ balance: current - amount, updatedAt: new Date() })
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)));
        await tx.insert(txns).values({ guildId, userExternalId, delta: -amount, reason });
        return true;
      });
    },

    /** Atomic transfer between two members. Returns false on insufficient funds. */
    async transfer(
      guildId: string,
      from: string,
      to: string,
      amount: number,
      startingBalance: number
    ): Promise<boolean> {
      return db.transaction(async (tx) => {
        for (const u of [from, to]) {
          await tx.insert(acc).values({ guildId, userExternalId: u, balance: startingBalance }).onConflictDoNothing();
        }
        const rows = await tx
          .select()
          .from(acc)
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, from)))
          .limit(1);
        if (!rows[0] || rows[0].balance < amount) return false;
        await tx
          .update(acc)
          .set({ balance: sql`${acc.balance} - ${amount}`, updatedAt: new Date() })
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, from)));
        await tx
          .update(acc)
          .set({ balance: sql`${acc.balance} + ${amount}`, updatedAt: new Date() })
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, to)));
        await tx.insert(txns).values([
          { guildId, userExternalId: from, delta: -amount, reason: 'transfer out' },
          { guildId, userExternalId: to, delta: amount, reason: 'transfer in' },
        ]);
        return true;
      });
    },

    /** Claim daily: credit + set streak/date atomically. Returns false if already claimed today. */
    async claimDaily(
      guildId: string,
      userExternalId: string,
      amount: number,
      newStreak: number,
      date: string,
      startingBalance: number
    ): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.insert(acc).values({ guildId, userExternalId, balance: startingBalance }).onConflictDoNothing();
        const rows = await tx
          .select()
          .from(acc)
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)))
          .limit(1);
        if (rows[0]?.lastDailyDate === date) return false;
        await tx
          .update(acc)
          .set({ balance: sql`${acc.balance} + ${amount}`, lastDailyDate: date, streak: newStreak, updatedAt: new Date() })
          .where(and(eq(acc.guildId, guildId), eq(acc.userExternalId, userExternalId)));
        await tx.insert(txns).values({ guildId, userExternalId, delta: amount, reason: 'daily' });
        return true;
      });
    },

    // --- settings ---
    async getSettings(guildId: string): Promise<EconomySettingsRow | undefined> {
      const rows = await db.select().from(cfg).where(eq(cfg.guildId, guildId)).limit(1);
      return rows[0];
    },
    async ensureSettings(guildId: string): Promise<EconomySettingsRow> {
      await db.insert(cfg).values({ guildId }).onConflictDoNothing();
      const rows = await db.select().from(cfg).where(eq(cfg.guildId, guildId)).limit(1);
      if (!rows[0]) throw new Error('failed to ensure economy settings');
      return rows[0];
    },
    async setConfig(guildId: string, patch: EconomyConfigInput): Promise<void> {
      await db
        .insert(cfg)
        .values({ guildId, ...patch })
        .onConflictDoUpdate({ target: cfg.guildId, set: { ...patch, updatedAt: new Date() } });
    },

    // --- shop ---
    async addItem(guildId: string, roleId: string, label: string, price: number): Promise<ShopItemRow> {
      const rows = await db.insert(items).values({ guildId, roleId, label, price }).returning();
      if (!rows[0]) throw new Error('failed to add shop item');
      return rows[0];
    },
    async listActiveItems(guildId: string): Promise<ShopItemRow[]> {
      return db
        .select()
        .from(items)
        .where(and(eq(items.guildId, guildId), eq(items.active, true)))
        .orderBy(items.price)
        .limit(100);
    },
    async findItemByShortId(guildId: string, shortId: string): Promise<ShopItemRow | undefined> {
      const rows = await db.select().from(items).where(eq(items.guildId, guildId)).limit(200);
      return rows.find((r) => r.id === shortId || r.id.startsWith(shortId));
    },
    async deactivateItem(id: string): Promise<void> {
      await db.update(items).set({ active: false }).where(eq(items.id, id));
    },
    async recordPurchase(guildId: string, userExternalId: string, itemId: string, pricePaid: number): Promise<void> {
      await db.insert(purchases).values({ guildId, userExternalId, itemId, pricePaid });
    },
  };
}

export type EconomyRepo = ReturnType<typeof createEconomyRepo>;
