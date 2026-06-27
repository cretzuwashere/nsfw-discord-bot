/**
 * Pure giveaway logic: winner drawing, duration parsing, winner-count clamping.
 * No IO — fully unit-testable with an injected rng.
 */

export type Rng = () => number;

export const GIVEAWAY_LIMITS = {
  minWinners: 1,
  maxWinners: 20,
  minDurationSec: 10,
  maxDurationSec: 30 * 24 * 3600, // 30 days
};

export function clampWinners(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(GIVEAWAY_LIMITS.minWinners, Math.min(GIVEAWAY_LIMITS.maxWinners, Math.trunc(n)));
}

const DURATION_TOKEN = /(\d+)\s*(w|d|h|m|s)/gi;
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** Parse `30s`, `10m`, `2h`, `1d`, `1w`, or combos like `1d 6h`. Returns seconds or null. */
export function parseDuration(input: string): number | null {
  if (!input) return null;
  let total = 0;
  let matched = false;
  for (const m of input.toLowerCase().matchAll(DURATION_TOKEN)) {
    matched = true;
    total += Number.parseInt(m[1]!, 10) * (UNIT_SECONDS[m[2]!] ?? 0);
  }
  return matched ? total : null;
}

export function clampDuration(seconds: number): number {
  return Math.max(
    GIVEAWAY_LIMITS.minDurationSec,
    Math.min(GIVEAWAY_LIMITS.maxDurationSec, Math.trunc(seconds))
  );
}

/**
 * Draw up to `count` unique winners from the entrant ids using a partial
 * Fisher–Yates shuffle. Never returns duplicates; returns all entrants when
 * count >= entrants.
 */
export function drawWinners(entrantIds: string[], count: number, rng: Rng): string[] {
  const pool = [...entrantIds];
  const n = Math.min(Math.max(0, Math.trunc(count)), pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, n);
}
