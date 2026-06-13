import { randomUUID } from 'node:crypto';
import { loadConfig, testEnv } from '@botplatform/config';
import {
  createAdminUsersRepo,
  createAuditLogsRepo,
  createDatabase,
  createModulesRepo,
  resolveTestDatabaseUrl,
  seed,
  type Database,
} from '@botplatform/database';
import { createSilentLogger } from '@botplatform/logger';
import { hashPassword } from '@botplatform/security';
import type { InternalBotStatus } from '@botplatform/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BotStatusClient } from '../../src/bot-client.js';
import { buildAdminServer } from '../../src/server.js';

const SESSION_SECRET = 'integration-test-session-secret-42-chars!!';
const PASSWORD = 'correct-horse-battery';

const FAKE_STATUS: InternalBotStatus = {
  startedAt: new Date().toISOString(),
  uptimeSeconds: 90,
  version: '0.1.0',
  environment: 'test',
  adapters: [{ key: 'discord', state: 'disabled', identity: 'TestBot#0001' }],
  modules: [{ key: 'audio-player', name: 'Audio Player', enabled: true }],
  audio: { sessions: [] },
};

const fakeBotClient: BotStatusClient = {
  getStatus: async () => FAKE_STATUS,
  audioAction: async () => ({ ok: true, message: 'done' }),
};

let database: Database;
let app: FastifyInstance;
let adminEmail: string;
let adminId: string;

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match?.[1]) throw new Error('no csrf token in page');
  return match[1];
}

function maybeCookie(setCookie: string | string[] | undefined): string | null {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const session = all.find((cookie) => cookie.startsWith('bp_session='));
  return session ? (session.split(';')[0] ?? null) : null;
}

function extractCookie(setCookie: string | string[] | undefined): string {
  const cookie = maybeCookie(setCookie);
  if (!cookie) throw new Error('no session cookie set');
  return cookie;
}

/**
 * GET a page (optionally with an existing cookie) to harvest a csrf token.
 * Returns the freshest cookie — callers MUST use it for the follow-up POST,
 * since generating a token may rotate the encrypted session cookie.
 */
async function freshCsrf(path: string, cookie?: string) {
  const response = await app.inject({
    method: 'GET',
    url: path,
    headers: cookie ? { cookie } : {},
  });
  return {
    csrf: extractCsrf(response.body),
    cookie: maybeCookie(response.headers['set-cookie']) ?? cookie ?? '',
  };
}

async function loginAs(email: string, password: string) {
  const { csrf, cookie } = await freshCsrf('/login');
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: formBody({ email, password, _csrf: csrf }),
  });
  return { response, cookie: maybeCookie(response.headers['set-cookie']) ?? cookie };
}

beforeAll(async () => {
  const testUrl = resolveTestDatabaseUrl();
  database = createDatabase(testUrl);
  const config = loadConfig(
    testEnv({ DATABASE_URL: testUrl, SESSION_SECRET, BOT_INTERNAL_URL: 'http://bot:8081' })
  );
  app = await buildAdminServer({
    config,
    db: database.db,
    logger: createSilentLogger(),
    botClient: fakeBotClient,
  });
  await app.ready();

  // Modules must exist for the dashboard/modules pages.
  await seed(database.db, {});

  adminEmail = `admin-${randomUUID()}@test.local`;
  const repo = createAdminUsersRepo(database.db);
  const user = await repo.create({
    email: adminEmail,
    passwordHash: await hashPassword(PASSWORD),
    role: 'owner',
  });
  adminId = user.id;
});

afterAll(async () => {
  await app?.close();
  await database?.close();
});

describe('admin panel integration', () => {
  it('GET /healthz reports ok without auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /login renders the form with a csrf token', async () => {
    const response = await app.inject({ method: 'GET', url: '/login' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('name="email"');
    expect(response.body).toContain('name="password"');
    expect(() => extractCsrf(response.body)).not.toThrow();
  });

  it('rejects a wrong password with a generic message and audits the failure', async () => {
    const { response } = await loginAs(adminEmail, 'totally-wrong');
    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('Invalid email or password.');
    expect(response.body).not.toMatch(/wrong password|password is incorrect|user not found/i);

    const audit = createAuditLogsRepo(database.db);
    const failures = await audit.listRecent({ action: 'admin.login.failed', limit: 5 });
    expect(failures.some((row) => row.actorId === adminEmail)).toBe(true);
  });

  it('redirects unauthenticated dashboard requests to /login', async () => {
    const response = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
  });

  it('logs in, sees the dashboard, and the login is audited', async () => {
    const { response, cookie } = await loginAs(adminEmail, PASSWORD);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/dashboard');

    const dashboard = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { cookie },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).toContain('TestBot#0001');
    expect(dashboard.body).toContain('Audio Player');
    expect(dashboard.body).toContain('Announcements');

    const audit = createAuditLogsRepo(database.db);
    const logins = await audit.listRecent({ action: 'admin.login', limit: 5 });
    expect(logins.some((row) => row.actorId === adminId)).toBe(true);
  });

  it('toggles a module with csrf, persists it, audits it, and restores it', async () => {
    const { cookie } = await loginAs(adminEmail, PASSWORD);
    const modules = createModulesRepo(database.db);
    const before = await modules.get('moderation');
    expect(before).toBeDefined();

    const { csrf, cookie: toggleCookie } = await freshCsrf('/modules', cookie);
    const toggle = await app.inject({
      method: 'POST',
      url: '/modules/moderation/toggle',
      headers: { cookie: toggleCookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody({ _csrf: csrf }),
    });
    expect(toggle.statusCode).toBe(302);

    const after = await modules.get('moderation');
    expect(after?.enabled).toBe(!before?.enabled);

    const audit = createAuditLogsRepo(database.db);
    const entries = await audit.listRecent({
      action: after?.enabled ? 'module.enabled' : 'module.disabled',
      limit: 5,
    });
    expect(entries.some((row) => row.targetId === 'moderation')).toBe(true);

    // restore
    const { csrf: csrf2, cookie: cookie2 } = await freshCsrf('/modules', cookie);
    await app.inject({
      method: 'POST',
      url: '/modules/moderation/toggle',
      headers: { cookie: cookie2, 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody({ _csrf: csrf2 }),
    });
    const restored = await modules.get('moderation');
    expect(restored?.enabled).toBe(before?.enabled);
  });

  it('rejects POSTs without a csrf token', async () => {
    const { cookie } = await loginAs(adminEmail, PASSWORD);
    const response = await app.inject({
      method: 'POST',
      url: '/modules/moderation/toggle',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody({}),
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toMatch(/MissingCSRF|FST_/); // no raw error codes
  });

  it('renders all authenticated pages without leaking secrets', async () => {
    const { cookie } = await loginAs(adminEmail, PASSWORD);
    for (const path of ['/modules', '/audio', '/guilds', '/moderation', '/audit-logs', '/settings']) {
      const response = await app.inject({ method: 'GET', url: path, headers: { cookie } });
      expect(response.statusCode, `${path} should render`).toBe(200);
      expect(response.body).not.toContain(SESSION_SECRET);
      expect(response.body).not.toContain('test-internal-token');
      expect(response.body).not.toContain(PASSWORD);
    }
  });

  it('logs out, audits it, and protects pages again', async () => {
    const { cookie } = await loginAs(adminEmail, PASSWORD);
    const { csrf, cookie: logoutCookie } = await freshCsrf('/dashboard', cookie);
    const logout = await app.inject({
      method: 'POST',
      url: '/logout',
      headers: { cookie: logoutCookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody({ _csrf: csrf }),
    });
    expect(logout.statusCode).toBe(302);
    expect(logout.headers.location).toBe('/login');

    const cleared = extractCookie(logout.headers['set-cookie']);
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { cookie: cleared },
    });
    expect(afterLogout.statusCode).toBe(302);

    const audit = createAuditLogsRepo(database.db);
    const entries = await audit.listRecent({ action: 'admin.logout', limit: 5 });
    expect(entries.length).toBeGreaterThan(0);
  });

  it('rate-limits the login endpoint after 20 attempts in a minute', async () => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 21; attempt++) {
      const { csrf, cookie } = await freshCsrf('/login');
      const response = await app.inject({
        method: 'POST',
        url: '/login',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        payload: formBody({
          email: `nobody-${randomUUID()}@test.local`,
          password: 'wrong',
          _csrf: csrf,
        }),
      });
      lastStatus = response.statusCode;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});
