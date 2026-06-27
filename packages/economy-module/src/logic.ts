/** Pure economy logic: transfer/purchase validation and daily-claim computation. */

export const MAX_AMOUNT = 1_000_000_000;

export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface Check {
  ok: boolean;
  error?: string;
}

export function validateAmount(amount: number): Check {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'Amount must be a positive whole number.' };
  if (amount > MAX_AMOUNT) return { ok: false, error: 'That amount is too large.' };
  return { ok: true };
}

export function validateTransfer(senderBalance: number, amount: number): Check {
  const a = validateAmount(amount);
  if (!a.ok) return a;
  if (senderBalance < amount) return { ok: false, error: 'You do not have enough to give that much.' };
  return { ok: true };
}

export function validatePurchase(balance: number, price: number): Check {
  if (!Number.isInteger(price) || price <= 0) return { ok: false, error: 'That item is not for sale.' };
  if (balance < price) return { ok: false, error: 'You cannot afford this item.' };
  return { ok: true };
}

export interface DailyConfig {
  dailyAmount: number;
  dailyStreakBonus: number;
  dailyStreakCap: number;
}

export interface DailyResult {
  canClaim: boolean;
  amount: number;
  newStreak: number;
}

/** Compute a /daily claim. Streak grows on consecutive UTC days, resets on a gap, capped for the bonus. */
export function computeDaily(
  now: Date,
  lastDailyDate: string | null,
  streak: number,
  cfg: DailyConfig
): DailyResult {
  const today = ymdUtc(now);
  if (lastDailyDate === today) return { canClaim: false, amount: 0, newStreak: streak };
  const yesterday = ymdUtc(new Date(now.getTime() - 86_400_000));
  const newStreak = lastDailyDate === yesterday ? streak + 1 : 1;
  const cap = Math.max(1, cfg.dailyStreakCap);
  const effective = Math.min(newStreak, cap);
  const amount = cfg.dailyAmount + (effective - 1) * cfg.dailyStreakBonus;
  return { canClaim: true, amount, newStreak };
}
