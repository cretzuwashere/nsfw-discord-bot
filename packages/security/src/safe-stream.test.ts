import { Readable } from 'node:stream';
import { UserFacingError } from '@botplatform/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('undici', () => ({
  request: vi.fn(),
  Agent: vi.fn().mockImplementation(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('./url-validation.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./url-validation.js')>();
  return { ...original, validateExternalUrl: vi.fn() };
});

import { request } from 'undici';
import { validateExternalUrl } from './url-validation.js';
import { openSafeHttpStream } from './safe-stream.js';

const mockedRequest = vi.mocked(request);
const mockedValidate = vi.mocked(validateExternalUrl);

function validationOk(url: string) {
  return { ok: true as const, url: new URL(url), resolvedAddresses: ['93.184.216.34'] };
}

function fakeResponse(input: {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}) {
  const body = Readable.from([Buffer.from(input.body ?? 'audio-bytes')]) as Readable & {
    dump?: () => Promise<void>;
  };
  return {
    statusCode: input.statusCode,
    headers: input.headers ?? {},
    body,
  } as unknown as Awaited<ReturnType<typeof request>>;
}

const OPTS = { allowedDomains: [] as string[] };

beforeEach(() => {
  mockedRequest.mockReset();
  mockedValidate.mockReset();
});

describe('openSafeHttpStream', () => {
  it('returns the body stream with metadata on a 200 audio response', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/track.mp3'));
    mockedRequest.mockResolvedValue(
      fakeResponse({
        statusCode: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '12345' },
      })
    );

    const result = await openSafeHttpStream('https://example.com/track.mp3', OPTS);

    expect(result.finalUrl).toBe('https://example.com/track.mp3');
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.contentLengthBytes).toBe(12345);
    expect(result.stream).toBeInstanceOf(Readable);
    expect(mockedValidate).toHaveBeenCalledTimes(1);
  });

  it('re-validates every redirect hop and follows it', async () => {
    mockedValidate
      .mockResolvedValueOnce(validationOk('https://example.com/start.mp3'))
      .mockResolvedValueOnce(validationOk('https://cdn.example.com/real.mp3'));
    mockedRequest
      .mockResolvedValueOnce(
        fakeResponse({
          statusCode: 302,
          headers: { location: 'https://cdn.example.com/real.mp3' },
        })
      )
      .mockResolvedValueOnce(
        fakeResponse({ statusCode: 200, headers: { 'content-type': 'audio/ogg' } })
      );

    const result = await openSafeHttpStream('https://example.com/start.mp3', OPTS);

    expect(result.finalUrl).toBe('https://cdn.example.com/real.mp3');
    expect(mockedValidate).toHaveBeenCalledTimes(2);
    expect(mockedValidate).toHaveBeenNthCalledWith(2, 'https://cdn.example.com/real.mp3', OPTS);
  });

  it('rejects when a redirect target fails validation', async () => {
    mockedValidate
      .mockResolvedValueOnce(validationOk('https://example.com/start.mp3'))
      .mockResolvedValueOnce({
        ok: false,
        code: 'URL_BLOCKED',
        reason: 'That link points to a private or internal address.',
      });
    mockedRequest.mockResolvedValueOnce(
      fakeResponse({ statusCode: 302, headers: { location: 'http://169.254.169.254/' } })
    );

    const error = await openSafeHttpStream('https://example.com/start.mp3', OPTS).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('URL_BLOCKED');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRedirects hops', async () => {
    mockedValidate.mockImplementation(async (url) => validationOk(url));
    mockedRequest.mockImplementation(async () =>
      fakeResponse({ statusCode: 302, headers: { location: 'https://example.com/loop.mp3' } })
    );

    const error = await openSafeHttpStream('https://example.com/a.mp3', {
      ...OPTS,
      maxRedirects: 3,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).safeMessage).toMatch(/redirect/i);
    expect(mockedRequest).toHaveBeenCalledTimes(4); // initial + 3 redirects
  });

  it('maps HTTP errors to a safe message containing the status', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/missing.mp3'));
    mockedRequest.mockResolvedValue(fakeResponse({ statusCode: 404 }));

    const error = await openSafeHttpStream('https://example.com/missing.mp3', OPTS).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).safeMessage).toContain('404');
  });

  it('rejects clearly-non-audio content types', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/page'));
    mockedRequest.mockResolvedValue(
      fakeResponse({ statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    );

    const error = await openSafeHttpStream('https://example.com/page', OPTS).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('URL_UNSUPPORTED');
  });

  it('accepts octet-stream and missing content types', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/blob'));
    mockedRequest.mockResolvedValue(
      fakeResponse({ statusCode: 200, headers: { 'content-type': 'application/octet-stream' } })
    );
    await expect(openSafeHttpStream('https://example.com/blob', OPTS)).resolves.toBeTruthy();

    mockedValidate.mockResolvedValue(validationOk('https://example.com/blob2'));
    mockedRequest.mockResolvedValue(fakeResponse({ statusCode: 200 }));
    await expect(openSafeHttpStream('https://example.com/blob2', OPTS)).resolves.toBeTruthy();
  });

  it('wraps network failures into a safe UserFacingError', async () => {
    mockedValidate.mockResolvedValue(validationOk('https://example.com/a.mp3'));
    mockedRequest.mockRejectedValue(new Error('ECONNRESET deep socket details'));

    const error = await openSafeHttpStream('https://example.com/a.mp3', OPTS).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).safeMessage).not.toContain('ECONNRESET');
  });

  it('fails when validation fails on the FIRST hop (no request made)', async () => {
    mockedValidate.mockResolvedValue({
      ok: false,
      code: 'URL_INVALID',
      reason: 'That is not a valid link.',
    });
    const error = await openSafeHttpStream('nonsense', OPTS).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
