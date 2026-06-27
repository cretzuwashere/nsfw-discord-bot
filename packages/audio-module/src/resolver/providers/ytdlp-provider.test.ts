import { createSilentLogger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveContext } from '../types.js';
import type { YtDlpRunner } from '../ytdlp-runner.js';
import { SpotifyAudioProvider } from './spotify-provider.js';
import { YtDlpAudioProvider } from './ytdlp-provider.js';

const ctx: ResolveContext = { allowedDomains: [], timeoutMs: 5000, logger: createSilentLogger() };

function fakeRunner(overrides: Partial<YtDlpRunner> = {}): YtDlpRunner {
  return {
    json: vi.fn(async () => ({})),
    flatPlaylist: vi.fn(async () => ({ entries: [] })),
    stream: vi.fn(() => Readable.from([Buffer.from('audio')])),
    available: vi.fn(async () => true),
    ...overrides,
  };
}

describe('YtDlpAudioProvider.canResolve', () => {
  const provider = new YtDlpAudioProvider(fakeRunner(), { maxTrackDurationSeconds: 3600 });

  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://music.youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://soundcloud.com/artist/track',
    'https://www.soundcloud.com/artist/track',
  ])('claims %s', (url) => {
    expect(provider.canResolve(new URL(url))).toBe(true);
  });

  it.each(['https://example.com/a.mp3', 'https://open.spotify.com/track/x', 'https://vimeo.com/1'])(
    'does not claim %s',
    (url) => {
      expect(provider.canResolve(new URL(url))).toBe(false);
    }
  );
});

describe('YtDlpAudioProvider.resolve', () => {
  let runner: YtDlpRunner;
  beforeEach(() => {
    runner = fakeRunner();
  });

  it('extracts metadata and enforces the duration limit lazily', async () => {
    runner.json = vi.fn(async () => ({
      title: 'Cool Song',
      duration: 200,
      uploader: 'Artist',
      webpage_url: 'https://www.youtube.com/watch?v=abc',
      extractor_key: 'Youtube',
    }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });

    const track = await provider.resolve('https://youtu.be/abc', ctx);
    expect(track.metadata).toMatchObject({
      title: 'Cool Song',
      provider: 'youtube',
      durationSeconds: 200,
    });
    // The download must NOT start during resolution.
    expect(runner.stream).not.toHaveBeenCalled();

    await track.source.createStream();
    expect(runner.stream).toHaveBeenCalledOnce();
  });

  it('rejects tracks over the duration limit before queueing', async () => {
    runner.json = vi.fn(async () => ({ title: 'Long', duration: 99999, webpage_url: 'u' }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });
    const error = await provider.resolve('https://youtu.be/abc', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('TRACK_TOO_LONG');
  });

  it('rejects live streams', async () => {
    runner.json = vi.fn(async () => ({ title: 'Live', is_live: true, webpage_url: 'u' }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });
    const error = await provider.resolve('https://youtu.be/abc', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).safeMessage).toMatch(/live/i);
  });

  it('labels SoundCloud correctly and tolerates missing duration', async () => {
    runner.json = vi.fn(async () => ({
      title: 'SC Track',
      webpage_url: 'https://soundcloud.com/a/b',
      extractor_key: 'Soundcloud',
    }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });
    const track = await provider.resolve('https://soundcloud.com/a/b', ctx);
    expect(track.metadata.provider).toBe('soundcloud');
    expect(track.metadata.durationSeconds).toBeUndefined();
  });

  it('allows over-limit tracks when the limit is 0 (unlimited)', async () => {
    runner.json = vi.fn(async () => ({ title: 'Long', duration: 99999, webpage_url: 'u' }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 0 });
    const track = await provider.resolve('https://youtu.be/abc', ctx);
    expect(track.metadata.durationSeconds).toBe(99999);
  });
});

describe('YtDlpAudioProvider.resolvePlaylist', () => {
  let runner: YtDlpRunner;
  beforeEach(() => {
    runner = fakeRunner();
  });

  it('expands entries into lazy tracks and reports totals', async () => {
    runner.flatPlaylist = vi.fn(async () => ({
      title: 'My Mix',
      entries: [
        { id: 'v1', title: 'One', duration: 100 },
        { id: 'v2', title: 'Two', duration: 200 },
      ],
    }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });
    const result = await provider.resolvePlaylist('https://youtube.com/playlist?list=PL', ctx, 100);

    expect(result.total).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.title).toBe('My Mix');
    expect(result.tracks.map((t) => t.metadata.title)).toEqual(['One', 'Two']);
    // Per-item streams must be lazy (no download during expansion).
    expect(runner.stream).not.toHaveBeenCalled();
    await result.tracks[0]!.source.createStream();
    expect(runner.stream).toHaveBeenCalledOnce();
  });

  it('skips unavailable entries and entries over the duration limit', async () => {
    runner.flatPlaylist = vi.fn(async () => ({
      entries: [
        { id: 'ok', title: 'Good', duration: 100 },
        { title: '[Private video]' },
        { id: 'priv', title: 'Hidden', availability: 'private' },
        { id: 'long', title: 'Too long', duration: 99999 },
      ],
    }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });
    const result = await provider.resolvePlaylist('https://youtube.com/playlist?list=PL', ctx, 100);

    expect(result.total).toBe(4);
    expect(result.skipped).toBe(3);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]!.metadata.title).toBe('Good');
  });

  it('caps the number of tracks at the limit but keeps skipped accurate', async () => {
    runner.flatPlaylist = vi.fn(async () => ({
      entries: [
        { id: 'a', title: 'A' },
        { title: '[Deleted video]' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
      ],
    }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });
    const result = await provider.resolvePlaylist('https://youtube.com/playlist?list=PL', ctx, 2);

    expect(result.total).toBe(4);
    expect(result.skipped).toBe(1);
    expect(result.tracks).toHaveLength(2); // capped; C is dropped as over-cap
  });

  it('handles an empty playlist', async () => {
    runner.flatPlaylist = vi.fn(async () => ({ entries: [] }));
    const provider = new YtDlpAudioProvider(runner, { maxTrackDurationSeconds: 3600 });
    const result = await provider.resolvePlaylist('https://youtube.com/playlist?list=PL', ctx, 100);
    expect(result.total).toBe(0);
    expect(result.tracks).toHaveLength(0);
  });
});

describe('SpotifyAudioProvider.canResolve', () => {
  const provider = new SpotifyAudioProvider(fakeRunner(), { maxTrackDurationSeconds: 3600 });
  it('claims single-track Spotify links only', () => {
    expect(provider.canResolve(new URL('https://open.spotify.com/track/abc123'))).toBe(true);
    expect(provider.canResolve(new URL('https://open.spotify.com/playlist/xyz'))).toBe(false);
    expect(provider.canResolve(new URL('https://open.spotify.com/album/xyz'))).toBe(false);
    expect(provider.canResolve(new URL('https://youtube.com/watch?v=a'))).toBe(false);
  });
});
