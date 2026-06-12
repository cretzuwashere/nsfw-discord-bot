/**
 * SSRF-safe validation of user-supplied external URLs.
 *
 * IMPLEMENTATION SPEC (see tests once implemented):
 *  - Only http: and https: schemes are allowed (URL_INVALID otherwise; this
 *    also rejects file:, data:, ftp: and local file paths which fail parsing).
 *  - Reject URLs with embedded credentials (user:pass@host) — URL_INVALID.
 *  - Reject hostnames that are IP literals in private/internal ranges, and
 *    DNS names that RESOLVE to such ranges (URL_BLOCKED). Blocked ranges,
 *    for both IPv4 and IPv6 (use ipaddr.js range classification):
 *      loopback (127.0.0.0/8, ::1), private (10/8, 172.16/12, 192.168/16,
 *      fc00::/7), link-local (169.254/16, fe80::/10), carrier-grade NAT
 *      (100.64/10), unspecified (0.0.0.0, ::), broadcast, reserved,
 *      and IPv4-mapped IPv6 forms of all of the above.
 *  - 'localhost' and *.localhost, *.local, *.internal hostnames — URL_BLOCKED.
 *  - When allowedDomains is non-empty, the hostname must equal one of the
 *    domains or be a subdomain of one (URL_UNSUPPORTED otherwise).
 *  - DNS resolution uses dns.promises.lookup with { all: true }; EVERY
 *    returned address must be public, otherwise URL_BLOCKED.
 *  - Resolution failures (NXDOMAIN, timeout) — URL_INVALID with a safe reason.
 *  - The returned `resolvedAddresses` are passed to the safe stream layer so
 *    the connection can be pinned to the validated IPs (DNS rebinding guard).
 */

import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export interface UrlValidationOptions {
  /** Lowercased domain allowlist; empty = any public domain. */
  allowedDomains: string[];
  /** DNS resolution timeout. Default 5000. */
  dnsTimeoutMs?: number;
}

export type UrlValidationResult =
  | {
      ok: true;
      url: URL;
      /** All addresses the hostname resolved to (or the IP literal itself). */
      resolvedAddresses: string[];
    }
  | {
      ok: false;
      code: 'URL_INVALID' | 'URL_BLOCKED' | 'URL_UNSUPPORTED';
      /** Safe to show to end users. */
      reason: string;
    };

const MAX_URL_LENGTH = 2048;
const DEFAULT_DNS_TIMEOUT_MS = 5000;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal'];

const BLOCKED_REASON = 'That link points to a private or internal address.';
const UNRESOLVED_REASON = 'That link could not be resolved.';

function invalid(reason: string): UrlValidationResult {
  return { ok: false, code: 'URL_INVALID', reason };
}

function blocked(): UrlValidationResult {
  return { ok: false, code: 'URL_BLOCKED', reason: BLOCKED_REASON };
}

/** Lowercase, strip trailing dots, strip the brackets of IPv6 URL literals. */
function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase().replace(/\.+$/, '');
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  return host;
}

async function lookupAllWithTimeout(
  hostname: string,
  timeoutMs: number
): Promise<LookupAddress[]> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`DNS lookup timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([lookup(hostname, { all: true, verbatim: true }), timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function validateExternalUrl(
  rawUrl: string,
  options: UrlValidationOptions
): Promise<UrlValidationResult> {
  if (rawUrl.length > MAX_URL_LENGTH) {
    return invalid('That link is too long.');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return invalid('That is not a valid link.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return invalid('Only http and https links are supported.');
  }
  if (url.username !== '' || url.password !== '') {
    return invalid('Links with embedded credentials are not allowed.');
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname === '') {
    return invalid('That link does not have a valid host.');
  }
  if (isBlockedHostname(hostname)) {
    return blocked();
  }

  // Parse failure means "not an IP literal" — the DNS path applies instead.
  const isIpLiteral = ipaddr.isValid(hostname);
  if (isIpLiteral && isBlockedAddress(hostname)) {
    return blocked();
  }

  if (!matchesAllowedDomain(hostname, options.allowedDomains)) {
    return { ok: false, code: 'URL_UNSUPPORTED', reason: 'Links from that source are not allowed.' };
  }

  if (isIpLiteral) {
    return { ok: true, url, resolvedAddresses: [hostname] };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookupAllWithTimeout(hostname, options.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS);
  } catch {
    // NXDOMAIN / timeout details stay internal; the reason must be safe.
    return invalid(UNRESOLVED_REASON);
  }
  if (addresses.length === 0) {
    return invalid(UNRESOLVED_REASON);
  }
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    return blocked();
  }

  return { ok: true, url, resolvedAddresses: addresses.map((entry) => entry.address) };
}

/** True when the given IP address string belongs to a blocked (non-public) range. */
export function isBlockedAddress(address: string): boolean {
  try {
    // process() collapses IPv4-mapped IPv6 (::ffff:a.b.c.d) into plain IPv4,
    // so mapped forms of blocked ranges are classified like their IPv4 form.
    const parsed = ipaddr.process(address);
    // Block loopback, private, linkLocal, uniqueLocal, carrierGradeNat,
    // unspecified, broadcast, reserved — i.e. everything not plain unicast.
    return parsed.range() !== 'unicast';
  } catch {
    // Unparsable input fails closed.
    return true;
  }
}

/** True when the hostname itself is forbidden regardless of DNS (localhost, *.internal, …). */
export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host === 'localhost') return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** True when hostname equals or is a subdomain of one of the allowed domains. */
export function matchesAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const host = normalizeHostname(hostname);
  return allowedDomains.some((domain) => {
    const allowed = normalizeHostname(domain);
    return allowed !== '' && (host === allowed || host.endsWith(`.${allowed}`));
  });
}
