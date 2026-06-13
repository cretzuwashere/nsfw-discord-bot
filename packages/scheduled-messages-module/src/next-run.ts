import { CronExpressionParser } from 'cron-parser';
import { DateTime } from 'luxon';

export type ScheduleType = 'once' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleConfig {
  /** For 'once': ISO datetime. */
  at?: string;
  /** For 'interval': seconds between sends (min enforced by MIN_INTERVAL_SECONDS). */
  intervalSeconds?: number;
  /** For daily/weekly/monthly: hour 0-23, minute 0-59. */
  hour?: number;
  minute?: number;
  /** For weekly: day of week 0(Sun)-6. */
  weekday?: number;
  /** For monthly: day of month 1-31. */
  day?: number;
  /** For cron: a standard 5-field cron expression. */
  expression?: string;
}

export const MIN_INTERVAL_SECONDS = 60;

/**
 * Compute the next run time strictly AFTER `from` for a schedule, in the
 * given IANA timezone. Returns null when the schedule has no future run
 * (a past one-off). Pure and timezone-aware (luxon + cron-parser).
 */
export function computeNextRun(
  type: ScheduleType,
  config: ScheduleConfig,
  timezone: string,
  from: Date
): Date | null {
  const zone = isValidZone(timezone) ? timezone : 'UTC';
  const now = DateTime.fromJSDate(from, { zone });

  switch (type) {
    case 'once': {
      if (!config.at) return null;
      const at = DateTime.fromISO(config.at, { zone });
      if (!at.isValid) return null;
      return at.toJSDate() > from ? at.toJSDate() : null;
    }
    case 'interval': {
      const seconds = Math.max(config.intervalSeconds ?? MIN_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS);
      return new Date(from.getTime() + seconds * 1000);
    }
    case 'daily': {
      const base = now.set({ hour: clamp(config.hour, 0, 23, 9), minute: clamp(config.minute, 0, 59, 0), second: 0, millisecond: 0 });
      return (base > now ? base : base.plus({ days: 1 })).toJSDate();
    }
    case 'weekly': {
      const targetWeekday = clamp(config.weekday, 0, 6, 1); // luxon weekday 1=Mon..7=Sun
      const luxonWeekday = targetWeekday === 0 ? 7 : targetWeekday;
      let base = now.set({ hour: clamp(config.hour, 0, 23, 9), minute: clamp(config.minute, 0, 59, 0), second: 0, millisecond: 0 });
      base = base.set({ weekday: luxonWeekday as 1 });
      if (base <= now) base = base.plus({ weeks: 1 });
      return base.toJSDate();
    }
    case 'monthly': {
      const day = clamp(config.day, 1, 28, 1); // cap at 28 to avoid skipping short months
      let base = now.set({ day, hour: clamp(config.hour, 0, 23, 9), minute: clamp(config.minute, 0, 59, 0), second: 0, millisecond: 0 });
      if (base <= now) base = base.plus({ months: 1 });
      return base.toJSDate();
    }
    case 'cron': {
      if (!config.expression) return null;
      try {
        const interval = CronExpressionParser.parse(config.expression, { currentDate: from, tz: zone });
        return interval.next().toDate();
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function isValidZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}
