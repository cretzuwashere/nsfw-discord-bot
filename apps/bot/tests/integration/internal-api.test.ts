import { loadConfig, testEnv } from '@botplatform/config';
import type { AuditEntry } from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { INTERNAL_TOKEN_HEADER, type QueueSnapshot } from '@botplatform/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInternalApi, type InternalApiDeps } from '../../src/internal-api.js';

const TOKEN = 'test-internal-token';

function makeDeps(): InternalApiDeps & { auditEntries: AuditEntry[] } {
  const auditEntries: AuditEntry[] = [];
  const snapshot: QueueSnapshot = {
    guildId: 'guild-1',
    channelName: 'general',
    status: 'playing',
    nowPlaying: { title: 'song.mp3', url: 'https://example.com/song.mp3', provider: 'direct-http' },
    queue: [],
    maxQueueSize: 50,
  };
  return {
    auditEntries,
    config: loadConfig(testEnv({ INTERNAL_API_TOKEN: TOKEN })),
    logger: createSilentLogger(),
    health: {
      run: async () => ({ status: 'ok' as const, checks: { database: { status: 'ok' as const } } }),
    },
    modules: {
      list: () => [
        { key: 'audio-player', name: 'Audio Player' },
        { key: 'moderation', name: 'Moderation Foundation' },
      ],
    },
    moduleState: { isEnabled: async (key) => key === 'audio-player' },
    adapters: [{ key: 'discord', getStatus: () => ({ state: 'disabled' as const }) }],
    audio: {
      getSnapshots: () => [snapshot],
      skip: async (guildId) =>
        guildId === 'guild-1'
          ? { ok: true, message: 'Skipped — the queue is empty.' }
          : { ok: false, message: 'No active playback in that server.' },
      stop: async () => ({ ok: true, message: 'Stopped.' }),
      clearQueue: async () => ({ ok: true, message: 'Cleared 0 queued track(s).' }),
    },
    audit: {
      record: async (entry) => {
        auditEntries.push(entry);
      },
    },
    startedAt: new Date(),
  };
}

describe('bot internal API', () => {
  const deps = makeDeps();
  const app = buildInternalApi(deps);

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves /healthz without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects /internal/status without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/internal/status' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects /internal/status with a wrong token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/status',
      headers: { [INTERNAL_TOKEN_HEADER]: 'wrong-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns the full status shape with a valid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/status',
      headers: { [INTERNAL_TOKEN_HEADER]: TOKEN },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      version: '0.1.0',
      environment: 'test',
      adapters: [{ key: 'discord', state: 'disabled' }],
      modules: [
        { key: 'audio-player', name: 'Audio Player', enabled: true },
        { key: 'moderation', name: 'Moderation Foundation', enabled: false },
      ],
    });
    expect(body.audio.sessions).toHaveLength(1);
    expect(body.audio.sessions[0].nowPlaying.title).toBe('song.mp3');
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('performs audio admin actions and audits them', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/audio/guild-1/skip',
      headers: { [INTERNAL_TOKEN_HEADER]: TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(deps.auditEntries.at(-1)).toMatchObject({
      action: 'audio.admin.skip',
      guildId: 'guild-1',
    });
  });

  it('reports ok:false for unknown guilds', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/audio/unknown-guild/skip',
      headers: { [INTERNAL_TOKEN_HEADER]: TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false });
  });

  it('guards audio action routes with the token too', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/audio/guild-1/stop',
    });
    expect(response.statusCode).toBe(401);
  });
});
