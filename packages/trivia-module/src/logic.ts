/** Pure trivia logic: non-repeating question selection + scheduling predicates. */

export type Rng = () => number;

export const RECENT_RING_CAP = 20;

/** Pick a question index avoiding `recent`; return the updated recent ring. */
export function pickQuestionIndex(
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

export function isRoundExpired(startedAt: Date, now: Date, timeoutSec: number): boolean {
  return now.getTime() - startedAt.getTime() >= timeoutSec * 1000;
}

export interface AutoState {
  autoEnabled: boolean;
  autoChannelId: string | null;
  autoIntervalMin: number;
  lastAutoAt: Date | null;
}

export function isAutoDue(s: AutoState, now: Date): boolean {
  if (!s.autoEnabled || !s.autoChannelId) return false;
  if (!s.lastAutoAt) return true;
  return now.getTime() - s.lastAutoAt.getTime() >= s.autoIntervalMin * 60_000;
}

export function clampInterval(min: number): number {
  if (!Number.isFinite(min)) return 360;
  return Math.max(5, Math.min(7 * 24 * 60, Math.trunc(min)));
}
