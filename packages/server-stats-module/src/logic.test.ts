import { describe, expect, it } from 'vitest';
import {
  ActivityAccumulator,
  clampDow,
  clampHour,
  isRecapDue,
  startOfWindowUtc,
  ymdUtc,
} from './logic.js';

describe('ActivityAccumulator', () => {
  it('increments per user and per channel', () => {
    const acc = new ActivityAccumulator();
    acc.record('g1', 'u1', 'c1');
    acc.record('g1', 'u1', 'c1');
    acc.record('g1', 'u2', 'c2');
    const drained = acc.drain();
    expect(drained).toHaveLength(1);
    const g = drained[0]!;
    expect(new Map(g.users)).toEqual(new Map([['u1', 2], ['u2', 1]]));
    expect(new Map(g.channels)).toEqual(new Map([['c1', 2], ['c2', 1]]));
  });
  it('clears after drain', () => {
    const acc = new ActivityAccumulator();
    acc.record('g1', 'u1', 'c1');
    acc.drain();
    expect(acc.size).toBe(0);
    expect(acc.drain()).toEqual([]);
  });
  it('separates guilds', () => {
    const acc = new ActivityAccumulator();
    acc.record('g1', 'u1', 'c1');
    acc.record('g2', 'u1', 'c1');
    expect(acc.size).toBe(2);
  });
});

describe('date helpers', () => {
  it('ymdUtc', () => {
    expect(ymdUtc(new Date('2026-06-27T23:00:00Z'))).toBe('2026-06-27');
  });
  it('startOfWindowUtc is inclusive of N days', () => {
    expect(startOfWindowUtc(new Date('2026-06-27T00:00:00Z'), 7)).toBe('2026-06-21');
    expect(startOfWindowUtc(new Date('2026-06-27T00:00:00Z'), 1)).toBe('2026-06-27');
  });
});

describe('clamps', () => {
  it('clampDow 0..6', () => {
    expect(clampDow(-1)).toBe(0);
    expect(clampDow(9)).toBe(6);
    expect(clampDow(3)).toBe(3);
  });
  it('clampHour 0..23', () => {
    expect(clampHour(-1)).toBe(0);
    expect(clampHour(30)).toBe(23);
  });
});

describe('isRecapDue', () => {
  // 2026-06-29 is a Monday (getUTCDay()===1).
  const monday12 = new Date('2026-06-29T12:00:00Z');
  it('is due on the configured day+hour once', () => {
    expect(
      isRecapDue(
        { recapEnabled: true, recapChannelId: 'c', recapDow: 1, recapHourUtc: 12, lastRecapDate: null },
        monday12
      )
    ).toBe(true);
  });
  it('not due on the wrong day or hour', () => {
    expect(
      isRecapDue({ recapEnabled: true, recapChannelId: 'c', recapDow: 2, recapHourUtc: 12, lastRecapDate: null }, monday12)
    ).toBe(false);
    expect(
      isRecapDue({ recapEnabled: true, recapChannelId: 'c', recapDow: 1, recapHourUtc: 13, lastRecapDate: null }, monday12)
    ).toBe(false);
  });
  it('not due twice the same day, or when disabled/no channel', () => {
    expect(
      isRecapDue({ recapEnabled: true, recapChannelId: 'c', recapDow: 1, recapHourUtc: 12, lastRecapDate: '2026-06-29' }, monday12)
    ).toBe(false);
    expect(
      isRecapDue({ recapEnabled: false, recapChannelId: 'c', recapDow: 1, recapHourUtc: 12, lastRecapDate: null }, monday12)
    ).toBe(false);
    expect(
      isRecapDue({ recapEnabled: true, recapChannelId: null, recapDow: 1, recapHourUtc: 12, lastRecapDate: null }, monday12)
    ).toBe(false);
  });
});
