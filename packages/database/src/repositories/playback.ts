import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { TrackSummary } from '@botplatform/shared';
import type { Db } from '../client.js';
import { playbackHistory, queueItems } from '../schema.js';

export type PlaybackHistoryRow = typeof playbackHistory.$inferSelect;
export type QueueItemRow = typeof queueItems.$inferSelect;
export type PlaybackStatusValue = PlaybackHistoryRow['status'];

export function createPlaybackRepo(db: Db) {
  return {
    async startHistoryEntry(input: {
      guildExternalId: string;
      track: TrackSummary;
    }): Promise<number> {
      const rows = await db
        .insert(playbackHistory)
        .values({
          guildExternalId: input.guildExternalId,
          url: input.track.url,
          title: input.track.title,
          provider: input.track.provider,
          requestedBy: input.track.requestedBy ?? '',
          status: 'playing',
        })
        .returning({ id: playbackHistory.id });
      return rows[0]?.id ?? -1;
    },

    async finishHistoryEntry(
      id: number,
      status: Exclude<PlaybackStatusValue, 'playing'>,
      errorMessage?: string
    ): Promise<void> {
      if (id < 0) return;
      await db
        .update(playbackHistory)
        .set({
          status,
          errorMessage: errorMessage ? errorMessage.slice(0, 500) : null,
          finishedAt: sql`now()`,
        })
        .where(eq(playbackHistory.id, id));
    },

    async listRecentHistory(limit = 20): Promise<PlaybackHistoryRow[]> {
      return db
        .select()
        .from(playbackHistory)
        .orderBy(desc(playbackHistory.startedAt))
        .limit(Math.min(limit, 100));
    },

    async listRecentErrors(limit = 20): Promise<PlaybackHistoryRow[]> {
      return db
        .select()
        .from(playbackHistory)
        .where(isNotNull(playbackHistory.errorMessage))
        .orderBy(desc(playbackHistory.startedAt))
        .limit(Math.min(limit, 100));
    },

    /** Persist a snapshot of the in-memory queue (best-effort mirror). */
    async replaceQueue(guildExternalId: string, tracks: TrackSummary[]): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.delete(queueItems).where(eq(queueItems.guildExternalId, guildExternalId));
        if (tracks.length > 0) {
          await tx.insert(queueItems).values(
            tracks.map((track, position) => ({
              guildExternalId,
              position,
              url: track.url,
              title: track.title,
              provider: track.provider,
              requestedBy: track.requestedBy ?? '',
              durationSeconds: track.durationSeconds ?? null,
            }))
          );
        }
      });
    },

    async getQueue(guildExternalId: string): Promise<QueueItemRow[]> {
      return db
        .select()
        .from(queueItems)
        .where(eq(queueItems.guildExternalId, guildExternalId))
        .orderBy(queueItems.position);
    },

    async clearQueue(guildExternalId: string): Promise<void> {
      await db.delete(queueItems).where(eq(queueItems.guildExternalId, guildExternalId));
    },
  };
}

export type PlaybackRepo = ReturnType<typeof createPlaybackRepo>;
