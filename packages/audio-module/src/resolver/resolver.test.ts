import { createSilentLogger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@botplatform/security', async (importOriginal) => {
  const original = await importOriginal<typeof import('@botplatform/security')>();
  return { ...original, validateExternalUrl: vi.fn(), openSafeHttpStream: vi.fn() };
});

import { openSafeHttpStream, validateExternalUrl } from '@botplatform/security';
import { DirectHttpAudioProvider } from './providers/direct-http.js';
import { AudioResolver } from './resolver.js';
import type { AudioProvider, ResolveContext } from './types.js';

const mockedValidate = vi.mocked(validateExternalUrl);
const mockedStream = vi.mocked(openSafeHttpStream);

const ctx: ResolveContext = {
  allowedDomains: [],
  timeoutMs: 5000,
  logger: createSilentLogger(),
};

function validationOk(url: string) {
  return { ok: true as const, url: new URL(url), resolvedAddresses: ['93.184.216.34'] };
}

beforeEach(() => {
  mockedValidate.mockReset();
  mockedStream.mockReset();
});

describe('AudioResolver', () => {
  it('maps validation failures to UserFacingError with the safe reason', async () => {
    mockedValidate.mockResolvedValue({
      ok: false,
      code: 'URL_BLOCKED',
      reason: 'That link points to a private or internal address.',
    });
    const resolver = new AudioResolver([new DirectHttpAudioProvider()]);

    const error = await resolver.resolve('http://10.0.0.1/a.mp3', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('URL_BLOCKED');
    expect((error as UserFacingError).safeMessage).toMatch(/private or internal/);
  });

  it('rejects when no provider claims the URL', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/a.mp3'));
    const noneProvider: AudioProvider = {
      key: 'never',
      canResolve: () => false,
      resolve: vi.fn(),
    };
    const resolver = new AudioResolver([noneProvider]);

    const error = await resolver.resolve('https://example.com/a.mp3', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('URL_UNSUPPORTED');
  });

  it('uses the FIRST provider that claims the URL', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/a.mp3'));
    const first: AudioProvider = {
      key: 'first',
      canResolve: () => true,
      resolve: vi.fn(async (rawUrl: string) => ({
        metadata: { title: 'from-first', url: rawUrl, provider: 'first' },
        source: {
          inputType: 'arbitrary' as const,
          metadata: { title: 'from-first', url: rawUrl, provider: 'first' },
          createStream: vi.fn(),
        },
      })),
    };
    const second: AudioProvider = { key: 'second', canResolve: () => true, resolve: vi.fn() };
    const resolver = new AudioResolver([first, second]);

    const track = await resolver.resolve('https://example.com/a.mp3', ctx);
    expect(track.metadata.provider).toBe('first');
    expect(second.resolve).not.toHaveBeenCalled();
  });

  it('wraps unexpected provider errors into a safe message', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/a.mp3'));
    const flaky: AudioProvider = {
      key: 'flaky',
      canResolve: () => true,
      resolve: vi.fn(async () => {
        throw new Error('ECONNRESET with juicy internals');
      }),
    };
    const resolver = new AudioResolver([flaky]);

    const error = await resolver.resolve('https://example.com/a.mp3', ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).safeMessage).not.toContain('ECONNRESET');
  });
});

describe('AudioResolver.resolvePlaylist', () => {
  it('routes to the first claiming provider that supports playlists', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://youtube.com/playlist?list=PL'));
    const playlistResult = { tracks: [], total: 0, skipped: 0 };
    const noPlaylist: AudioProvider = { key: 'np', canResolve: () => true, resolve: vi.fn() };
    const withPlaylist: AudioProvider = {
      key: 'yt',
      canResolve: () => true,
      resolve: vi.fn(),
      resolvePlaylist: vi.fn(async () => playlistResult),
    };
    const resolver = new AudioResolver([noPlaylist, withPlaylist]);

    const result = await resolver.resolvePlaylist('https://youtube.com/playlist?list=PL', ctx, 50);
    expect(result).toBe(playlistResult);
    expect(withPlaylist.resolvePlaylist).toHaveBeenCalledWith(
      'https://youtube.com/playlist?list=PL',
      ctx,
      50
    );
  });

  it('rejects when no provider supports playlists', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/a.mp3'));
    const resolver = new AudioResolver([new DirectHttpAudioProvider()]);
    const error = await resolver
      .resolvePlaylist('https://example.com/a.mp3', ctx, 50)
      .catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('URL_UNSUPPORTED');
  });
});

describe('DirectHttpAudioProvider', () => {
  it('claims any http(s) URL and derives the title from the path', async () => {
    const provider = new DirectHttpAudioProvider();
    expect(provider.canResolve(new URL('https://example.com/music/My%20Song.mp3'))).toBe(true);

    const track = await provider.resolve('https://example.com/music/My%20Song.mp3', ctx);
    expect(track.metadata.title).toBe('My Song.mp3');
    expect(track.metadata.provider).toBe('direct-http');
    expect(track.source.inputType).toBe('arbitrary');
  });

  it('falls back to the hostname when the path is empty', async () => {
    const provider = new DirectHttpAudioProvider();
    const track = await provider.resolve('https://stream.example.com/', ctx);
    expect(track.metadata.title).toBe('stream.example.com');
  });

  it('does NOT open the stream during resolution (laziness)', async () => {
    const provider = new DirectHttpAudioProvider();
    await provider.resolve('https://example.com/a.mp3', ctx);
    expect(mockedStream).not.toHaveBeenCalled();
  });

  it('opens the safe stream only when createStream is called', async () => {
    const { Readable } = await import('node:stream');
    mockedStream.mockResolvedValue({
      stream: Readable.from([Buffer.from('x')]),
      finalUrl: 'https://example.com/a.mp3',
      contentType: 'audio/mpeg',
      contentLengthBytes: 3,
    });
    const provider = new DirectHttpAudioProvider();
    const track = await provider.resolve('https://example.com/a.mp3', {
      ...ctx,
      allowedDomains: ['example.com'],
      timeoutMs: 1234,
    });
    await track.source.createStream();
    expect(mockedStream).toHaveBeenCalledWith('https://example.com/a.mp3', {
      allowedDomains: ['example.com'],
      timeoutMs: 1234,
      requireAudioContentType: true,
    });
  });
});
