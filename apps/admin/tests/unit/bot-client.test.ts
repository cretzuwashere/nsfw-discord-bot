import { loadConfig, testEnv } from '@botplatform/config';
import { createSilentLogger } from '@botplatform/logger';
import { INTERNAL_TOKEN_HEADER } from '@botplatform/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBotClient } from '../../src/bot-client.js';

const config = loadConfig(
  testEnv({ BOT_INTERNAL_URL: 'http://bot:8081', INTERNAL_API_TOKEN: 'token-12345' })
);

function makeClient() {
  return createBotClient(config, createSilentLogger());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createBotClient', () => {
  it('requests the status endpoint with the internal token header', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ version: '0.1.0' }))
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await makeClient().getStatus();
    expect(status).toMatchObject({ version: '0.1.0' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://bot:8081/internal/status');
    expect((init.headers as Record<string, string>)[INTERNAL_TOKEN_HEADER]).toBe('token-12345');
  });

  it('returns null when the bot is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    expect(await makeClient().getStatus()).toBeNull();
  });

  it('returns null on non-200 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    expect(await makeClient().getStatus()).toBeNull();
  });

  it('builds the right action paths and survives failures', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true, message: 'done' }))
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = makeClient();

    await client.audioAction('guild-9', 'skip');
    await client.audioAction('guild-9', 'clear-queue');
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'http://bot:8081/internal/audio/guild-9/skip',
      'http://bot:8081/internal/audio/guild-9/clear-queue',
    ]);

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));
    const result = await makeClient().audioAction('guild-9', 'stop');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not reachable/i);
  });
});
