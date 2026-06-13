import { describe, expect, it } from 'vitest';
import { computeNextRun, MIN_INTERVAL_SECONDS } from './next-run.js';

// A fixed reference instant: 2026-06-13T12:00:00Z (a Saturday).
const FROM = new Date('2026-06-13T12:00:00.000Z');

describe('computeNextRun', () => {
  it('once: returns the time when in the future, null when past', () => {
    expect(computeNextRun('once', { at: '2026-06-13T18:00:00Z' }, 'UTC', FROM)?.toISOString()).toBe(
      '2026-06-13T18:00:00.000Z'
    );
    expect(computeNextRun('once', { at: '2020-01-01T00:00:00Z' }, 'UTC', FROM)).toBeNull();
  });

  it('interval: enforces the minimum interval', () => {
    const next = computeNextRun('interval', { intervalSeconds: 5 }, 'UTC', FROM);
    expect(next?.getTime()).toBe(FROM.getTime() + MIN_INTERVAL_SECONDS * 1000);
  });

  it('daily: next occurrence of the configured time', () => {
    // 09:00 UTC already passed today (it is 12:00), so expect tomorrow.
    const next = computeNextRun('daily', { hour: 9, minute: 0 }, 'UTC', FROM);
    expect(next?.toISOString()).toBe('2026-06-14T09:00:00.000Z');
    // 18:00 today is still ahead.
    const later = computeNextRun('daily', { hour: 18, minute: 0 }, 'UTC', FROM);
    expect(later?.toISOString()).toBe('2026-06-13T18:00:00.000Z');
  });

  it('daily: respects timezone', () => {
    // 09:00 in New York (UTC-4 in June) = 13:00 UTC, still ahead of 12:00 UTC.
    const next = computeNextRun('daily', { hour: 9, minute: 0 }, 'America/New_York', FROM);
    expect(next?.toISOString()).toBe('2026-06-13T13:00:00.000Z');
  });

  it('weekly: advances to the configured weekday', () => {
    // Target Monday (1) 10:00 UTC; from Saturday → next Monday.
    const next = computeNextRun('weekly', { weekday: 1, hour: 10, minute: 0 }, 'UTC', FROM);
    expect(next?.toISOString()).toBe('2026-06-15T10:00:00.000Z');
  });

  it('monthly: next month-day occurrence', () => {
    const next = computeNextRun('monthly', { day: 1, hour: 0, minute: 0 }, 'UTC', FROM);
    expect(next?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('cron: parses standard expressions in the timezone', () => {
    // Every day at 15:00 UTC → today 15:00.
    const next = computeNextRun('cron', { expression: '0 15 * * *' }, 'UTC', FROM);
    expect(next?.toISOString()).toBe('2026-06-13T15:00:00.000Z');
  });

  it('cron: returns null for an invalid expression', () => {
    expect(computeNextRun('cron', { expression: 'not a cron' }, 'UTC', FROM)).toBeNull();
  });

  it('falls back to UTC for an invalid timezone', () => {
    const next = computeNextRun('daily', { hour: 18, minute: 0 }, 'Not/AZone', FROM);
    expect(next?.toISOString()).toBe('2026-06-13T18:00:00.000Z');
  });
});
