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

  it('does not arm the duration watchdog when the limit is 0 (unlimited)', async () => {
    vi.useFakeTimers();
    const { session, voice } = makeSession({
      limits: { maxQueueSize: 5, maxTrackDurationSeconds: 0 },
    });
    await session.enqueueOrPlay(fakeTrack('multi-hour'));
    await vi.advanceTimersByTimeAsync(10_000_000); // ~2.7h
    expect(session.isActive).toBe(true);
    expect(voice.status).toBe('playing');
  });

  it('does not arm the watchdog for a live track even with a positive limit', async () => {
    vi.useFakeTimers();
    const { session } = makeSession({
      limits: { maxQueueSize: 5, maxTrackDurationSeconds: 5 },
    });
    await session.enqueueOrPlay({ ...fakeTrack('radio'), isLive: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.isActive).toBe(true);
  });

  describe('enqueueMany (playlists)', () => {
    it('plays the first and queues the rest when idle', async () => {
      const { session, voice } = makeSession();
      const result = await session.enqueueMany([fakeTrack('a'), fakeTrack('b'), fakeTrack('c')]);
      expect(result).toMatchObject({ startedPlaying: true, accepted: 3, rejected: 0 });
      expect(voice.playCalls).toHaveLength(1);
      expect(session.getSnapshot().nowPlaying?.title).toBe('a');
      expect(session.getSnapshot().queue.map((t) => t.title)).toEqual(['b', 'c']);
    });

    it('queues everything when already playing', async () => {
      const { session } = makeSession();
      await session.enqueueOrPlay(fakeTrack('current'));
      const result = await session.enqueueMany([fakeTrack('x'), fakeTrack('y')]);
      expect(result).toMatchObject({ startedPlaying: false, accepted: 2 });
      expect(session.getSnapshot().queue.map((t) => t.title)).toEqual(['x', 'y']);
    });

    it('drops items beyond the queue bound', async () => {
      const { session } = makeSession({
        limits: { maxQueueSize: 2, maxTrackDurationSeconds: 3600 },
      });
      const result = await session.enqueueMany([
        fakeTrack('a'),
        fakeTrack('b'),
        fakeTrack('c'),
        fakeTrack('d'),
      ]);
      expect(result.accepted).toBe(2);
      expect(result.rejected).toBe(2);
    });
  });

  describe('pending mix buffer', () => {
    it('moves up to n tracks into the queue and tracks the remainder', async () => {
      const { session } = makeSession();
      await session.enqueueOrPlay(fakeTrack('seed'));
      session.setPendingMix([fakeTrack('a'), fakeTrack('b'), fakeTrack('c')], 'Mix');
      expect(session.pendingMixCount).toBe(3);

      expect(session.addFromPendingMix(2)).toEqual({ added: 2, remaining: 1 });
      expect(session.getSnapshot().queue.map((t) => t.title)).toEqual(['a', 'b']);

      expect(session.addFromPendingMix(10)).toEqual({ added: 1, remaining: 0 });
      expect(session.pendingMixCount).toBe(0);
    });

    it('only removes from the buffer what the bounded queue accepted', async () => {
      const { session } = makeSession({
        limits: { maxQueueSize: 1, maxTrackDurationSeconds: 3600 },
      });
      await session.enqueueOrPlay(fakeTrack('seed'));
      session.setPendingMix([fakeTrack('a'), fakeTrack('b'), fakeTrack('c')], 'Mix');
      const result = session.addFromPendingMix(3); // queue holds only 1
      expect(result.added).toBe(1);
      expect(session.pendingMixCount).toBe(2);
    });

    it('stop() clears the pending mix', async () => {
      const { session } = makeSession();
      await session.enqueueOrPlay(fakeTrack('seed'));
      session.setPendingMix([fakeTrack('a')], 'Mix');
      session.stop();
      expect(session.pendingMixCount).toBe(0);
    });
  });

  describe('loop', () => {
    it('track loop replays the same track N times then advances', async () => {
      const { session, voice } = makeSession();
      await session.enqueueOrPlay(fakeTrack('A'));
      await session.enqueueOrPlay(fakeTrack('B'));
      session.setLoop('track', 2);

      voice.emitFinished();
      await vi.waitFor(() => expect(voice.playCalls).toHaveLength(2));
      expect(session.getSnapshot().nowPlaying?.title).toBe('A');

      voice.emitFinished();
      await vi.waitFor(() => expect(voice.playCalls).toHaveLength(3));
      expect(session.getSnapshot().nowPlaying?.title).toBe('A');

      voice.emitFinished();
      await vi.waitFor(() => expect(session.getSnapshot().nowPlaying?.title).toBe('B'));
      expect(session.getLoop().mode).toBe('off');
    });

    it('track loop forever keeps replaying the same track', async () => {
      const { session, voice } = makeSession();
      await session.enqueueOrPlay(fakeTrack('A'));
      session.setLoop('track', null);
      for (let i = 0; i < 4; i++) {
        voice.emitFinished();
        await vi.waitFor(() => expect(voice.playCalls).toHaveLength(i + 2));
      }
      expect(session.getSnapshot().nowPlaying?.title).toBe('A');
      expect(session.getLoop()).toEqual({ mode: 'track', remaining: null });
    });

    it('queue loop repeats the captured queue N times then stops', async () => {
      const { session, voice } = makeSession();
      await session.enqueueOrPlay(fakeTrack('A'));
      await session.enqueueOrPlay(fakeTrack('B'));
      session.setLoop('queue', 1);

      voice.emitFinished(); // A → B
      await vi.waitFor(() => expect(session.getSnapshot().nowPlaying?.title).toBe('B'));
      voice.emitFinished(); // queue empty → refill → A (last pass)
      await vi.waitFor(() => expect(session.getSnapshot().nowPlaying?.title).toBe('A'));
      voice.emitFinished(); // A → B
      await vi.waitFor(() => expect(session.getSnapshot().nowPlaying?.title).toBe('B'));
      voice.emitFinished(); // queue empty, no passes left → stop
      await vi.waitFor(() => expect(session.isActive).toBe(false));
    });

    it('queue loop forever cycles indefinitely', async () => {
      const { session, voice } = makeSession();
      await session.enqueueOrPlay(fakeTrack('A'));
      await session.enqueueOrPlay(fakeTrack('B'));
      session.setLoop('queue', null);
      const seen: Array<string | undefined> = [];
      for (let i = 0; i < 5; i++) {
        seen.push(session.getSnapshot().nowPlaying?.title);
        voice.emitFinished();
        await vi.waitFor(() => expect(session.isActive).toBe(true));
      }
      expect(seen).toEqual(['A', 'B', 'A', 'B', 'A']);
    });

    it('stop and clearQueue reset looping; snapshot exposes loop state', async () => {
      const { session } = makeSession();
      await session.enqueueOrPlay(fakeTrack('A'));
      expect(session.getSnapshot().loop).toBeUndefined();
      session.setLoop('queue', 3);
      expect(session.getSnapshot().loop).toEqual({ mode: 'queue', remaining: 3 });
      session.clearQueue();
      expect(session.getLoop().mode).toBe('off');
      session.setLoop('track', null);
      session.stop();
      expect(session.getLoop().mode).toBe('off');
    });

    it('skip ends a track loop instead of transferring it to the next track', async () => {
      const { session, voice } = makeSession();
      await session.enqueueOrPlay(fakeTrack('A'));
      await session.enqueueOrPlay(fakeTrack('B'));
      session.setLoop('track', null);
      await session.skip();
      expect(session.getSnapshot().nowPlaying?.title).toBe('B');
      expect(session.getLoop().mode).toBe('off');
      voice.emitFinished(); // B must NOT be replayed
      await vi.waitFor(() => expect(session.isActive).toBe(false));
    });

    it('drops stale loop state when reconnecting after a destroyed connection', async () => {
      const { session, voice } = makeSession();
      await session.enqueueOrPlay(fakeTrack('A'));
      session.setLoop('queue', null);
      voice.destroyed = true; // simulate an external disconnect
      session.attachVoice(new FakeVoiceSession());
      expect(session.getLoop().mode).toBe('off');
    });
  });

  describe('now-playing announce', () => {
    it('announces on track changes but not the initial play', async () => {
      const voice = new FakeVoiceSession();
      const announced: Array<string | undefined> = [];
      const session = new GuildPlaybackSession('guild-1', voice, LIMITS, null, createSilentLogger(), (
        _channelId,
        snap
      ) => announced.push(snap.nowPlaying?.title));
      session.setTextChannel('text-1');
      await session.enqueueOrPlay(fakeTrack('A'));
      await session.enqueueOrPlay(fakeTrack('B'));
      expect(announced).toEqual([]); // initial play replies itself
      voice.emitFinished();
      await vi.waitFor(() => expect(announced).toEqual(['B']));
    });

    it('does not announce when no text channel is set', async () => {
      const voice = new FakeVoiceSession();
      const announced: unknown[] = [];
      const session = new GuildPlaybackSession('guild-1', voice, LIMITS, null, createSilentLogger(), (
        _c,
        s
      ) => announced.push(s));
      await session.enqueueOrPlay(fakeTrack('A'));
      await session.enqueueOrPlay(fakeTrack('B'));
      voice.emitFinished();
      await vi.waitFor(() => expect(session.getSnapshot().nowPlaying?.title).toBe('B'));
      expect(announced).toEqual([]);
    });

    it('does not re-announce on a track-loop replay (same track)', async () => {
      const voice = new FakeVoiceSession();
      const announced: Array<string | undefined> = [];
      const session = new GuildPlaybackSession('guild-1', voice, LIMITS, null, createSilentLogger(), (
        _c,
        s
      ) => announced.push(s.nowPlaying?.title));
      session.setTextChannel('text-1');
      await session.enqueueOrPlay(fakeTrack('A'));
      session.setLoop('track', null);
      voice.emitFinished();
      await vi.waitFor(() => expect(voice.playCalls).toHaveLength(2));
      expect(announced).toEqual([]);
    });

    it('refreshes the panel to idle on stop', async () => {
      const voice = new FakeVoiceSession();
      const announced: Array<unknown> = [];
      const session = new GuildPlaybackSession('guild-1', voice, LIMITS, null, createSilentLogger(), (
        _c,
        s
      ) => announced.push(s.nowPlaying));
      session.setTextChannel('text-1');
      await session.enqueueOrPlay(fakeTrack('A'));
      session.stop();
      expect(announced).toEqual([null]);
    });
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
