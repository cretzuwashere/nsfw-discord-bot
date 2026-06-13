import type { AppConfig } from '@botplatform/config';
import {
  createAdminUsersRepo,
  createAuditLogsRepo,
  createDbAuditLog,
  createGuildsRepo,
  createModerationRepo,
  createModulesRepo,
  createPlaybackRepo,
  pingDatabase,
  type Db,
} from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { createModerationCasesRepo } from '@botplatform/moderation-module';
import { verifyPassword } from '@botplatform/security';
import csrfProtection from '@fastify/csrf-protection';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import ejs from 'ejs';
import fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { createBotClient, type AudioAdminAction, type BotStatusClient } from './bot-client.js';
import { publicDir, viewsDir } from './paths.js';
import { COMMUNITY_ROUTE_PLUGINS, type AdminRouteContext } from './routes/index.js';
import { validateGuildSettingsInput } from './validation.js';

declare module '@fastify/secure-session' {
  interface SessionData {
    adminId: string;
    adminEmail: string;
    adminRole: string;
  }
}

export interface AdminDeps {
  config: AppConfig;
  db: Db;
  logger: Logger;
  /** Injectable for tests; defaults to the real HTTP client. */
  botClient?: BotStatusClient;
}

/** Exactly 16 characters, as @fastify/secure-session requires. */
const SESSION_SALT = 'botplatform-salt';
const LOGIN_RATE_LIMIT = { max: 20, timeWindow: '1 minute' } as const;

export async function buildAdminServer(deps: AdminDeps): Promise<FastifyInstance> {
  const { config, db, logger } = deps;
  const app = fastify({ logger: false, trustProxy: true });

  const adminUsers = createAdminUsersRepo(db);
  const modules = createModulesRepo(db);
  const guilds = createGuildsRepo(db);
  const auditLogs = createAuditLogsRepo(db);
  const playback = createPlaybackRepo(db);
  const moderation = createModerationRepo(db);
  const audit = createDbAuditLog(db, logger);
  const botClient = deps.botClient ?? createBotClient(config, logger);

  await app.register(formbody);
  // Multipart for card-background uploads (8 MB cap; the cards module also
  // validates the mime type and stores under the uploads volume safely).
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  await app.register(secureSession, {
    secret: config.admin.sessionSecret,
    salt: SESSION_SALT,
    cookieName: 'bp_session',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.admin.cookieSecure,
    },
  });
  await app.register(csrfProtection, { sessionPlugin: '@fastify/secure-session' });
  await app.register(rateLimit, { global: false });
  await app.register(view, { engine: { ejs }, root: viewsDir, viewExt: 'ejs' });
  await app.register(fastifyStatic, { root: publicDir, prefix: '/public/' });
  await app.register(sensible);

  // ---------------------------------------------------------------------
  // Error boundary: users see friendly pages, logs see the real error.
  // ---------------------------------------------------------------------
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      logger.error({ err: error, url: request.url }, 'admin request failed');
    }
    const message =
      statusCode === 403
        ? 'That request could not be verified. Please go back and try again.'
        : statusCode === 429
          ? 'Too many attempts. Please wait a minute and try again.'
          : statusCode < 500
            ? 'That request could not be processed.'
            : 'Something went wrong on our side. The error has been logged.';
    return reply
      .code(statusCode)
      .view('error', { title: 'Error', statusCode, message, adminEmail: null, currentPath: '' });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).view('error', {
      title: 'Not found',
      statusCode: 404,
      message: 'That page does not exist.',
      adminEmail: null,
      currentPath: '',
    })
  );

  // ---------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.session.get('adminId')) {
      return reply.redirect('/login');
    }
  };
  const requireMutatingRole = async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.session.get('adminRole');
    if (role !== 'owner' && role !== 'admin') {
      return reply.code(403).view('error', {
        title: 'Forbidden',
        statusCode: 403,
        message: 'Viewers cannot change settings.',
        adminEmail: request.session.get('adminEmail') ?? null,
        currentPath: '',
      });
    }
  };

  /** Common locals every authenticated page needs (nav, logout CSRF). */
  function pageLocals(request: FastifyRequest, reply: FastifyReply, title: string) {
    return {
      title,
      currentPath: request.url.split('?')[0] ?? request.url,
      adminEmail: request.session.get('adminEmail') ?? null,
      csrfToken: reply.generateCsrf(),
    };
  }

  // ---------------------------------------------------------------------
  // Health (no auth, JSON, no secrets)
  // ---------------------------------------------------------------------
  app.get('/healthz', async (_request, reply) => {
    try {
      await pingDatabase(db);
      return { status: 'ok', checks: { database: { status: 'ok' } } };
    } catch {
      return reply.code(503).send({
        status: 'degraded',
        checks: { database: { status: 'error', detail: 'unreachable' } },
      });
    }
  });

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------
  app.get('/login', async (request, reply) => {
    if (request.session.get('adminId')) return reply.redirect('/dashboard');
    return reply.view('login', {
      title: 'Log in',
      error: null,
      csrfToken: reply.generateCsrf(),
    });
  });

  app.post<{ Body: { email?: string; password?: string } }>(
    '/login',
    {
      config: { rateLimit: LOGIN_RATE_LIMIT },
      preHandler: app.csrfProtection,
    },
    async (request, reply) => {
      const email = (request.body.email ?? '').trim();
      const password = request.body.password ?? '';
      const user = email ? await adminUsers.findByEmail(email) : undefined;
      const valid = user ? await verifyPassword(user.passwordHash, password) : false;

      if (!user || !valid) {
        await audit.record({
          actorType: 'admin',
          actorId: email || 'unknown',
          action: 'admin.login.failed',
        });
        return reply.code(401).view('login', {
          title: 'Log in',
          error: 'Invalid email or password.',
          csrfToken: reply.generateCsrf(),
        });
      }

      request.session.set('adminId', user.id);
      request.session.set('adminEmail', user.email);
      request.session.set('adminRole', user.role);
      await adminUsers.recordLogin(user.id);
      await audit.record({ actorType: 'admin', actorId: user.id, action: 'admin.login' });
      return reply.redirect('/dashboard');
    }
  );

  app.post(
    '/logout',
    { preHandler: [requireAuth, app.csrfProtection] },
    async (request, reply) => {
      await audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'admin.logout',
      });
      request.session.delete();
      return reply.redirect('/login');
    }
  );

  // ---------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------
  app.get('/', { preHandler: requireAuth }, async (_request, reply) =>
    reply.redirect('/dashboard')
  );

  app.get('/dashboard', { preHandler: requireAuth }, async (request, reply) => {
    const [botStatus, moduleRows, recentAudit] = await Promise.all([
      botClient.getStatus(),
      modules.list(),
      auditLogs.listRecent({ limit: 10 }),
    ]);
    let databaseOk = true;
    try {
      await pingDatabase(db);
    } catch {
      databaseOk = false;
    }
    return reply.view('dashboard', {
      ...pageLocals(request, reply, 'Dashboard'),
      botStatus,
      databaseOk,
      modules: moduleRows,
      recentAudit,
      environment: config.nodeEnv,
      version: config.version,
    });
  });

  app.get('/modules', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('modules', {
      ...pageLocals(request, reply, 'Modules'),
      modules: await modules.list(),
      saved: 'saved' in (request.query as Record<string, unknown>),
    });
  });

  app.post<{ Params: { key: string } }>(
    '/modules/:key/toggle',
    { preHandler: [requireAuth, requireMutatingRole, app.csrfProtection] },
    async (request, reply) => {
      const row = await modules.get(request.params.key);
      if (!row) return reply.callNotFound();
      const updated = await modules.setEnabled(row.key, !row.enabled);
      await audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: updated?.enabled ? 'module.enabled' : 'module.disabled',
        targetType: 'module',
        targetId: row.key,
      });
      return reply.redirect('/modules?saved=1');
    }
  );

  app.get('/audio', { preHandler: requireAuth }, async (request, reply) => {
    const [botStatus, recentErrors, recentHistory] = await Promise.all([
      botClient.getStatus(),
      playback.listRecentErrors(10),
      playback.listRecentHistory(10),
    ]);
    const query = request.query as Record<string, string | undefined>;
    return reply.view('audio', {
      ...pageLocals(request, reply, 'Audio Player'),
      sessions: botStatus?.audio.sessions ?? [],
      botOnline: botStatus !== null,
      limits: {
        maxQueueSize: config.audio.maxQueueSize,
        maxTrackDurationSeconds: config.audio.maxTrackDurationSeconds,
        allowedDomains: config.audio.allowedDomains,
        requestTimeoutMs: config.audio.requestTimeoutMs,
      },
      recentErrors,
      recentHistory,
      message: query['msg'] ?? null,
    });
  });

  app.post<{ Params: { guildId: string; action: string } }>(
    '/audio/:guildId/:action',
    { preHandler: [requireAuth, requireMutatingRole, app.csrfProtection] },
    async (request, reply) => {
      const { guildId, action } = request.params;
      if (!['skip', 'stop', 'clear-queue'].includes(action)) return reply.callNotFound();
      const result = await botClient.audioAction(guildId, action as AudioAdminAction);
      await audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: `audio.admin.${action}`,
        guildId,
        metadata: { ok: result.ok },
      });
      return reply.redirect(`/audio?msg=${encodeURIComponent(result.message)}`);
    }
  );

  app.get('/guilds', { preHandler: requireAuth }, async (request, reply) => {
    return reply.view('guilds', {
      ...pageLocals(request, reply, 'Guild Settings'),
      guilds: await guilds.list(),
    });
  });

  app.get<{ Params: { id: string } }>(
    '/guilds/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const guild = await guilds.getById(request.params.id).catch(() => undefined);
      if (!guild) return reply.callNotFound();
      const query = request.query as Record<string, string | undefined>;
      return reply.view('guild-edit', {
        ...pageLocals(request, reply, `Guild: ${guild.name || guild.externalId}`),
        guild,
        errors: [],
        saved: query['saved'] === '1',
        globalDefaults: {
          maxQueueSize: config.audio.maxQueueSize,
          maxTrackDurationSeconds: config.audio.maxTrackDurationSeconds,
        },
      });
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/guilds/:id/settings',
    { preHandler: [requireAuth, requireMutatingRole, app.csrfProtection] },
    async (request, reply) => {
      const guild = await guilds.getById(request.params.id).catch(() => undefined);
      if (!guild) return reply.callNotFound();

      const validation = validateGuildSettingsInput(request.body);
      if (!validation.ok) {
        return reply.code(400).view('guild-edit', {
          ...pageLocals(request, reply, `Guild: ${guild.name || guild.externalId}`),
          guild,
          errors: validation.errors,
          saved: false,
          globalDefaults: {
            maxQueueSize: config.audio.maxQueueSize,
            maxTrackDurationSeconds: config.audio.maxTrackDurationSeconds,
          },
        });
      }

      await guilds.updateSettings(guild.id, validation.values);
      await audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'guild.settings.updated',
        guildId: guild.externalId,
        targetType: 'guild',
        targetId: guild.id,
        metadata: { ...validation.values },
      });
      return reply.redirect(`/guilds/${guild.id}?saved=1`);
    }
  );

  const moderationCases = createModerationCasesRepo(db);
  app.get('/moderation', { preHandler: requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const [moduleRow, warnings, actions, rules, cases] = await Promise.all([
      modules.get('moderation'),
      moderation.listWarnings(50),
      moderation.listActions(50),
      moderation.listRules(),
      guildId ? moderationCases.listByGuild(guildId, 50) : Promise.resolve([]),
    ]);
    return reply.view('moderation', {
      ...pageLocals(request, reply, 'Moderation'),
      moduleRow: moduleRow ?? null,
      warnings,
      actions,
      rules,
      cases,
      guilds: guildList,
      selectedGuildId: guildId,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/moderation/rules/:id/toggle',
    { preHandler: [requireAuth, requireMutatingRole, app.csrfProtection] },
    async (request, reply) => {
      const rules = await moderation.listRules();
      const rule = rules.find((candidate) => candidate.id === request.params.id);
      if (!rule) return reply.callNotFound();
      await moderation.setRuleEnabled(rule.id, !rule.enabled);
      await audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'moderation.rule.toggled',
        targetType: 'moderation_rule',
        targetId: rule.id,
        metadata: { enabled: !rule.enabled },
      });
      return reply.redirect('/moderation');
    }
  );

  app.get('/audit-logs', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Math.max(1, Number.parseInt(query['page'] ?? '1', 10) || 1);
    const action = (query['action'] ?? '').trim() || undefined;
    const pageSize = 50;
    const [rows, total] = await Promise.all([
      auditLogs.listRecent({ limit: pageSize, offset: (page - 1) * pageSize, action }),
      auditLogs.count({ action }),
    ]);
    return reply.view('audit-logs', {
      ...pageLocals(request, reply, 'Audit Logs'),
      rows: rows.map((row) => ({
        ...row,
        metadataText: truncateText(JSON.stringify(row.metadata ?? {}), 200),
      })),
      page,
      action: action ?? '',
      hasNext: page * pageSize < total,
      total,
    });
  });

  app.get('/settings', { preHandler: requireAuth }, async (request, reply) => {
    let databaseOk = true;
    try {
      await pingDatabase(db);
    } catch {
      databaseOk = false;
    }
    // EXPLICIT allowlist — never reflect raw config or env into HTML.
    const safeConfig = [
      { label: 'Environment', value: config.nodeEnv },
      { label: 'Version', value: config.version },
      { label: 'Log level', value: config.logLevel },
      { label: 'Admin port', value: String(config.admin.port) },
      { label: 'Public admin URL', value: config.admin.publicUrl },
      { label: 'Secure cookies', value: config.admin.cookieSecure ? 'yes' : 'no' },
      { label: 'Max queue size', value: String(config.audio.maxQueueSize) },
      {
        label: 'Max track duration',
        value: `${config.audio.maxTrackDurationSeconds} seconds`,
      },
      {
        label: 'Allowed audio domains',
        value: config.audio.allowedDomains.length
          ? config.audio.allowedDomains.join(', ')
          : 'any public domain',
      },
      { label: 'Audio request timeout', value: `${config.audio.requestTimeoutMs} ms` },
    ];
    const readiness = [
      { label: 'Database reachable', ok: databaseOk },
      { label: 'Session secret configured', ok: config.admin.sessionSecret.length >= 32 },
      { label: 'Discord credentials configured', ok: config.discord.enabled },
      { label: 'Internal API token configured', ok: config.bot.internalApiToken.length >= 8 },
    ];
    return reply.view('settings', {
      ...pageLocals(request, reply, 'System Settings'),
      safeConfig,
      readiness,
    });
  });

  // --- Community module routes (each owns its own file) ----------------------
  const routeContext: AdminRouteContext = {
    config,
    db,
    logger,
    audit,
    botClient,
    requireAuth,
    requireMutatingRole,
    csrfProtection: app.csrfProtection,
    pageLocals: (request, reply, title) => pageLocals(request, reply, title),
  };
  for (const registerRoutes of COMMUNITY_ROUTE_PLUGINS) {
    registerRoutes(app, routeContext);
  }

  return app;
}

function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
