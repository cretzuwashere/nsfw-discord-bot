import { createAutomodRepo } from '@botplatform/automod-module';
import { createGuildsRepo } from '@botplatform/database';
import { safeJsonParse } from '@botplatform/shared';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

const RULE_TYPES = [
  'banned_words', 'spam', 'mention_spam', 'caps', 'invite_links',
  'suspicious_links', 'attachments', 'new_account',
];
const ACTIONS = ['log_only', 'delete', 'warn', 'timeout', 'kick', 'ban'];

export const registerAutomodRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const repo = createAutomodRepo(ctx.db);
  const guilds = createGuildsRepo(ctx.db);
  const contentRulesAvailable = ctx.config.discord.enableMessageContent;

  app.get('/automod', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const [rules, violations] = await Promise.all([
      guildId ? repo.listByGuild(guildId) : Promise.resolve([]),
      guildId ? repo.recentViolations(guildId, 25) : Promise.resolve([]),
    ]);
    const query = request.query as Record<string, string | undefined>;
    return reply.view('automod', {
      ...ctx.pageLocals(request, reply, 'Auto-Moderation'),
      guilds: guildList,
      selectedGuildId: guildId,
      rules,
      violations,
      ruleTypes: RULE_TYPES,
      actions: ACTIONS,
      contentRulesAvailable,
      message: query['msg'] ?? null,
    });
  });

  app.post<{ Body: Record<string, unknown> }>(
    '/automod/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const guild = await guilds.getById(str(body['guildId']));
      if (!guild) return reply.redirect('/automod');

      const ruleType = pick(str(body['ruleType']), RULE_TYPES, 'banned_words');
      const config = buildConfig(ruleType, body);
      const fields = {
        guildId: guild.id,
        name: str(body['name']) || ruleType,
        ruleType: ruleType as never,
        enabled: body['enabled'] === 'on',
        config,
        action: pick(str(body['action']), ACTIONS, 'log_only') as never,
        severity: clampInt(body['severity'], 1, 1, 5),
        ignoredChannelIds: parseIds(body['ignoredChannelIds']),
        ignoredRoleIds: parseIds(body['ignoredRoleIds']),
        escalationThreshold: body['escalationThreshold'] ? clampInt(body['escalationThreshold'], 0, 1, 100) : null,
        escalationAction: str(body['escalationAction']) ? (pick(str(body['escalationAction']), ACTIONS, 'timeout') as never) : null,
        responseMessage: str(body['responseMessage']) || null,
      };

      const existing = str(body['id']) ? await repo.getById(str(body['id'])) : null;
      const saved = existing ? await repo.update(existing.id, fields) : await repo.create(fields);
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: existing ? 'automod.rule.updated' : 'automod.rule.created',
        moduleKey: 'automod',
        guildId: guild.externalId,
        targetType: 'automod_rule',
        targetId: saved?.id,
      });
      return reply.redirect(`/automod?guild=${guild.id}&msg=Saved`);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/automod/:id/delete',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const rule = await repo.getById(request.params.id);
      if (!rule) return reply.callNotFound();
      await repo.delete(rule.id);
      return reply.redirect('/automod?msg=Deleted');
    }
  );
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function pick<T extends string>(v: string, allowed: string[], fb: T): string {
  return allowed.includes(v) ? v : fb;
}
function clampInt(v: unknown, fb: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fb;
}
function parseIds(v: unknown): string[] {
  return str(v).split(/[,\n]/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
}

function buildConfig(ruleType: string, body: Record<string, unknown>): Record<string, unknown> {
  switch (ruleType) {
    case 'banned_words':
      return { words: str(body['words']).split(/[,\n]/).map((w) => w.trim()).filter(Boolean) };
    case 'mention_spam':
      return { mentionThreshold: clampInt(body['mentionThreshold'], 5, 1, 50) };
    case 'caps':
      return { capsMinLength: clampInt(body['capsMinLength'], 10, 1, 500), capsRatio: 0.7 };
    case 'suspicious_links':
      return { allowedDomains: str(body['allowedDomains']).split(/[,\n]/).map((d) => d.trim().toLowerCase()).filter(Boolean) };
    case 'new_account':
      return { minAccountAgeDays: clampInt(body['minAccountAgeDays'], 7, 1, 365) };
    case 'spam':
      return { threshold: clampInt(body['threshold'], 5, 2, 50) };
    default:
      return safeJsonParse<Record<string, unknown>>(str(body['config']) || '{}', {});
  }
}
