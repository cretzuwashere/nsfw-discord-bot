import { createAnnouncementRepo, validateAnnouncement } from '@botplatform/announcements-module';
import { createGuildsRepo } from '@botplatform/database';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

/**
 * Announcements admin UI. The panel creates/edits drafts and schedules
 * delivery; the bot worker's scheduler job delivers due announcements within
 * ~30s (the admin app has no Discord connection). "Send now" schedules for
 * immediate delivery.
 */
export const registerAnnouncementRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const announcements = createAnnouncementRepo(ctx.db);
  const guilds = createGuildsRepo(ctx.db);

  async function firstGuildId(): Promise<string | null> {
    const all = await guilds.list();
    return all[0]?.id ?? null;
  }

  app.get('/announcements', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const rows = guildId
      ? await announcements.listByGuild(guildId, { includeTemplates: true })
      : [];
    const query = request.query as Record<string, string | undefined>;
    return reply.view('announcements', {
      ...ctx.pageLocals(request, reply, 'Announcements'),
      guilds: guildList,
      selectedGuildId: guildId,
      announcements: rows,
      message: query['msg'] ?? null,
    });
  });

  app.get('/announcements/new', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    return reply.view('announcement-edit', {
      ...ctx.pageLocals(request, reply, 'New Announcement'),
      guilds: guildList,
      announcement: null,
      errors: [],
      warnings: [],
    });
  });

  app.get<{ Params: { id: string } }>(
    '/announcements/:id',
    { preHandler: ctx.requireAuth },
    async (request, reply) => {
      const announcement = await announcements.getById(request.params.id);
      if (!announcement) return reply.callNotFound();
      const guildList = await guilds.list();
      return reply.view('announcement-edit', {
        ...ctx.pageLocals(request, reply, 'Edit Announcement'),
        guilds: guildList,
        announcement,
        errors: [],
        warnings: [],
      });
    }
  );

  // Create or update a draft.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/announcements/:id/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const validation = validateAnnouncement(body);
      const guildList = await guilds.list();
      const existing =
        request.params.id !== 'new' ? await announcements.getById(request.params.id) : null;

      if (!validation.ok) {
        return reply.code(400).view('announcement-edit', {
          ...ctx.pageLocals(request, reply, 'Announcement'),
          guilds: guildList,
          announcement: { ...(existing ?? {}), ...body },
          errors: validation.errors,
          warnings: [],
        });
      }

      const guildId =
        (typeof body['guildId'] === 'string' && body['guildId']) ||
        existing?.guildId ||
        (await firstGuildId());
      if (!guildId) {
        return reply.code(400).view('announcement-edit', {
          ...ctx.pageLocals(request, reply, 'Announcement'),
          guilds: guildList,
          announcement: { ...body },
          errors: ['No server is available yet — the bot records servers when it connects.'],
          warnings: [],
        });
      }

      const v = validation.value;
      const fields = {
        guildId,
        title: v.title,
        body: v.body,
        format: v.format,
        targetChannelId: v.targetChannelId,
        mentionMode: v.mentionMode,
        mentionRoleIds: v.mentionRoleIds,
        embedColor: v.embedColor ?? null,
        footer: v.footer ?? null,
        imageUrl: v.imageUrl ?? null,
        isTemplate: body['isTemplate'] === 'on',
      };

      const saved = existing
        ? await announcements.update(existing.id, fields)
        : await announcements.create({ ...fields, status: 'draft', createdBy: request.session.get('adminId') });

      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: existing ? 'announcement.updated' : 'announcement.created',
        moduleKey: 'announcements',
        guildId,
        targetType: 'announcement',
        targetId: saved?.id,
      });
      return reply.redirect(`/announcements/${saved?.id}?saved=1`);
    }
  );

  // Schedule for delivery (now or a future time).
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/announcements/:id/schedule',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const announcement = await announcements.getById(request.params.id);
      if (!announcement) return reply.callNotFound();
      if (announcement.isTemplate) {
        return reply.redirect('/announcements?msg=Templates+cannot+be+sent');
      }
      const when = typeof request.body['scheduledFor'] === 'string' ? request.body['scheduledFor'] : '';
      const sendNow = request.body['sendNow'] === 'on' || !when;
      const scheduledFor = sendNow ? new Date() : new Date(when);
      if (Number.isNaN(scheduledFor.getTime())) {
        return reply.redirect(`/announcements/${announcement.id}?`);
      }
      await announcements.setStatus(announcement.id, 'scheduled', { scheduledFor });
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'announcement.scheduled',
        moduleKey: 'announcements',
        guildId: announcement.guildId,
        targetType: 'announcement',
        targetId: announcement.id,
        metadata: { scheduledFor: scheduledFor.toISOString(), sendNow },
      });
      const msg = sendNow ? 'Queued+for+immediate+delivery' : 'Scheduled';
      return reply.redirect(`/announcements?msg=${msg}`);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/announcements/:id/cancel',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const announcement = await announcements.getById(request.params.id);
      if (!announcement) return reply.callNotFound();
      await announcements.setStatus(announcement.id, 'canceled');
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'announcement.canceled',
        moduleKey: 'announcements',
        guildId: announcement.guildId,
        targetType: 'announcement',
        targetId: announcement.id,
      });
      return reply.redirect('/announcements?msg=Canceled');
    }
  );

  app.post<{ Params: { id: string } }>(
    '/announcements/:id/duplicate',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const source = await announcements.getById(request.params.id);
      if (!source) return reply.callNotFound();
      const copy = await announcements.create({
        guildId: source.guildId,
        title: source.title,
        body: source.body,
        format: source.format,
        targetChannelId: source.targetChannelId,
        mentionMode: source.mentionMode,
        mentionRoleIds: source.mentionRoleIds,
        embedColor: source.embedColor,
        footer: source.footer,
        imageUrl: source.imageUrl,
        isTemplate: false,
        status: 'draft',
        createdBy: request.session.get('adminId'),
      });
      return reply.redirect(`/announcements/${copy.id}?saved=1`);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/announcements/:id/delete',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const announcement = await announcements.getById(request.params.id);
      if (!announcement) return reply.callNotFound();
      await announcements.delete(announcement.id);
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'announcement.deleted',
        moduleKey: 'announcements',
        guildId: announcement.guildId,
        targetType: 'announcement',
        targetId: announcement.id,
      });
      return reply.redirect('/announcements?msg=Deleted');
    }
  );
};
