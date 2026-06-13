import { createBirthdayRepo } from '@botplatform/birthdays-module';
import { createCardsRepo } from '@botplatform/cards-module';
import { createGuildsRepo } from '@botplatform/database';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

export const registerBirthdayRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const repo = createBirthdayRepo(ctx.db);
  const guilds = createGuildsRepo(ctx.db);
  const cards = createCardsRepo(ctx.db);

  app.get('/birthdays', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const [settings, upcoming] = await Promise.all([
      guildId ? repo.getSettings(guildId) : Promise.resolve(undefined),
      guildId ? repo.forGuild(guildId) : Promise.resolve([]),
    ]);
    const query = request.query as Record<string, string | undefined>;
    return reply.view('birthdays', {
      ...ctx.pageLocals(request, reply, 'Birthdays'),
      guilds: guildList,
      selectedGuildId: guildId,
      settings: settings ?? null,
      upcoming: upcoming.filter((b) => b.visibility !== 'private').slice(0, 25),
      cardTemplates: guildId ? await cards.listTemplates(guildId) : [],
      saved: query['saved'] === '1',
    });
  });

  app.post<{ Body: Record<string, unknown> }>(
    '/birthdays/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const guild = await guilds.getById(str(body['guildId']));
      if (!guild) return reply.redirect('/birthdays');
      await repo.upsertSettings(guild.id, {
        enabled: body['enabled'] === 'on',
        announcementChannelId: str(body['announcementChannelId']) || null,
        message: str(body['message']) || '🎉 Happy birthday {{user.mention}}!',
        cardTemplateId: str(body['cardTemplateId']) || null,
        roleEnabled: body['roleEnabled'] === 'on',
        roleId: str(body['roleId']) || null,
        roleDurationHours: clampInt(body['roleDurationHours'], 24, 1, 168),
        announceHour: clampInt(body['announceHour'], 9, 0, 23),
      });
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'birthday.settings.updated',
        moduleKey: 'birthdays',
        guildId: guild.externalId,
        targetType: 'guild',
        targetId: guild.id,
      });
      return reply.redirect(`/birthdays?guild=${guild.id}&saved=1`);
    }
  );

  // Admin deletion of a stored birthday (privacy / moderation).
  app.post<{ Body: { guildId?: string; userExternalId?: string } }>(
    '/birthdays/delete',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const guildId = str(request.body.guildId);
      const userId = str(request.body.userExternalId);
      if (guildId && userId) {
        await repo.remove(guildId, userId);
        await ctx.audit.record({
          actorType: 'admin',
          actorId: request.session.get('adminId'),
          action: 'birthday.deleted',
          moduleKey: 'birthdays',
          targetType: 'user',
          targetId: userId,
        });
      }
      return reply.redirect(`/birthdays?guild=${guildId}`);
    }
  );
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function clampInt(v: unknown, fb: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fb;
}
