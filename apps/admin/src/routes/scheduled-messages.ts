import { createGuildsRepo } from '@botplatform/database';
import {
  computeNextRun,
  createScheduledMessageRepo,
  MIN_INTERVAL_SECONDS,
  type ScheduleConfig,
  type ScheduleType,
} from '@botplatform/scheduled-messages-module';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

const MAX_PER_GUILD = 50;
const SCHEDULE_TYPES: ScheduleType[] = ['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'];

export const registerScheduledMessageRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const repo = createScheduledMessageRepo(ctx.db);
  const guilds = createGuildsRepo(ctx.db);

  app.get('/scheduled-messages', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const rows = guildId ? await repo.listByGuild(guildId) : [];
    const query = request.query as Record<string, string | undefined>;
    return reply.view('scheduled-messages', {
      ...ctx.pageLocals(request, reply, 'Scheduled Messages'),
      guilds: guildList,
      selectedGuildId: guildId,
      messages: rows,
      message: query['msg'] ?? null,
    });
  });

  app.get('/scheduled-messages/new', { preHandler: ctx.requireAuth }, async (request, reply) => {
    return reply.view('scheduled-message-edit', {
      ...ctx.pageLocals(request, reply, 'New Scheduled Message'),
      guilds: await guilds.list(),
      item: null,
      runs: [],
      scheduleTypes: SCHEDULE_TYPES,
      errors: [],
    });
  });

  app.get<{ Params: { id: string } }>(
    '/scheduled-messages/:id',
    { preHandler: ctx.requireAuth },
    async (request, reply) => {
      const item = await repo.getById(request.params.id);
      if (!item) return reply.callNotFound();
      return reply.view('scheduled-message-edit', {
        ...ctx.pageLocals(request, reply, 'Edit Scheduled Message'),
        guilds: await guilds.list(),
        item,
        runs: await repo.listRuns(item.id, 10),
        scheduleTypes: SCHEDULE_TYPES,
        errors: [],
      });
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/scheduled-messages/:id/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const guild = await guilds.getById(str(body['guildId']));
      const errors: string[] = [];
      if (!guild) errors.push('Select a server.');
      if (!str(body['channelId'])) errors.push('A channel ID is required.');
      if (!str(body['content'])) errors.push('Message content is required.');

      const scheduleType = pick(str(body['scheduleType']), SCHEDULE_TYPES, 'once');
      const timezone = str(body['timezone']) || 'UTC';
      const scheduleConfig = buildConfig(scheduleType, body, errors);
      const existing = request.params.id !== 'new' ? await repo.getById(request.params.id) : null;

      if (!existing && guild) {
        const count = await repo.countByGuild(guild.id);
        if (count >= MAX_PER_GUILD) errors.push(`This server already has the maximum of ${MAX_PER_GUILD} scheduled messages.`);
      }

      const nextRunAt = errors.length === 0 ? computeNextRun(scheduleType, scheduleConfig, timezone, new Date()) : null;
      if (errors.length === 0 && !nextRunAt) errors.push('That schedule has no upcoming run — check the date/time.');

      if (errors.length > 0 || !guild) {
        return reply.code(400).view('scheduled-message-edit', {
          ...ctx.pageLocals(request, reply, 'Scheduled Message'),
          guilds: await guilds.list(),
          item: { ...body, id: request.params.id === 'new' ? undefined : request.params.id },
          runs: [],
          scheduleTypes: SCHEDULE_TYPES,
          errors,
        });
      }

      const fields = {
        guildId: guild.id,
        name: str(body['name']),
        channelId: str(body['channelId']),
        content: str(body['content']),
        format: 'plain' as const,
        mentionMode: pick(str(body['mentionMode']), ['none', 'here', 'everyone', 'roles'], 'none'),
        mentionRoleIds: parseIds(body['mentionRoleIds']),
        scheduleType,
        scheduleConfig,
        timezone,
        nextRunAt,
        paused: false,
      };
      const saved = existing ? await repo.update(existing.id, fields) : await repo.create(fields);

      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: existing ? 'scheduled-message.updated' : 'scheduled-message.created',
        moduleKey: 'scheduled-messages',
        guildId: guild.externalId,
        targetType: 'scheduled_message',
        targetId: saved?.id,
      });
      return reply.redirect(`/scheduled-messages/${saved?.id}?`);
    }
  );

  for (const action of ['pause', 'resume', 'delete'] as const) {
    app.post<{ Params: { id: string } }>(
      `/scheduled-messages/:id/${action}`,
      { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
      async (request, reply) => {
        const item = await repo.getById(request.params.id);
        if (!item) return reply.callNotFound();
        if (action === 'delete') await repo.delete(item.id);
        else await repo.update(item.id, { paused: action === 'pause' });
        return reply.redirect(`/scheduled-messages?msg=${action}d`);
      }
    );
  }
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function pick<T extends string>(v: string, allowed: T[], fb: T): T {
  return (allowed as string[]).includes(v) ? (v as T) : fb;
}
function intOr(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? n : fb;
}
function parseIds(v: unknown): string[] {
  return str(v).split(/[,\n]/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
}

function buildConfig(type: ScheduleType, body: Record<string, unknown>, errors: string[]): ScheduleConfig {
  switch (type) {
    case 'once':
      return { at: str(body['at']) };
    case 'interval': {
      const seconds = intOr(body['intervalSeconds'], MIN_INTERVAL_SECONDS);
      if (seconds < MIN_INTERVAL_SECONDS) errors.push(`Interval must be at least ${MIN_INTERVAL_SECONDS} seconds.`);
      return { intervalSeconds: Math.max(seconds, MIN_INTERVAL_SECONDS) };
    }
    case 'daily':
      return { hour: intOr(body['hour'], 9), minute: intOr(body['minute'], 0) };
    case 'weekly':
      return { weekday: intOr(body['weekday'], 1), hour: intOr(body['hour'], 9), minute: intOr(body['minute'], 0) };
    case 'monthly':
      return { day: intOr(body['day'], 1), hour: intOr(body['hour'], 9), minute: intOr(body['minute'], 0) };
    case 'cron':
      return { expression: str(body['expression']) };
    default:
      return {};
  }
}
