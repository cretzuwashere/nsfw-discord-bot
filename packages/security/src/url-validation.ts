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

export async function validateExternalUrl(
  rawUrl: string,
  options: UrlValidationOptions
): Promise<UrlValidationResult> {
  void rawUrl;
  void options;
  throw new Error('not implemented — see implementation spec above');
}

/** True when the given IP address string belongs to a blocked (non-public) range. */
export function isBlockedAddress(address: string): boolean {
  void address;
  throw new Error('not implemented — see implementation spec above');
}

/** True when the hostname itself is forbidden regardless of DNS (localhost, *.internal, …). */
export function isBlockedHostname(hostname: string): boolean {
  void hostname;
  throw new Error('not implemented — see implementation spec above');
}

/** True when hostname equals or is a subdomain of one of the allowed domains. */
export function matchesAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  void hostname;
  void allowedDomains;
  throw new Error('not implemented — see implementation spec above');
}
