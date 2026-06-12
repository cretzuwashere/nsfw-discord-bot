import { lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { UserFacingError } from '@botplatform/shared';
import { Agent, request } from 'undici';
import { isBlockedAddress, validateExternalUrl, type UrlValidationOptions } from './url-validation.js';

/**
 * SSRF-safe HTTP(S) streaming fetch for audio content.
 *
 * Defense layers:
 *  1. validateExternalUrl on EVERY hop (scheme/hostname/IP-range/DNS checks)
 *  2. a connection-time lookup guard on the undici Agent, so a DNS answer
 *     that changes between validation and connect (DNS rebinding) still
 *     cannot reach a private address
 *  3. manual redirect handling (maxRedirections: 0) so hops cannot escape
 *     re-validation
 */

export interface SafeStreamOptions extends UrlValidationOptions {
  /** Total time allowed for connection + response headers. Default 15000. */
  timeoutMs?: number;
  /** Idle timeout while reading the body. Default 30000. */
  bodyTimeoutMs?: number;
  /** Maximum redirect hops. Default 5. */
  maxRedirects?: number;
  /** Reject obviously-non-audio content types. Default true. */
  requireAudioContentType?: boolean;
}

export interface SafeStreamResult {
  stream: Readable;
  finalUrl: string;
  contentType: string | undefined;
  contentLengthBytes: number | undefined;
}

const FETCH_FAILED = 'That link could not be fetched.';
const NOT_AUDIO = 'That link does not point to an audio file.';

/**
 * dns.lookup wrapper that fails the connection when ANY resolved address is
 * in a blocked range. This runs at connect time — the rebinding guard.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 4);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0) {
      callback(new Error(`no addresses for ${hostname}`), '', 4);
      return;
    }
    if (list.some((entry) => isBlockedAddress(entry.address))) {
      callback(new Error('refusing to connect to a blocked address'), '', 4);
      return;
    }
    if (options.all) {
      // The cast mirrors Node's own overloaded callback signature.
      (callback as unknown as (e: Error | null, a: typeof list) => void)(null, list);
      return;
    }
    const first = list[0];
    if (!first) {
      callback(new Error(`no addresses for ${hostname}`), '', 4);
      return;
    }
    callback(null, first.address, first.family);
  });
};

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isAcceptableAudioContentType(contentType: string | undefined): boolean {
  if (!contentType) return true; // many file CDNs omit it — ffmpeg will sniff
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === '') return true;
  return (
    type.startsWith('audio/') ||
    type.startsWith('video/') ||
    type === 'application/ogg' ||
    type === 'application/octet-stream' ||
    type === 'binary/octet-stream'
  );
}

export async function openSafeHttpStream(
  rawUrl: string,
  options: SafeStreamOptions
): Promise<SafeStreamResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const requireAudio = options.requireAudioContentType ?? true;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validation = await validateExternalUrl(currentUrl, options);
    if (!validation.ok) {
      throw new UserFacingError(validation.code, validation.reason);
    }

    // undici does not follow redirects by default — every hop comes back to
    // this loop and gets re-validated.
    const agent = new Agent({
      connect: { lookup: guardedLookup, timeout: timeoutMs },
      headersTimeout: timeoutMs,
      bodyTimeout: bodyTimeoutMs,
    });
    const closeAgent = () => {
      void agent.close().catch(() => {});
    };

    let response: Awaited<ReturnType<typeof request>>;
    try {
      response = await request(validation.url, {
        method: 'GET',
        dispatcher: agent,
        headers: { 'user-agent': 'botplatform-audio/1.0', accept: '*/*' },
      });
    } catch (error) {
      closeAgent();
      throw new UserFacingError('AUDIO_RESOLVE_FAILED', FETCH_FAILED, { cause: error });
    }

    const status = response.statusCode;

    if (status >= 300 && status < 400) {
      const location = headerValue(response.headers['location']);
      response.body.destroy();
      closeAgent();
      if (!location) {
        throw new UserFacingError('AUDIO_RESOLVE_FAILED', FETCH_FAILED);
      }
      try {
        currentUrl = new URL(location, validation.url).toString();
      } catch {
        throw new UserFacingError('AUDIO_RESOLVE_FAILED', FETCH_FAILED);
      }
      continue; // next hop re-validates
    }

    if (status >= 400) {
      response.body.destroy();
      closeAgent();
      throw new UserFacingError(
        'AUDIO_RESOLVE_FAILED',
        `The source returned an error (${status}).`
      );
    }

    const contentType = headerValue(response.headers['content-type']);
    if (requireAudio && !isAcceptableAudioContentType(contentType)) {
      response.body.destroy();
      closeAgent();
      throw new UserFacingError('URL_UNSUPPORTED', NOT_AUDIO);
    }

    const rawLength = headerValue(response.headers['content-length']);
    const contentLengthBytes = rawLength ? Number.parseInt(rawLength, 10) || undefined : undefined;

    // Free the agent once the consumer is done with the body.
    response.body.once('close', closeAgent);

    return {
      stream: response.body,
      finalUrl: validation.url.toString(),
      contentType,
      contentLengthBytes,
    };
  }

  throw new UserFacingError('AUDIO_RESOLVE_FAILED', 'That link redirected too many times.');
}
