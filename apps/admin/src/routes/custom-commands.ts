import { createGuildsRepo } from '@botplatform/database';
import { createCustomCommandRepo, isValidCommandName } from '@botplatform/custom-commands-module';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

export const registerCustomCommandRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const repo = createCustomCommandRepo(ctx.db);
  const guilds = createGuildsRepo(ctx.db);

  app.get('/custom-commands', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const rows = guildId ? await repo.listByGuild(guildId) : [];
    const query = request.query as Record<string, string | undefined>;
    return reply.view('custom-commands', {
      ...ctx.pageLocals(request, reply, 'Custom Commands'),
      guilds: guildList,
      selectedGuildId: guildId,
      commands: rows,
      message: query['msg'] ?? null,
    });
  });

  app.get('/custom-commands/new', { preHandler: ctx.requireAuth }, async (request, reply) => {
    return reply.view('custom-command-edit', {
      ...ctx.pageLocals(request, reply, 'New Custom Command'),
      guilds: await guilds.list(),
      command: null,
      errors: [],
    });
  });

  app.get<{ Params: { id: string } }>(
    '/custom-commands/:id',
    { preHandler: ctx.requireAuth },
    async (request, reply) => {
      const command = await repo.getById(request.params.id);
      if (!command) return reply.callNotFound();
      return reply.view('custom-command-edit', {
        ...ctx.pageLocals(request, reply, 'Edit Custom Command'),
        guilds: await guilds.list(),
        command,
        errors: [],
      });
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/custom-commands/:id/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const name = str(body['name']).toLowerCase();
      const guild = await guilds.getById(str(body['guildId']));
      const responseType = pick(str(body['responseType']), ['text', 'embed', 'random', 'link'], 'text');
      const errors: string[] = [];
      if (!guild) errors.push('Select a server.');
      if (!isValidCommandName(name)) errors.push('Name must be 1–32 chars: lowercase letters, digits, _ or -.');

      const response = buildResponse(responseType, body, errors);

      // Uniqueness within the guild.
      if (guild && errors.length === 0) {
        const existing = await repo.getByName(guild.id, name);
        if (existing && existing.id !== request.params.id) errors.push('A command with that name already exists.');
      }

      if (errors.length > 0 || !guild) {
        return reply.code(400).view('custom-command-edit', {
          ...ctx.pageLocals(request, reply, 'Custom Command'),
          guilds: await guilds.list(),
          command: { ...body, id: request.params.id === 'new' ? undefined : request.params.id },
          errors,
        });
      }

      const fields = {
        guildId: guild.id,
        name,
        description: str(body['description']),
        responseType,
        response,
        allowedRoleIds: parseIds(body['allowedRoleIds']),
        allowedChannelIds: parseIds(body['allowedChannelIds']),
        enabled: body['enabled'] !== 'off',
        cooldownSeconds: clampInt(body['cooldownSeconds'], 0, 0, 86400),
      };
      const existing = request.params.id !== 'new' ? await repo.getById(request.params.id) : null;
      const saved = existing ? await repo.update(existing.id, fields) : await repo.create(fields);

      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: existing ? 'custom-command.updated' : 'custom-command.created',
        moduleKey: 'custom-commands',
        guildId: guild.externalId,
        targetType: 'custom_command',
        targetId: saved?.id,
      });
      return reply.redirect('/custom-commands?msg=Saved');
    }
  );

  app.post<{ Params: { id: string } }>(
    '/custom-commands/:id/delete',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const command = await repo.getById(request.params.id);
      if (!command) return reply.callNotFound();
      await repo.delete(command.id);
      return reply.redirect('/custom-commands?msg=Deleted');
    }
  );

  function buildResponse(type: string, body: Record<string, unknown>, errors: string[]): Record<string, unknown> {
    switch (type) {
      case 'embed':
        return { title: str(body['title']), description: str(body['description_body']), color: 0x4f8cff };
      case 'random': {
        const choices = str(body['choices']).split('\n').map((s) => s.trim()).filter(Boolean);
        if (choices.length === 0) errors.push('Add at least one choice (one per line).');
        return { choices };
      }
      case 'link':
        return { text: str(body['text']), url: str(body['url']), label: str(body['label']) || 'Open' };
      case 'text':
      default: {
        const text = str(body['text']);
        if (!text) errors.push('Response text is required.');
        return { text };
      }
    }
  }
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function pick<T extends string>(v: string, allowed: T[], fb: T): T {
  return (allowed as string[]).includes(v) ? (v as T) : fb;
}
function clampInt(v: unknown, fb: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fb;
}
function parseIds(v: unknown): string[] {
  return str(v).split(/[,\n]/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
}
