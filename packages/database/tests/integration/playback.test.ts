import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { TrackSummary } from '@botplatform/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createPlaybackRepo,
  resolveTestDatabaseUrl,
  schema,
  type Database,
} from '../../src/index.js';

let database: Database;

const usedGuildIds: string[] = [];

function uniqueGuildId(): string {
  const id = `test-guild-${randomUUID()}`;
  usedGuildIds.push(id);
  return id;
}

function track(overrides: Partial<TrackSummary> = {}): TrackSummary {
  return {
    title: 'Test Track',
    url: `https://audio.example.com/${randomUUID()}.mp3`,
    provider: 'direct',
    requestedBy: 'tester',
    ...overrides,
  };
}

beforeAll(() => {
  database = createDatabase(resolveTestDatabaseUrl());
});

afterAll(async () => {
  if (usedGuildIds.length > 0) {
    await database.db
      .delete(schema.playbackHistory)
      .where(inArray(schema.playbackHistory.guildExternalId, usedGuildIds));
    await database.db
      .delete(schema.queueItems)
      .where(inArray(schema.queueItems.guildExternalId, usedGuildIds));
  }
  await database.close();
});

describe('playback history', () => {
  it('starts and finishes a successful history entry', async () => {
    const repo = createPlaybackRepo(database.db);
    const guildExternalId = uniqueGuildId();

    const id = await repo.startHistoryEntry({ guildExternalId, track: track() });
    expect(id).toBeGreaterThan(0);

    await repo.finishHistoryEntry(id, 'completed');

    const rows = await database.db
      .select()
      .from(schema.playbackHistory)
      .where(eq(schema.playbackHistory.id, id));
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.errorMessage).toBeNull();
    expect(rows[0]?.finishedAt).toBeInstanceOf(Date);
  });

  it('surfaces failed entries via listRecentErrors', async () => {
    const repo = createPlaybackRepo(database.db);
    const guildExternalId = uniqueGuildId();

    const id = await repo.startHistoryEntry({ guildExternalId, track: track() });
    await repo.finishHistoryEntry(id, 'failed', 'stream rejected by validator');

    const errors = await repo.listRecentErrors(100);
    const entry = errors.find((row) => row.id === id);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('failed');
    expect(entry?.errorMessage).toBe('stream rejected by validator');
  });
});

describe('queue snapshot', () => {
  it('replaceQueue/getQueue keeps tracks ordered by position', async () => {
    const repo = createPlaybackRepo(database.db);
    const guildExternalId = uniqueGuildId();
    const tracks = [
      track({ title: 'First' }),
      track({ title: 'Second', durationSeconds: 120 }),
      track({ title: 'Third' }),
    ];

    await repo.replaceQueue(guildExternalId, tracks);
    const queue = await repo.getQueue(guildExternalId);

    expect(queue.map((item) => item.title)).toEqual(['First', 'Second', 'Third']);
    expect(queue.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(queue[1]?.durationSeconds).toBe(120);

    // Replacing swaps the snapshot wholesale.
    await repo.replaceQueue(guildExternalId, [track({ title: 'Only' })]);
    const replaced = await repo.getQueue(guildExternalId);
    expect(replaced.map((item) => item.title)).toEqual(['Only']);
    expect(replaced[0]?.position).toBe(0);
  });

  it('clearQueue empties the snapshot', async () => {
    const repo = createPlaybackRepo(database.db);
    const guildExternalId = uniqueGuildId();

    await repo.replaceQueue(guildExternalId, [track(), track()]);
    await expect(repo.getQueue(guildExternalId)).resolves.toHaveLength(2);

    await repo.clearQueue(guildExternalId);
    await expect(repo.getQueue(guildExternalId)).resolves.toHaveLength(0);
  });
});
