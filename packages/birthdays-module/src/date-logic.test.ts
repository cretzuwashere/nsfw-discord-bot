import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { announcementDateKey, computeAge, isValidMonthDay, localMonthDay } from './date-logic.js';

describe('isValidMonthDay', () => {
  it('accepts valid dates incl. Feb 29', () => {
    expect(isValidMonthDay(1, 1)).toBe(true);
    expect(isValidMonthDay(2, 29)).toBe(true);
    expect(isValidMonthDay(12, 31)).toBe(true);
  });
  it('rejects invalid dates', () => {
    expect(isValidMonthDay(0, 1)).toBe(false);
    expect(isValidMonthDay(13, 1)).toBe(false);
    expect(isValidMonthDay(2, 30)).toBe(false);
    expect(isValidMonthDay(4, 31)).toBe(false);
    expect(isValidMonthDay(1, 0)).toBe(false);
  });
});

describe('computeAge', () => {
  const today = DateTime.fromISO('2026-06-13T12:00:00Z');
  it('computes age when the birthday has passed this year', () => {
    expect(computeAge(2000, 1, 1, today)).toBe(26);
  });
  it('subtracts a year when the birthday is still ahead', () => {
    expect(computeAge(2000, 12, 31, today)).toBe(25);
  });
  it('returns null for implausible years', () => {
    expect(computeAge(1800, 1, 1, today)).toBeNull();
    expect(computeAge(2030, 1, 1, today)).toBeNull();
  });
});

describe('announcementDateKey', () => {
  it('returns the date key only at the configured hour', () => {
    const at9 = new Date('2026-06-13T09:30:00Z');
    expect(announcementDateKey('UTC', 9, at9)).toBe('2026-06-13');
    const at10 = new Date('2026-06-13T10:30:00Z');
    expect(announcementDateKey('UTC', 9, at10)).toBeNull();
  });
  it('respects the timezone', () => {
    // 09:00 in Bucharest (UTC+3 in June) = 06:00 UTC.
    const at6utc = new Date('2026-06-13T06:30:00Z');
    expect(announcementDateKey('Europe/Bucharest', 9, at6utc)).toBe('2026-06-13');
  });
});

describe('localMonthDay', () => {
  it('returns the local month/day', () => {
    const result = localMonthDay('UTC', new Date('2026-06-13T12:00:00Z'));
    expect(result).toMatchObject({ month: 6, day: 13, year: 2026 });
  });
});
