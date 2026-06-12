import type { Readable } from 'node:stream';
import type { UrlValidationOptions } from './url-validation.js';

/**
 * SSRF-safe HTTP(S) streaming fetch for audio content.
 *
 * IMPLEMENTATION SPEC:
 *  - Uses undici with `maxRedirections: 0` and a MANUAL redirect loop
 *    (max `maxRedirects`, default 5). EVERY hop — including the first — is
 *    re-validated with validateExternalUrl before any connection is made.
 *  - DNS-rebinding guard: each request uses an undici Agent whose
 *    `connect.lookup` only returns addresses that pass isBlockedAddress
 *    checks at CONNECTION time (not just validation time).
 *  - Applies `timeoutMs` to connection+headers (AbortSignal); the body
 *    stream gets a `bodyTimeoutMs` idle timeout via undici options.
 *  - Rejects responses with status >= 400 (UserFacingError AUDIO_RESOLVE_FAILED,
 *    message like 'The source returned an error (404).').
 *  - Optionally rejects content-types that are clearly not audio when
 *    `requireAudioContentType` is true: accept audio/*, video/*,
 *    application/octet-stream, application/ogg and missing content-type;
 *    reject text/html etc. with URL_UNSUPPORTED ('That link does not point
 *    to an audio file.').
 *  - Never throws raw undici errors: wrap into UserFacingError with safe
 *    messages; log details at the caller with the real error as `cause`.
 *  - Returns the live body stream plus metadata; the caller is responsible
 *    for destroying the stream when done.
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

export async function openSafeHttpStream(
  rawUrl: string,
  options: SafeStreamOptions
): Promise<SafeStreamResult> {
  void rawUrl;
  void options;
  throw new Error('not implemented — see implementation spec above');
}
