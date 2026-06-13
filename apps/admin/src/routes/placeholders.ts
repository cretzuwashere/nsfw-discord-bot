import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

/**
 * Temporary placeholder pages for community modules whose full admin UI is
 * not implemented yet, so the navigation never 404s. As each module lands,
 * remove its path from PLACEHOLDER_PAGES (the real route then owns it).
 */
const PLACEHOLDER_PAGES: Array<{ path: string; title: string; description: string }> = [
  { path: '/reminders', title: 'Reminders', description: 'Personal reminders are created in Discord with /reminder create|list|remove. Recurring and timezone-aware.' },
  { path: '/automod', title: 'Auto-Moderation', description: 'Banned words, spam, mention and link filtering with escalation.' },
  { path: '/permissions', title: 'Permissions', description: 'Map platform roles to module permissions.' },
];

export const registerPlaceholderRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  for (const page of PLACEHOLDER_PAGES) {
    app.get(page.path, { preHandler: ctx.requireAuth }, async (request, reply) =>
      reply.view('placeholder', {
        ...ctx.pageLocals(request, reply, page.title),
        pageTitle: page.title,
        description: page.description,
      })
    );
  }
};
