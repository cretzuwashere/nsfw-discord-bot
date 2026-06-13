import { DateTime } from 'luxon';

/** Validate a month/day pair (year-independent; allows Feb 29). */
export function isValidMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= daysInMonth;
}

/** Compute age in whole years given a birth year and "today" date. */
export function computeAge(birthYear: number, month: number, day: number, today: DateTime): number | null {
  if (!birthYear || birthYear < 1900 || birthYear > today.year) return null;
  let age = today.year - birthYear;
  if (today.month < month || (today.month === month && today.day < day)) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Decide whether a guild should announce now: returns the YYYY-MM-DD "today"
 * key in the guild's timezone if the current local hour matches the
 * configured announce hour, else null. The caller dedups on this key.
 */
export function announcementDateKey(timezone: string, announceHour: number, now: Date): string | null {
  const zone = DateTime.local().setZone(timezone).isValid ? timezone : 'UTC';
  const local = DateTime.fromJSDate(now, { zone });
  if (local.hour !== clampHour(announceHour)) return null;
  return local.toFormat('yyyy-MM-dd');
}

/** Month/day of "today" in a timezone — for matching birthdays. */
export function localMonthDay(timezone: string, now: Date): { month: number; day: number; year: number } {
  const zone = DateTime.local().setZone(timezone).isValid ? timezone : 'UTC';
  const local = DateTime.fromJSDate(now, { zone });
  return { month: local.month, day: local.day, year: local.year };
}

function clampHour(hour: number): number {
  if (!Number.isInteger(hour)) return 9;
  return Math.min(Math.max(hour, 0), 23);
}
