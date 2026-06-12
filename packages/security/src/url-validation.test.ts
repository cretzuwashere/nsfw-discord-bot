import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'node:dns/promises';
import {
  isBlockedAddress,
  isBlockedHostname,
  matchesAllowedDomain,
  validateExternalUrl,
} from './url-validation.js';

const mockedLookup = vi.mocked(lookup);

function dnsAnswer(...addresses: string[]) {
  mockedLookup.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })) as never
  );
}

const OPTS = { allowedDomains: [] as string[] };

beforeEach(() => {
  mockedLookup.mockReset();
});

describe('validateExternalUrl — scheme and shape', () => {
  it.each([
    'ftp://example.com/a.mp3',
    'file:///etc/passwd',
    'data:audio/mpeg;base64,AAAA',
    'javascript:alert(1)',
    'gopher://example.com',
  ])('rejects non-http scheme: %s', async (url) => {
    const result = await validateExternalUrl(url, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('URL_INVALID');
  });

  it.each(['not a url', 'C:\\music\\track.mp3', '/etc/passwd', 'song.mp3'])(
    'rejects non-URLs and local paths: %s',
    async (input) => {
      const result = await validateExternalUrl(input, OPTS);
      expect(result.ok).toBe(false);
    }
  );

  it('rejects embedded credentials', async () => {
    const result = await validateExternalUrl('http://user:pass@example.com/a.mp3', OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('URL_INVALID');
  });

  it('rejects URLs longer than 2048 characters', async () => {
    const result = await validateExternalUrl(`http://example.com/${'a'.repeat(2050)}`, OPTS);
    expect(result.ok).toBe(false);
  });
});

describe('validateExternalUrl — blocked hosts and IP literals (no DNS needed)', () => {
  it.each([
    'http://localhost/a.mp3',
    'http://LOCALHOST:8080/a.mp3',
    'http://foo.localhost/a.mp3',
    'http://nas.local/a.mp3',
    'http://service.internal/a.mp3',
    'http://127.0.0.1/a.mp3',
    'http://127.8.9.10/a.mp3',
    'http://[::1]/a.mp3',
    'http://10.0.0.5/a.mp3',
    'http://192.168.1.1/a.mp3',
    'http://172.16.0.1/a.mp3',
    'http://169.254.169.254/latest/meta-data', // cloud metadata endpoint
    'http://0.0.0.0/a.mp3',
    'http://100.64.0.1/a.mp3', // carrier-grade NAT
    'http://[fe80::1]/a.mp3',
    'http://[fc00::1]/a.mp3',
  ])('blocks %s', async (url) => {
    const result = await validateExternalUrl(url, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('URL_BLOCKED');
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('accepts a public IP literal without DNS', async () => {
    const result = await validateExternalUrl('http://93.184.216.34/a.mp3', OPTS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedAddresses).toEqual(['93.184.216.34']);
    expect(mockedLookup).not.toHaveBeenCalled();
  });
});

describe('validateExternalUrl — DNS resolution', () => {
  it('accepts a hostname resolving to public addresses only', async () => {
    dnsAnswer('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946');
    const result = await validateExternalUrl('https://example.com/track.mp3', OPTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedAddresses).toContain('93.184.216.34');
      expect(result.url.hostname).toBe('example.com');
    }
  });

  it('blocks a hostname resolving to a private address', async () => {
    dnsAnswer('10.1.2.3');
    const result = await validateExternalUrl('https://evil.example.com/a.mp3', OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('URL_BLOCKED');
  });

  it('blocks when ANY of multiple answers is private (mixed answers)', async () => {
    dnsAnswer('93.184.216.34', '192.168.0.10');
    const result = await validateExternalUrl('https://mixed.example.com/a.mp3', OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('URL_BLOCKED');
  });

  it('treats DNS failure as invalid with a safe reason', async () => {
    mockedLookup.mockRejectedValue(Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' }));
    const result = await validateExternalUrl('https://nope.example.com/a.mp3', OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('URL_INVALID');
      expect(result.reason).not.toContain('ENOTFOUND');
    }
  });

  it('treats an empty DNS answer as invalid', async () => {
    dnsAnswer();
    const result = await validateExternalUrl('https://empty.example.com/a.mp3', OPTS);
    expect(result.ok).toBe(false);
  });
});

describe('validateExternalUrl — domain allowlist', () => {
  it('rejects hosts outside the allowlist without resolving DNS', async () => {
    const result = await validateExternalUrl('https://evil.net/a.mp3', {
      allowedDomains: ['example.com'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('URL_UNSUPPORTED');
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('accepts exact and subdomain matches', async () => {
    dnsAnswer('93.184.216.34');
    const exact = await validateExternalUrl('https://example.com/a.mp3', {
      allowedDomains: ['example.com'],
    });
    expect(exact.ok).toBe(true);

    dnsAnswer('93.184.216.34');
    const sub = await validateExternalUrl('https://cdn.example.com/a.mp3', {
      allowedDomains: ['example.com'],
    });
    expect(sub.ok).toBe(true);
  });
});

describe('matchesAllowedDomain', () => {
  it('empty allowlist allows everything', () => {
    expect(matchesAllowedDomain('anything.net', [])).toBe(true);
  });
  it('matches exact domain and subdomains only', () => {
    expect(matchesAllowedDomain('example.com', ['example.com'])).toBe(true);
    expect(matchesAllowedDomain('cdn.example.com', ['example.com'])).toBe(true);
    expect(matchesAllowedDomain('evil-example.com', ['example.com'])).toBe(false);
    expect(matchesAllowedDomain('example.com.evil.net', ['example.com'])).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(matchesAllowedDomain('CDN.Example.COM', ['example.com'])).toBe(true);
  });
});

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:10.0.0.1', // IPv4-mapped private
    'garbage',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows public %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );
});

describe('isBlockedHostname', () => {
  it.each(['localhost', 'LOCALHOST', 'a.localhost', 'nas.local', 'x.internal', 'localhost.'])(
    'blocks %s',
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    }
  );
  it.each(['example.com', 'internal.example.com', 'mylocalhost.com'])(
    'allows %s',
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(false);
    }
  );
});
