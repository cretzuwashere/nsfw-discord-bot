/**
 * Pure server-stats logic: the in-memory activity accumulator, UTC date helpers,
 * and the weekly-recap-due predicate. No IO — fully unit-testable.
 */

export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive 'YYYY-MM-DD' start of a window of `days` days ending today (UTC). */
export function startOfWindowUtc(now: Date, days: number): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return ymdUtc(d);
}

export function clampDow(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(6, Math.trunc(n)));
}
export function clampHour(n: number): number {
  if (!Number.isFinite(n)) return 12;
  return Math.max(0, Math.min(23, Math.trunc(n)));
}

export interface RecapDueState {
  recapEnabled: boolean;
  recapChannelId: string | null;
  recapDow: number;
  recapHourUtc: number;
  lastRecapDate: string | null;
}

export function isRecapDue(s: RecapDueState, nowUtc: Date): boolean {
  if (!s.recapEnabled || !s.recapChannelId) return false;
  if (nowUtc.getUTCDay() !== s.recapDow) return false;
  if (nowUtc.getUTCHours() !== s.recapHourUtc) return false;
  return s.lastRecapDate !== ymdUtc(nowUtc);
}

interface Bucket {
  users: Map<string, number>;
  channels: Map<string, number>;
}

export interface DrainedGuild {
  guildExternalId: string;
  users: Array<[string, number]>;
  channels: Array<[string, number]>;
}

/**
 * Accumulates message counts in memory so a busy server is not one DB write per
 * message; a scheduler job periodically drains it into batched upserts.
 */
export class ActivityAccumulator {
  private readonly guilds = new Map<string, Bucket>();

  record(guildExternalId: string, userExternalId: string, channelId: string): void {
    let bucket = this.guilds.get(guildExternalId);
    if (!bucket) {
      bucket = { users: new Map(), channels: new Map() };
      this.guilds.set(guildExternalId, bucket);
    }
    bucket.users.set(userExternalId, (bucket.users.get(userExternalId) ?? 0) + 1);
    bucket.channels.set(channelId, (bucket.channels.get(channelId) ?? 0) + 1);
  }

  get size(): number {
    return this.guilds.size;
  }

  /** Returns the accumulated counts and clears the buffer. */
  drain(): DrainedGuild[] {
    const out: DrainedGuild[] = [];
    for (const [guildExternalId, bucket] of this.guilds) {
      out.push({
        guildExternalId,
        users: [...bucket.users.entries()],
        channels: [...bucket.channels.entries()],
      });
    }
    this.guilds.clear();
    return out;
  }
}
