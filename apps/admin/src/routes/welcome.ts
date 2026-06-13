import { createCardsRepo } from '@botplatform/cards-module';
import { createGuildsRepo } from '@botplatform/database';
import { createWelcomeRepo } from '@botplatform/welcome-module';
import { parseCsvList } from '@botplatform/shared';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

/** Welcome/Leave configuration UI (per guild). */
export const registerWelcomeRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const welcome = createWelcomeRepo(ctx.db);
  const guilds = createGuildsRepo(ctx.db);
  const cards = createCardsRepo(ctx.db);

  app.get('/welcome', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const settings = guildId ? await welcome.get(guildId) : undefined;
    const query = request.query as Record<string, string | undefined>;
    return reply.view('welcome', {
      ...ctx.pageLocals(request, reply, 'Welcome / Leave'),
      guilds: guildList,
      selectedGuildId: guildId,
      settings: settings ?? null,
      cardTemplates: await cards.listTemplates(guildId),
      saved: query['saved'] === '1',
    });
  });

  app.post<{ Body: Record<string, unknown> }>(
    '/welcome/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const guildId = String(body['guildId'] ?? '');
      const guild = guildId ? await guilds.getById(guildId) : undefined;
      if (!guild) return reply.redirect('/welcome');

      const delaySeconds = clampInt(body['delaySeconds'], 0, 0, 3600);
      await welcome.upsert(guildId, {
        welcomeEnabled: body['welcomeEnabled'] === 'on',
        leaveEnabled: body['leaveEnabled'] === 'on',
        welcomeChannelId: str(body['welcomeChannelId']) || null,
        leaveChannelId: str(body['leaveChannelId']) || null,
        welcomeMessage: str(body['welcomeMessage']) || 'Welcome {{user.mention}}!',
        leaveMessage: str(body['leaveMessage']) || '{{user.username}} left.',
        welcomeCardTemplateId: str(body['welcomeCardTemplateId']) || null,
        dmEnabled: body['dmEnabled'] === 'on',
        dmMessage: str(body['dmMessage']),
        autoRoleIds: parseRoleIds(body['autoRoleIds']),
        rulesChannelId: str(body['rulesChannelId']) || null,
        delaySeconds,
        logChannelId: str(body['logChannelId']) || null,
      });

      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'welcome.settings.updated',
        moduleKey: 'welcome',
        guildId: guild.externalId,
        targetType: 'guild',
        targetId: guildId,
      });
      return reply.redirect(`/welcome?guild=${guildId}&saved=1`);
    }
  );
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseRoleIds(value: unknown): string[] {
  // Role IDs are numeric snowflakes; reuse the CSV/line splitter then keep digits.
  return parseCsvList(typeof value === 'string' ? value.replace(/\n/g, ',') : '')
    .map((v) => v.trim())
    .filter((v) => /^\d+$/.test(v));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
