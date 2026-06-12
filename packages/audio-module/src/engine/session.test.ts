import { createSilentLogger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePlaybackRepo, fakeTrack, FakeVoiceSession } from '../testing/fakes.js';
import { GuildPlaybackSession } from './session.js';

const LIMITS = { maxQueueSize: 5, maxTrackDurationSeconds: 3600 };

function makeSession(options: { repo?: ReturnType<typeof fakePlaybackRepo> | null; limits?: typeof LIMITS } = {}) {
  const voice = new FakeVoiceSession();
  const repo = options.repo === undefined ? fakePlaybackRepo() : options.repo;
  const session = new GuildPlaybackSession(
    'guild-1',
    voice,
    options.limits ?? LIMITS,
    repo,
    createSilentLogger()
  );
  return { session, voice, repo };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GuildPlaybackSession', () => {
  it('plays immediately when idle and queues while busy', async () => {
    const { session, voice } = makeSession();
    expect(await session.enqueueOrPlay(fakeTrack('first'))).toEqual({ status: 'playing' });
    expect(voice.playCalls).toHaveLength(1);

    expect(await session.enqueueOrPlay(fakeTrack('second'))).toEqual({
      status: 'queued',
      position: 1,
    });
    expect(voice.playCalls).toHaveLength(1);
  });

  it('advances to the next track when one finishes, recording history', async () => {
    const { session, voice, repo } = makeSession();
    await session.enqueueOrPlay(fakeTrack('first'));
    await session.enqueueOrPlay(fakeTrack('second'));

    voice.emitFinished();
    await vi.waitFor(() => expect(voice.playCalls).toHaveLength(2));

    expect(repo?.history[0]).toMatchObject({ track: 'first', status: 'completed' });
    expect(repo?.history[1]).toMatchObject({ track: 'second', status: 'playing' });
  });

  it('skips errored tracks and keeps going', async () => {
    const { session, voice, repo } = makeSession();
    await session.enqueueOrPlay(fakeTrack('bad'));
    await session.enqueueOrPlay(fakeTrack('good'));

    voice.emitError(new Error('boom'));
    await vi.waitFor(() => expect(voice.playCalls).toHaveLength(2));

    expect(repo?.history[0]).toMatchObject({ track: 'bad', status: 'failed' });
    expect(repo?.history[0]?.errorMessage).not.toContain('boom'); // safe summary only
  });

  it('stops and clears after three consecutive failures', async () => {
    const { session, voice } = makeSession();
    await session.enqueueOrPlay(fakeTrack('t1'));
    for (const title of ['t2', 't3', 't4', 't5']) {
      await session.enqueueOrPlay(fakeTrack(title));
    }

    voice.emitError(new Error('e1'));
    await vi.waitFor(() => expect(voice.playCalls).toHaveLength(2));
    voice.emitError(new Error('e2'));
    await vi.waitFor(() => expect(voice.playCalls).toHaveLength(3));
    voice.emitError(new Error('e3'));

    // Third consecutive failure: no further playback, queue emptied.
    await vi.waitFor(() => {
      expect(session.isActive).toBe(false);
      expect(session.getSnapshot().queue).toHaveLength(0);
    });
    expect(voice.playCalls).toHaveLength(3);
  });

  it('skip() starts the next queued track and marks history as skipped', async () => {
    const { session, voice, repo } = makeSession();
    await session.enqueueOrPlay(fakeTrack('first'));
    await session.enqueueOrPlay(fakeTrack('second'));

    const result = await session.skip();
    expect(result).toMatchObject({ hadTrack: true, next: { title: 'second' } });
    expect(voice.playCalls).toHaveLength(2);
    expect(repo?.history[0]).toMatchObject({ track: 'first', status: 'skipped' });
  });

  it('skip() with an empty queue stops cleanly', async () => {
    const { session, voice } = makeSession();
    await session.enqueueOrPlay(fakeTrack('only'));
    const result = await session.skip();
    expect(result).toEqual({ hadTrack: true, next: null });
    expect(session.isActive).toBe(false);
    expect(voice.status).toBe('idle');
  });

  it('skip() when nothing is playing reports hadTrack false', async () => {
    const { session } = makeSession();
    expect(await session.skip()).toEqual({ hadTrack: false, next: null });
  });

  it('stop() clears the queue but keeps the voice connection', async () => {
    const { session, voice, repo } = makeSession();
    await session.enqueueOrPlay(fakeTrack('a'));
    await session.enqueueOrPlay(fakeTrack('b'));
    await session.enqueueOrPlay(fakeTrack('c'));

    const result = session.stop();
    expect(result).toEqual({ stoppedTrack: true, clearedCount: 2 });
    expect(voice.destroyed).toBe(false);
    expect(session.isActive).toBe(false);
    expect(repo?.history[0]).toMatchObject({ track: 'a', status: 'stopped' });
    // No spurious advance from the suppressed finish event.
    expect(voice.playCalls).toHaveLength(1);
  });

  it('pause/resume map to voice state correctly', async () => {
    const { session } = makeSession();
    expect(session.pause()).toBe('not-playing');
    await session.enqueueOrPlay(fakeTrack('a'));
    expect(session.pause()).toBe('paused');
    expect(session.pause()).toBe('already-paused');
    expect(session.resume()).toBe('resumed');
    expect(session.resume()).toBe('not-paused');
  });

  it('enforces the queue bound with a user-facing error', async () => {
    const { session } = makeSession({ limits: { maxQueueSize: 1, maxTrackDurationSeconds: 3600 } });
    await session.enqueueOrPlay(fakeTrack('playing'));
    await session.enqueueOrPlay(fakeTrack('queued'));
    const error = await session.enqueueOrPlay(fakeTrack('overflow')).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('QUEUE_FULL');
  });

  it('skips tracks that exceed the max duration', async () => {
    vi.useFakeTimers();
    const { session, voice, repo } = makeSession({
      limits: { maxQueueSize: 5, maxTrackDurationSeconds: 5 },
    });
    await session.enqueueOrPlay(fakeTrack('endless'));
    expect(voice.status).toBe('playing');

    await vi.advanceTimersByTimeAsync(5_100);

    expect(session.isActive).toBe(false);
    expect(repo?.history[0]).toMatchObject({ track: 'endless', status: 'skipped' });
  });

  it('snapshot reflects live state', async () => {
    const { session } = makeSession();
    await session.enqueueOrPlay(fakeTrack('current'));
    await session.enqueueOrPlay(fakeTrack('upcoming'));
    const snapshot = session.getSnapshot();
    expect(snapshot.guildId).toBe('guild-1');
    expect(snapshot.status).toBe('playing');
    expect(snapshot.nowPlaying?.title).toBe('current');
    expect(snapshot.queue.map((t) => t.title)).toEqual(['upcoming']);
    expect(snapshot.maxQueueSize).toBe(5);
  });

  it('keeps playing when the persistence layer throws', async () => {
    const { session, voice } = makeSession({ repo: fakePlaybackRepo({ throwing: true }) });
    await session.enqueueOrPlay(fakeTrack('a'));
    await session.enqueueOrPlay(fakeTrack('b'));
    voice.emitFinished();
    await vi.waitFor(() => expect(voice.playCalls).toHaveLength(2));
  });

  it('works with persistence disabled (null repo)', async () => {
    const { session, voice } = makeSession({ repo: null });
    await session.enqueueOrPlay(fakeTrack('a'));
    voice.emitFinished();
    expect(session.isActive).toBe(false);
  });

  it('destroy() releases the voice connection', async () => {
    const { session, voice } = makeSession();
    await session.enqueueOrPlay(fakeTrack('a'));
    await session.destroy();
    expect(voice.destroyed).toBe(true);
    expect(session.isActive).toBe(false);
  });
});
