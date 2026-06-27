import { describe, expect, it } from 'vitest';
import { clampHour, hitCooldown, createCooldownStore, isQotdDue, pickIndex, ymdUtc } from './logic.js';
import { getBankLength, PROMPT_CATEGORIES, renderPrompt } from './banks.js';

const rng = (v: number) => () => v;

describe('pickIndex', () => {
  it('avoids recent indices', () => {
    const { index } = pickIndex(3, [0, 1], rng(0)); // only index 2 available → pool=[2]
    expect(index).toBe(2);
  });
  it('appends to the recent ring and caps it', () => {
    let recent: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = pickIndex(5, recent, rng(0.0));
      recent = r.recent;
    }
    expect(recent.length).toBeLessThanOrEqual(4); // cap = min(12, len-1)=4
  });
  it('falls back to full range when all are recent', () => {
    const { index } = pickIndex(2, [0, 1], rng(0.99));
    expect([0, 1]).toContain(index);
  });
  it('handles empty bank gracefully', () => {
    expect(pickIndex(0, [], rng(0)).index).toBe(0);
  });
});

describe('isQotdDue', () => {
  const at = (iso: string) => new Date(iso);
  it('is due at the configured UTC hour once per day', () => {
    const s = { qotdEnabled: true, qotdChannelId: 'c', qotdHourUtc: 12, lastQotdDate: null };
    expect(isQotdDue(s, at('2026-06-27T12:00:00Z'))).toBe(true);
  });
  it('is not due at the wrong hour', () => {
    const s = { qotdEnabled: true, qotdChannelId: 'c', qotdHourUtc: 12, lastQotdDate: null };
    expect(isQotdDue(s, at('2026-06-27T11:59:00Z'))).toBe(false);
  });
  it('is not due twice in the same day', () => {
    const s = { qotdEnabled: true, qotdChannelId: 'c', qotdHourUtc: 12, lastQotdDate: '2026-06-27' };
    expect(isQotdDue(s, at('2026-06-27T12:30:00Z'))).toBe(false);
  });
  it('requires enabled + channel', () => {
    expect(isQotdDue({ qotdEnabled: false, qotdChannelId: 'c', qotdHourUtc: 12, lastQotdDate: null }, at('2026-06-27T12:00:00Z'))).toBe(false);
    expect(isQotdDue({ qotdEnabled: true, qotdChannelId: null, qotdHourUtc: 12, lastQotdDate: null }, at('2026-06-27T12:00:00Z'))).toBe(false);
  });
});

describe('clampHour / ymdUtc', () => {
  it('clamps to 0..23', () => {
    expect(clampHour(-5)).toBe(0);
    expect(clampHour(30)).toBe(23);
    expect(clampHour(9)).toBe(9);
    expect(clampHour(NaN)).toBe(12);
  });
  it('formats UTC day', () => {
    expect(ymdUtc(new Date('2026-06-27T23:59:00Z'))).toBe('2026-06-27');
  });
});

describe('banks', () => {
  it('every category has content and renders in range', () => {
    for (const c of PROMPT_CATEGORIES) {
      const len = getBankLength(c);
      expect(len).toBeGreaterThan(0);
      expect(typeof renderPrompt(c, 0)).toBe('string');
      expect(renderPrompt(c, len - 1).length).toBeGreaterThan(0);
    }
  });
});

describe('cooldown', () => {
  it('blocks within window', () => {
    const s = createCooldownStore();
    expect(hitCooldown(s, 'u', 5000, 0).ok).toBe(true);
    expect(hitCooldown(s, 'u', 5000, 1000).ok).toBe(false);
    expect(hitCooldown(s, 'u', 5000, 6000).ok).toBe(true);
  });
});
