/**
 * Pure leveling logic: the XP curve, level lookup, and the per-user award gate.
 * No IO — fully unit-testable with an injected rng.
 */

export type Rng = () => number;

/** XP required to go from `level` to `level + 1` (MEE6-style curve). */
export function xpToNext(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Cumulative XP required to reach `level` from 0. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNext(l);
  return total;
}

/** Highest level whose cumulative XP threshold is satisfied by `xp`. */
export function levelForXp(xp: number): number {
  let level = 0;
  while (totalXpForLevel(level + 1) <= xp) level++;
  return level;
}

export interface Progress {
  level: number;
  intoLevel: number;
  neededForLevel: number;
  xp: number;
}

export function progressFor(xp: number): Progress {
  const level = levelForXp(xp);
  const base = totalXpForLevel(level);
  const next = totalXpForLevel(level + 1);
  return { level, intoLevel: xp - base, neededForLevel: next - base, xp };
}

export function shouldAward(lastAwardAt: Date | null, now: Date, cooldownSeconds: number): boolean {
  if (!lastAwardAt) return true;
  return now.getTime() - lastAwardAt.getTime() >= cooldownSeconds * 1000;
}

export function rollXp(min: number, max: number, rng: Rng): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(rng() * (hi - lo + 1));
}
