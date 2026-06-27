import { describe, expect, it } from 'vitest';
import { computeDaily, validateAmount, validatePurchase, validateTransfer, ymdUtc } from './logic.js';

const CFG = { dailyAmount: 100, dailyStreakBonus: 10, dailyStreakCap: 30 };

describe('validateAmount / validateTransfer', () => {
  it('rejects non-positive / non-integer / huge', () => {
    expect(validateAmount(0).ok).toBe(false);
    expect(validateAmount(-5).ok).toBe(false);
    expect(validateAmount(1.5).ok).toBe(false);
    expect(validateAmount(2_000_000_000).ok).toBe(false);
    expect(validateAmount(50).ok).toBe(true);
  });
  it('checks balance for transfers', () => {
    expect(validateTransfer(100, 50).ok).toBe(true);
    expect(validateTransfer(40, 50).ok).toBe(false);
  });
});

describe('validatePurchase', () => {
  it('requires a positive price and enough balance', () => {
    expect(validatePurchase(100, 0).ok).toBe(false);
    expect(validatePurchase(100, 150).ok).toBe(false);
    expect(validatePurchase(200, 150).ok).toBe(true);
  });
});

describe('computeDaily', () => {
  const day = (s: string) => new Date(`${s}T08:00:00Z`);
  it('first claim → streak 1, base amount', () => {
    const r = computeDaily(day('2026-06-27'), null, 0, CFG);
    expect(r).toEqual({ canClaim: true, amount: 100, newStreak: 1 });
  });
  it('blocks a second claim the same day', () => {
    const r = computeDaily(day('2026-06-27'), '2026-06-27', 3, CFG);
    expect(r.canClaim).toBe(false);
  });
  it('consecutive day → streak + 1 and bonus', () => {
    const r = computeDaily(day('2026-06-27'), '2026-06-26', 2, CFG);
    expect(r.newStreak).toBe(3);
    expect(r.amount).toBe(100 + 2 * 10);
  });
  it('a gap resets the streak to 1', () => {
    const r = computeDaily(day('2026-06-27'), '2026-06-24', 9, CFG);
    expect(r.newStreak).toBe(1);
    expect(r.amount).toBe(100);
  });
  it('caps the bonus at the streak cap', () => {
    const r = computeDaily(day('2026-06-27'), '2026-06-26', 100, CFG);
    expect(r.newStreak).toBe(101);
    expect(r.amount).toBe(100 + (30 - 1) * 10); // capped at 30
  });
});

describe('ymdUtc', () => {
  it('formats UTC day', () => {
    expect(ymdUtc(new Date('2026-06-27T23:59:00Z'))).toBe('2026-06-27');
  });
});
