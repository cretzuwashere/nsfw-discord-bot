import type { AdminRoutePlugin } from './context.js';
import { registerAnnouncementRoutes } from './announcements.js';
import { registerPlaceholderRoutes } from './placeholders.js';

/**
 * Community module admin route plugins. Adding a module = one import + one
 * entry here; each plugin owns its own file and views. The placeholder plugin
 * MUST stay last and only covers paths no real module owns yet.
 */
export const COMMUNITY_ROUTE_PLUGINS: AdminRoutePlugin[] = [
  registerAnnouncementRoutes,
  registerPlaceholderRoutes,
];

export type { AdminRouteContext, AdminRoutePlugin } from './context.js';
