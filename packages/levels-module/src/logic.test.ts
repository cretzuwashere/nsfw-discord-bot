import { describe, expect, it } from 'vitest';
import { levelForXp, progressFor, rollXp, shouldAward, totalXpForLevel, xpToNext } from './logic.js';

describe('xp curve', () => {
  it('xpToNext increases with level', () => {
    expect(xpToNext(0)).toBe(100);
    expect(xpToNext(1)).toBeGreaterThan(xpToNext(0));
    expect(xpToNext(5)).toBeGreaterThan(xpToNext(4));
  });
  it('totalXpForLevel is monotonic and starts at 0', () => {
    expect(totalXpForLevel(0)).toBe(0);
    for (let l = 1; l < 50; l++) {
      expect(totalXpForLevel(l)).toBeGreaterThan(totalXpForLevel(l - 1));
    }
  });
  it('levelForXp round-trips against the thresholds', () => {
    for (let l = 0; l < 30; l++) {
      expect(levelForXp(totalXpForLevel(l))).toBe(l);
      if (l > 0) expect(levelForXp(totalXpForLevel(l) - 1)).toBe(l - 1);
    }
  });
  it('progressFor reports position within a level', () => {
    const p = progressFor(totalXpForLevel(3) + 10);
    expect(p.level).toBe(3);
    expect(p.intoLevel).toBe(10);
    expect(p.neededForLevel).toBe(xpToNext(3));
  });
});

describe('shouldAward', () => {
  it('always awards the first time', () => {
    expect(shouldAward(null, new Date(), 60)).toBe(true);
  });
  it('respects the cooldown window', () => {
    const now = new Date('2026-06-27T12:01:00Z');
    expect(shouldAward(new Date('2026-06-27T12:00:30Z'), now, 60)).toBe(false);
    expect(shouldAward(new Date('2026-06-27T12:00:00Z'), now, 60)).toBe(true);
  });
});

describe('rollXp', () => {
  it('stays within [min,max] inclusive', () => {
    expect(rollXp(15, 25, () => 0)).toBe(15);
    expect(rollXp(15, 25, () => 0.999)).toBe(25);
    expect(rollXp(25, 15, () => 0.5)).toBeGreaterThanOrEqual(15);
  });
});
