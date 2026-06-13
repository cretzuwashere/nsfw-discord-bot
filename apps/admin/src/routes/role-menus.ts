import { createGuildsRepo } from '@botplatform/database';
import { createRoleMenuRepo } from '@botplatform/role-menus-module';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

/** Role-menu configuration UI. Publishing is done in Discord via /roles menu. */
export const registerRoleMenuRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const menus = createRoleMenuRepo(ctx.db);
  const guilds = createGuildsRepo(ctx.db);

  app.get('/role-menus', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const guildList = await guilds.list();
    const guildId = (request.query as Record<string, string>)['guild'] ?? guildList[0]?.id ?? null;
    const rows = guildId ? await menus.listByGuild(guildId) : [];
    const query = request.query as Record<string, string | undefined>;
    return reply.view('role-menus', {
      ...ctx.pageLocals(request, reply, 'Reaction Roles'),
      guilds: guildList,
      selectedGuildId: guildId,
      menus: rows,
      message: query['msg'] ?? null,
    });
  });

  app.get('/role-menus/new', { preHandler: ctx.requireAuth }, async (request, reply) => {
    return reply.view('role-menu-edit', {
      ...ctx.pageLocals(request, reply, 'New Role Menu'),
      guilds: await guilds.list(),
      menu: null,
      options: [],
      errors: [],
    });
  });

  app.get<{ Params: { id: string } }>(
    '/role-menus/:id',
    { preHandler: ctx.requireAuth },
    async (request, reply) => {
      const menu = await menus.getWithOptions(request.params.id);
      if (!menu) return reply.callNotFound();
      return reply.view('role-menu-edit', {
        ...ctx.pageLocals(request, reply, 'Edit Role Menu'),
        guilds: await guilds.list(),
        menu,
        options: menu.options,
        errors: [],
      });
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/role-menus/:id/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const body = request.body;
      const name = str(body['name']);
      const guildId = str(body['guildId']);
      const guild = guildId ? await guilds.getById(guildId) : undefined;
      const errors: string[] = [];
      if (!name) errors.push('A menu name is required.');
      if (!guild) errors.push('Select a server.');

      const parsedOptions = parseOptions(str(body['options']));
      if (parsedOptions.length === 0) errors.push('Add at least one role option (one per line).');

      if (errors.length > 0 || !guild) {
        return reply.code(400).view('role-menu-edit', {
          ...ctx.pageLocals(request, reply, 'Role Menu'),
          guilds: await guilds.list(),
          menu: { ...body, id: request.params.id === 'new' ? undefined : request.params.id },
          options: parsedOptions,
          errors,
        });
      }

      const constraints: Record<string, unknown> = {};
      const maxSel = Number(str(body['maxSelections']));
      if (Number.isInteger(maxSel) && maxSel > 0) constraints['maxSelections'] = maxSel;
      if (str(body['requiredRoleId'])) constraints['requiredRoleId'] = str(body['requiredRoleId']);
      if (str(body['blockedRoleId'])) constraints['blockedRoleId'] = str(body['blockedRoleId']);

      const fields = {
        guildId: guild.id,
        name,
        type: pick(str(body['type']), ['button', 'select', 'reaction'], 'button'),
        mode: pick(str(body['mode']), ['multiple', 'single', 'toggle', 'add_only', 'remove_only', 'unique'], 'multiple'),
        style: 'embed',
        title: str(body['title']) || 'Select your roles',
        description: str(body['description']),
        constraints,
        enabled: body['enabled'] !== 'off',
      };

      const existing = request.params.id !== 'new' ? await menus.getWithOptions(request.params.id) : null;
      const saved = existing ? await menus.update(existing.id, fields) : await menus.create(fields);
      if (saved) await menus.replaceOptions(saved.id, parsedOptions);

      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: existing ? 'rolemenu.updated' : 'rolemenu.created',
        moduleKey: 'role-menus',
        guildId: guild.externalId,
        targetType: 'role_menu',
        targetId: saved?.id,
      });
      return reply.redirect(`/role-menus/${saved?.id}?`);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/role-menus/:id/toggle',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const menu = await menus.getWithOptions(request.params.id);
      if (!menu) return reply.callNotFound();
      await menus.update(menu.id, { enabled: !menu.enabled });
      return reply.redirect('/role-menus?msg=Updated');
    }
  );
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pick<T extends string>(value: string, allowed: T[], fallback: T): T {
  return (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/** Parse "roleId | label | description | emoji" lines. */
function parseOptions(raw: string): Array<{ roleId: string; label: string; description?: string; emoji?: string | null }> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [roleId, label, description, emoji] = line.split('|').map((p) => p.trim());
      return { roleId: roleId ?? '', label: label || (roleId ?? ''), description: description ?? '', emoji: emoji || null };
    })
    .filter((o) => /^\d+$/.test(o.roleId))
    .slice(0, 25);
}
