import type { ComponentInteractionEvent } from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import type { QueueSnapshot } from '@botplatform/shared';
import { describe, expect, it } from 'vitest';
import { PlayerManager } from './engine/manager.js';
import {
  buildMixComponentHandler,
  buildMixPanel,
  mixButtonId,
  parseMixButton,
} from './mix-panel.js';
import { fakeTrack, FakeVoiceSession } from './testing/fakes.js';

describe('mix button ids', () => {
  it('round-trips add and clear', () => {
    expect(parseMixButton(mixButtonId('add', 5))).toEqual({ action: 'add', n: 5 });
    expect(parseMixButton(mixButtonId('add', 'all'))).toEqual({ action: 'add', n: 'all' });
    expect(parseMixButton(mixButtonId('clear'))).toEqual({ action: 'clear' });
  });

  it('ignores foreign and malformed ids', () => {
    expect(parseMixButton('audio:pause')).toBeNull();
    expect(parseMixButton('mix:add:0')).toBeNull();
    expect(parseMixButton('mix:add:-3')).toBeNull();
    expect(parseMixButton('mix:bogus')).toBeNull();
  });
});

const SNAPSHOT: QueueSnapshot = {
  guildId: 'guild-1',
  status: 'playing',
  nowPlaying: { title: 'Seed', url: 'u', provider: 'youtube' },
  queue: [],
  maxQueueSize: 50,
};

describe('buildMixPanel', () => {
  it('shows add buttons when tracks remain', () => {
    const panel = buildMixPanel(SNAPSHOT, { title: 'Mix', note: 'Queued 10.', remaining: 12 });
    expect(panel.buttons?.some((b) => b.customId === mixButtonId('add', 5))).toBe(true);
    expect(panel.buttons?.some((b) => b.customId === mixButtonId('add', 'all'))).toBe(true);
    expect(panel.buttons?.some((b) => b.customId === 'mix:clear')).toBe(true);
  });

  it('hides add buttons when nothing is buffered, keeps clear', () => {
    const panel = buildMixPanel(SNAPSHOT, { title: 'Mix', note: 'Done.', remaining: 0 });
    expect(panel.buttons?.some((b) => b.customId?.startsWith('mix:add'))).toBe(false);
    expect(panel.buttons?.some((b) => b.customId === 'mix:clear')).toBe(true);
  });

  it('shows a remove button only when the queue has upcoming tracks', () => {
    const withQueue: QueueSnapshot = { ...SNAPSHOT, queue: [{ title: 'q', url: 'u', provider: 'p' }] };
    expect(
      buildMixPanel(withQueue, { title: 'Mix', note: '', remaining: 5 }).buttons?.some(
        (b) => b.customId === mixButtonId('remove', 5)
      )
    ).toBe(true);
    expect(
      buildMixPanel(SNAPSHOT, { title: 'Mix', note: '', remaining: 5 }).buttons?.some((b) =>
        b.customId?.startsWith('mix:remove')
      )
    ).toBe(false);
  });
});

function makeEvent(
  customId: string
): ComponentInteractionEvent & { replies: string[]; updates: unknown[] } {
  const replies: string[] = [];
  const updates: unknown[] = [];
  return {
    type: 'component.interaction',
    adapterKey: 'test',
    guild: { id: null, externalId: 'guild-1', name: 'Guild' },
    channelId: 'text-1',
    customId,
    values: [],
    user: { externalId: 'u1', username: 'tester', displayName: 'Tester' },
    userRoleIds: [],
    reply: async (content: string) => {
      replies.push(content);
    },
    update: async (message) => {
      updates.push(message);
    },
    replies,
    updates,
  };
}

describe('buildMixComponentHandler', () => {
  function makeManager() {
    return new PlayerManager(
      { maxQueueSize: 50, maxTrackDurationSeconds: 3600 },
      null,
      createSilentLogger()
    );
  }

  it('adds buffered tracks to the queue and refreshes the panel', async () => {
    const manager = makeManager();
    const session = manager.ensureSession('guild-1', new FakeVoiceSession());
    await session.enqueueOrPlay(fakeTrack('seed'));
    session.setPendingMix([fakeTrack('a'), fakeTrack('b'), fakeTrack('c')], 'Mix');

    const handler = buildMixComponentHandler(manager);
    const event = makeEvent('mix:add:10'); // ask 10, only 3 buffered
    await handler(event);

    expect(session.getSnapshot().queue.map((t) => t.title)).toEqual(['a', 'b', 'c']);
    expect(session.pendingMixCount).toBe(0);
    expect(event.updates).toHaveLength(1);
  });

  it('clear empties the queue and the buffer', async () => {
    const manager = makeManager();
    const session = manager.ensureSession('guild-1', new FakeVoiceSession());
    await session.enqueueOrPlay(fakeTrack('seed'));
    await session.enqueueOrPlay(fakeTrack('q1')); // queued behind the seed
    session.setPendingMix([fakeTrack('a')], 'Mix');

    const handler = buildMixComponentHandler(manager);
    await handler(makeEvent('mix:clear'));

    expect(session.getSnapshot().queue).toHaveLength(0);
    expect(session.pendingMixCount).toBe(0);
  });

  it('remove pops the most-recently-queued tracks', async () => {
    const manager = makeManager();
    const session = manager.ensureSession('guild-1', new FakeVoiceSession());
    await session.enqueueOrPlay(fakeTrack('seed'));
    await session.enqueueOrPlay(fakeTrack('q1'));
    await session.enqueueOrPlay(fakeTrack('q2'));
    const handler = buildMixComponentHandler(manager);
    await handler(makeEvent('mix:remove:5'));
    expect(session.getSnapshot().queue).toHaveLength(0);
  });

  it('distinguishes a full queue from an empty buffer when add accepts nothing', async () => {
    const manager = new PlayerManager(
      { maxQueueSize: 1, maxTrackDurationSeconds: 3600 },
      null,
      createSilentLogger()
    );
    const session = manager.ensureSession('guild-1', new FakeVoiceSession());
    await session.enqueueOrPlay(fakeTrack('seed'));
    await session.enqueueOrPlay(fakeTrack('q1')); // queue now full (max 1)
    session.setPendingMix([fakeTrack('a'), fakeTrack('b')], 'Mix');

    const handler = buildMixComponentHandler(manager);
    const event = makeEvent('mix:add:5');
    await handler(event);

    expect(session.pendingMixCount).toBe(2); // nothing consumed
    const panel = event.updates[0] as { embed?: { description?: string } };
    expect(panel.embed?.description).toMatch(/queue is full/i);
  });

  it('ignores customIds it does not own', async () => {
    const handler = buildMixComponentHandler(makeManager());
    const event = makeEvent('audio:pause');
    await handler(event);
    expect(event.replies).toHaveLength(0);
    expect(event.updates).toHaveLength(0);
  });

  it('replies when there is no active session', async () => {
    const handler = buildMixComponentHandler(makeManager());
    const event = makeEvent('mix:add:5');
    await handler(event);
    expect(event.replies[0]).toMatch(/not playing/i);
  });
});
