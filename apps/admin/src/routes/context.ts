import type { AppConfig } from '@botplatform/config';
import type { AuditLogPort } from '@botplatform/core';
import type { Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { BotStatusClient } from '../bot-client.js';

/**
 * Shared context passed to every community-module admin route plugin. Modules
 * use these helpers instead of re-deriving auth/CSRF/repos, so each module's
 * routes live in its own file without touching the core server.
 */
export interface AdminRouteContext {
  config: AppConfig;
  db: Db;
  logger: Logger;
  audit: AuditLogPort;
  botClient: BotStatusClient;
  /** preHandler that redirects unauthenticated requests to /login. */
  requireAuth: preHandlerHookHandler;
  /** preHandler that 403s viewers (owner/admin may proceed). */
  requireMutatingRole: preHandlerHookHandler;
  /** Fastify CSRF protection preHandler. */
  csrfProtection: preHandlerHookHandler;
  /** Build the per-page template locals (title, nav state, csrf token, admin email). */
  pageLocals(request: FastifyRequest, reply: FastifyReply, title: string): Record<string, unknown>;
}

/** A community module contributes its admin routes via one of these. */
export type AdminRoutePlugin = (app: FastifyInstance, ctx: AdminRouteContext) => void;
