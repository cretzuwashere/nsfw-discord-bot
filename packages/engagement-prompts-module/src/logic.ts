/**
 * Pure logic for engagement prompts: non-repeating selection, the daily-due
 * predicate, and a small per-user cooldown. No IO — fully unit-testable.
 */

export type Rng = () => number;

/** Max recent indices remembered per category (ring buffer to avoid repeats). */
export const RECENT_RING_CAP = 12;

/**
 * Pick an index in [0, len) avoiding `recent` where possible, and return the
 * updated recent ring. Falls back to the full range when everything is recent.
 */
export function pickIndex(
  len: number,
  recent: number[],
  rng: Rng
): { index: number; recent: number[] } {
  if (len <= 0) return { index: 0, recent };
  const avoid = new Set(recent);
  const available: number[] = [];
  for (let i = 0; i < len; i++) if (!avoid.has(i)) available.push(i);
  const pool = available.length > 0 ? available : Array.from({ length: len }, (_, i) => i);
  const index = pool[Math.floor(rng() * pool.length)]!;
  const cap = Math.min(RECENT_RING_CAP, Math.max(0, len - 1));
  const next = [...recent, index].slice(-cap);
  return { index, recent: next };
}

/** UTC calendar day, 'YYYY-MM-DD'. */
export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface QotdDueState {
  qotdEnabled: boolean;
  qotdChannelId: string | null;
  qotdHourUtc: number;
  lastQotdDate: string | null;
}

/** True when the daily QOTD should post now (enabled, channel set, right UTC hour, not yet today). */
export function isQotdDue(s: QotdDueState, nowUtc: Date): boolean {
  if (!s.qotdEnabled || !s.qotdChannelId) return false;
  if (nowUtc.getUTCHours() !== s.qotdHourUtc) return false;
  return s.lastQotdDate !== ymdUtc(nowUtc);
}

export function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 12;
  return Math.max(0, Math.min(23, Math.trunc(h)));
}

// --- per-user cooldown -----------------------------------------------------

export interface CooldownStore {
  last: Map<string, number>;
}
export function createCooldownStore(): CooldownStore {
  return { last: new Map<string, number>() };
}
export function hitCooldown(
  store: CooldownStore,
  key: string,
  windowMs: number,
  nowMs: number
): { ok: boolean; retryAfterMs: number } {
  const prev = store.last.get(key);
  if (prev !== undefined && nowMs - prev < windowMs) {
    return { ok: false, retryAfterMs: windowMs - (nowMs - prev) };
  }
  store.last.set(key, nowMs);
  return { ok: true, retryAfterMs: 0 };
}
