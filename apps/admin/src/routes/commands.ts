import { COMMAND_CATALOG } from '../command-catalog.js';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

/** A read-only documentation page listing every slash command by module. */
export const registerCommandsRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  app.get('/commands', { preHandler: ctx.requireAuth }, async (request, reply) => {
    const totalCommands = COMMAND_CATALOG.reduce((sum, m) => sum + m.commands.length, 0);
    return reply.view('commands', {
      ...ctx.pageLocals(request, reply, 'Commands'),
      modules: COMMAND_CATALOG,
      totalCommands,
      messageContentEnabled: ctx.config.discord.enableMessageContent,
    });
  });
};
