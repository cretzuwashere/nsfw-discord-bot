import {
  buildPlaceholderData,
  CardAssetStorage,
  createCardsRepo,
  createCardsService,
  normalizeLayout,
  SUPPORTED_PLACEHOLDERS,
} from '@botplatform/cards-module';
import { safeJsonParse } from '@botplatform/shared';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

/** Sample data used for template previews in the admin panel. */
const PREVIEW_DATA = buildPlaceholderData({
  user: { id: '1', username: 'SampleUser', displayName: 'Sample User', avatarUrl: '' },
  server: { name: 'Sample Server', memberCount: 1234 },
  birthday: { age: 25 },
  role: { name: 'Member' },
  today: new Date().toISOString().slice(0, 10),
});

export const registerCardsRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const cards = createCardsRepo(ctx.db);
  const storage = new CardAssetStorage(ctx.config.storage.uploadsDir);
  const service = createCardsService({ cards, storage, logger: ctx.logger });

  app.get('/cards', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const templates = await cards.listTemplates(null);
    const assets = await cards.listAssets(null);
    const query = request.query as Record<string, string | undefined>;
    return reply.view('cards', {
      ...ctx.pageLocals(request, reply, 'Dynamic Cards'),
      templates,
      assets,
      placeholders: SUPPORTED_PLACEHOLDERS,
      message: query['msg'] ?? null,
    });
  });

  app.get('/cards/new', { preHandler: ctx.requireAuth }, async (request, reply) => {
    return reply.view('card-edit', {
      ...ctx.pageLocals(request, reply, 'New Card Template'),
      template: null,
      assets: await cards.listAssets(null),
      placeholders: SUPPORTED_PLACEHOLDERS,
      errors: [],
    });
  });

  app.get<{ Params: { id: string } }>(
    '/cards/:id',
    { preHandler: ctx.requireAuth },
    async (request, reply) => {
      const template = await cards.getTemplate(request.params.id);
      if (!template) return reply.callNotFound();
      return reply.view('card-edit', {
        ...ctx.pageLocals(request, reply, 'Edit Card Template'),
        template,
        assets: await cards.listAssets(null),
        placeholders: SUPPORTED_PLACEHOLDERS,
        errors: [],
      });
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/cards/:id/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const name = String(body['name'] ?? '').trim();
      const width = clampInt(body['width'], 1000, 100, 4000);
      const height = clampInt(body['height'], 420, 100, 4000);
      const kind = String(body['kind'] ?? 'generic');
      const layoutRaw = safeJsonParse<unknown>(String(body['layout'] ?? '{}'), {});
      const layout = normalizeLayout(layoutRaw, { width, height });

      if (!name) {
        return reply.code(400).view('card-edit', {
          ...ctx.pageLocals(request, reply, 'Card Template'),
          template: { ...body },
          assets: await cards.listAssets(null),
          placeholders: SUPPORTED_PLACEHOLDERS,
          errors: ['A template name is required.'],
        });
      }

      const existing = request.params.id !== 'new' ? await cards.getTemplate(request.params.id) : null;
      const fields = { name, kind, width, height, layout };
      const saved = existing
        ? await cards.updateTemplate(existing.id, fields)
        : await cards.createTemplate(fields);

      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: existing ? 'card.template.updated' : 'card.template.created',
        moduleKey: 'dynamic-cards',
        targetType: 'card_template',
        targetId: saved?.id,
      });
      return reply.redirect(`/cards/${saved?.id}?`);
    }
  );

  // Live PNG preview rendered with sample data.
  app.get<{ Params: { id: string } }>(
    '/cards/:id/preview.png',
    { preHandler: ctx.requireAuth },
    async (request, reply) => {
      const template = await cards.getTemplate(request.params.id);
      if (!template) return reply.callNotFound();
      try {
        const png = await service.renderTemplate(template, PREVIEW_DATA);
        return reply.header('content-type', 'image/png').header('cache-control', 'no-store').send(png);
      } catch (error) {
        ctx.logger.warn({ err: error }, 'card preview render failed');
        return reply.code(500).send('preview failed');
      }
    }
  );

  // Multipart upload: CSRF for file uploads is covered by the SameSite=Lax
  // session cookie (a cross-site POST never carries the session) plus the
  // auth + role guards; the @fastify/csrf body-token check does not apply to
  // streamed multipart bodies.
  app.post(
    '/cards/upload',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.redirect('/cards?msg=No+file+selected');
      const data = await file.toBuffer();
      const result = await storage.store({ guildId: null, data, mimeType: file.mimetype });
      if (!result.ok) {
        return reply.redirect(`/cards?msg=${encodeURIComponent(result.error)}`);
      }
      const asset = await cards.createAsset({
        guildId: null,
        storagePath: result.asset.storagePath,
        originalName: file.filename.slice(0, 200),
        mimeType: result.asset.mimeType,
        byteSize: result.asset.byteSize,
      });
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'card.asset.uploaded',
        moduleKey: 'dynamic-cards',
        targetType: 'card_asset',
        targetId: asset.id,
      });
      return reply.redirect('/cards?msg=Background+uploaded');
    }
  );

  app.post<{ Params: { id: string } }>(
    '/cards/:id/archive',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const template = await cards.getTemplate(request.params.id);
      if (!template) return reply.callNotFound();
      await cards.archiveTemplate(template.id);
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: 'card.template.archived',
        moduleKey: 'dynamic-cards',
        targetType: 'card_template',
        targetId: template.id,
      });
      return reply.redirect('/cards?msg=Template+archived');
    }
  );
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
