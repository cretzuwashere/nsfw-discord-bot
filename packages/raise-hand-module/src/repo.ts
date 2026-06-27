import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { schema, type Db } from '@botplatform/database';

export type SpeakerQueueRow = typeof schema.speakerQueues.$inferSelect;
export type SpeakerQueueEntryRow = typeof schema.speakerQueueEntries.$inferSelect;

/**
 * Persistence for the raise-hand feature. One `speaker_queues` row per
 * (guild, voice channel); `speaker_queue_entries` are the raised hands. All
 * ordering is `priority DESC, raised_at ASC`. State survives bot restarts.
 */
export function createSpeakerQueueRepo(db: Db) {
  const queues = schema.speakerQueues;
  const entries = schema.speakerQueueEntries;

  return {
    /** Upsert the queue for a (guild, voice channel); refreshes the cached name. */
    async getOrCreateQueue(
      guildId: string,
      voiceChannelId: string,
      voiceChannelName?: string
    ): Promise<SpeakerQueueRow> {
      const rows = await db
        .insert(queues)
        .values({ guildId, voiceChannelId, voiceChannelName: voiceChannelName ?? '' })
        .onConflictDoUpdate({
          target: [queues.guildId, queues.voiceChannelId],
          set: {
            ...(voiceChannelName ? { voiceChannelName } : {}),
            updatedAt: sql`now()`,
          },
        })
        .returning();
      if (!rows[0]) throw new Error('failed to upsert speaker queue');
      return rows[0];
    },

    async getQueue(guildId: string, voiceChannelId: string): Promise<SpeakerQueueRow | undefined> {
      const rows = await db
        .select()
        .from(queues)
        .where(and(eq(queues.guildId, guildId), eq(queues.voiceChannelId, voiceChannelId)))
        .limit(1);
      return rows[0];
    },

    async setPanel(queueId: string, panelChannelId: string, panelMessageId: string): Promise<void> {
      await db
        .update(queues)
        .set({
          panelChannelId,
          panelMessageId,
          announceChannelId: panelChannelId,
          updatedAt: sql`now()`,
        })
        .where(eq(queues.id, queueId));
    },

    /** Entries for a queue, front-to-back. Excludes `done` unless asked. */
    async listEntries(
      queueId: string,
      opts?: { includeDone?: boolean }
    ): Promise<SpeakerQueueEntryRow[]> {
      const where = opts?.includeDone
        ? eq(entries.queueId, queueId)
        : and(eq(entries.queueId, queueId), ne(entries.status, 'done'));
      return db
        .select()
        .from(entries)
        .where(where)
        .orderBy(desc(entries.priority), asc(entries.raisedAt));
    },

    /**
     * Idempotent raise-hand. Returns the user's live (non-done) entry plus
     * whether it was newly created. The partial unique index also guards races.
     */
    async addEntry(input: {
      queueId: string;
      userExternalId: string;
      displayName: string;
    }): Promise<{ entry: SpeakerQueueEntryRow; created: boolean }> {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.queueId, input.queueId),
              eq(entries.userExternalId, input.userExternalId),
              ne(entries.status, 'done')
            )
          )
          .limit(1);
        if (existing[0]) return { entry: existing[0], created: false };
        const rows = await tx
          .insert(entries)
          .values({
            queueId: input.queueId,
            userExternalId: input.userExternalId,
            displayName: input.displayName,
          })
          .returning();
        if (!rows[0]) throw new Error('failed to add speaker entry');
        return { entry: rows[0], created: true };
      });
    },

    /** Remove a user's live (non-done) entries. Returns the count removed. */
    async removeEntry(queueId: string, userExternalId: string): Promise<number> {
      const rows = await db
        .delete(entries)
        .where(
          and(
            eq(entries.queueId, queueId),
            eq(entries.userExternalId, userExternalId),
            ne(entries.status, 'done')
          )
        )
        .returning();
      return rows.length;
    },

    /** Wipe the whole queue (including `done` history). Returns count removed. */
    async clearQueue(queueId: string): Promise<number> {
      const rows = await db.delete(entries).where(eq(entries.queueId, queueId)).returning();
      return rows.length;
    },

    /**
     * Advance the queue: mark the current `active` speaker `done` and promote
     * the front `waiting` entry to `active`. Returns the new active entry, or
     * null when no one is waiting.
     */
    async advance(queueId: string): Promise<SpeakerQueueEntryRow | null> {
      return db.transaction(async (tx) => {
        await tx
          .update(entries)
          .set({ status: 'done' })
          .where(and(eq(entries.queueId, queueId), eq(entries.status, 'active')));
        const front = await tx
          .select()
          .from(entries)
          .where(and(eq(entries.queueId, queueId), eq(entries.status, 'waiting')))
          .orderBy(desc(entries.priority), asc(entries.raisedAt))
          .limit(1);
        const next = front[0];
        if (!next) return null;
        const updated = await tx
          .update(entries)
          .set({ status: 'active' })
          .where(eq(entries.id, next.id))
          .returning();
        return updated[0] ?? null;
      });
    },

    /**
     * Promote a waiting user to the front by giving them a priority above the
     * current maximum. Returns the updated entry, or null when the user is not
     * waiting in this queue.
     */
    async promote(queueId: string, userExternalId: string): Promise<SpeakerQueueEntryRow | null> {
      return db.transaction(async (tx) => {
        const waiting = await tx
          .select()
          .from(entries)
          .where(and(eq(entries.queueId, queueId), eq(entries.status, 'waiting')));
        const target = waiting.find((e) => e.userExternalId === userExternalId);
        if (!target) return null;
        const max = waiting.reduce((m, e) => Math.max(m, e.priority), 0);
        const updated = await tx
          .update(entries)
          .set({ priority: max + 1 })
          .where(eq(entries.id, target.id))
          .returning();
        return updated[0] ?? null;
      });
    },
  };
}

export type SpeakerQueueRepo = ReturnType<typeof createSpeakerQueueRepo>;
