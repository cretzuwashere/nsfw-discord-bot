import { createSilentLogger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@botplatform/security', async (importOriginal) => {
  const original = await importOriginal<typeof import('@botplatform/security')>();
  return { ...original, openSafeHttpStream: vi.fn() };
});

import { openSafeHttpStream } from '@botplatform/security';
import type { ResolveContext } from '../types.js';
import type { YtDlpRunner } from '../ytdlp-runner.js';
import { SpotifyAudioProvider } from './spotify-provider.js';

const mockedStream = vi.mocked(openSafeHttpStream);
const ctx: ResolveContext = { allowedDomains: [], timeoutMs: 5000, logger: createSilentLogger() };

function oembedResponse(json: unknown) {
  return {
    stream: Readable.from([Buffer.from(JSON.stringify(json))]),
    finalUrl: 'https://open.spotify.com/oembed',
    contentType: 'application/json',
    contentLengthBytes: undefined,
  };
}

function runner(searchResult: unknown): YtDlpRunner {
  return {
    json: vi.fn(async () => searchResult),
    flatPlaylist: vi.fn(async () => ({ entries: [] })),
    stream: vi.fn(() => Readable.from([Buffer.from('audio')])),
    available: vi.fn(async () => true),
  };
}

beforeEach(() => {
  mockedStream.mockReset();
});

describe('SpotifyAudioProvider.resolve', () => {
  it('reads the oEmbed title and plays the top YouTube match', async () => {
    mockedStream.mockResolvedValue(oembedResponse({ title: 'Blinding Lights - The Weeknd' }));
    const r = runner({
      entries: [
        { title: 'The Weeknd - Blinding Lights', duration: 200, webpage_url: 'https://youtu.be/x' },
      ],
    });
    const provider = new SpotifyAudioProvider(r, { maxTrackDurationSeconds: 3600 });

    const track = await provider.resolve('https://open.spotify.com/track/abc', ctx);
    expect(track.metadata.title).toBe('Blinding Lights - The Weeknd');
    expect(track.metadata.provider).toBe('spotify');
    expect(track.metadata.url).toBe('https://open.spotify.com/track/abc'); // original link shown

    // yt-dlp search was used with the title.
    const [searchArgs] = (r.json as ReturnType<typeof vi.fn>).mock.calls[0] as [string[]];
    expect(searchArgs.join(' ')).toContain('Blinding Lights');

    await track.source.createStream();
    expect(r.stream).toHaveBeenCalledWith(['-f', 'bestaudio/best', '-o', '-', '--', 'https://youtu.be/x']);
  });

  it('fails safely when the track cannot be read', async () => {
    mockedStream.mockResolvedValue(oembedResponse({}));
    const provider = new SpotifyAudioProvider(runner({ entries: [] }), {
      maxTrackDurationSeconds: 3600,
    });
    const error = await provider.resolve('https://open.spotify.com/track/abc', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
  });

  it('fails safely when no playable match is found', async () => {
    mockedStream.mockResolvedValue(oembedResponse({ title: 'Obscure Track' }));
    const provider = new SpotifyAudioProvider(runner({ entries: [] }), {
      maxTrackDurationSeconds: 3600,
    });
    const error = await provider.resolve('https://open.spotify.com/track/abc', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('AUDIO_RESOLVE_FAILED');
  });

  it('enforces the duration limit on the matched track', async () => {
    mockedStream.mockResolvedValue(oembedResponse({ title: 'Long Track' }));
    const provider = new SpotifyAudioProvider(
      runner({ entries: [{ title: 'x', duration: 99999, webpage_url: 'https://youtu.be/x' }] }),
      { maxTrackDurationSeconds: 600 }
    );
    const error = await provider.resolve('https://open.spotify.com/track/abc', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('TRACK_TOO_LONG');
  });
});
