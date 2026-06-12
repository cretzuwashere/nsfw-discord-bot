import type { AppConfig } from '@botplatform/config';
import type { AdapterStatus, AuditLogPort } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import { timingSafeEqualStrings } from '@botplatform/security';
import {
  INTERNAL_TOKEN_HEADER,
  type HealthCheckResult,
  type InternalActionResult,
  type InternalBotStatus,
  type QueueSnapshot,
} from '@botplatform/shared';
import fastify, { type FastifyInstance } from 'fastify';

/**
 * Narrow, structurally-typed dependencies so tests can pass simple fakes
 * instead of a full kernel.
 */
export interface InternalApiDeps {
  config: AppConfig;
  logger: Logger;
  health: { run(): Promise<HealthCheckResult> };
  modules: { list(): Array<{ key: string; name: string }> };
  moduleState: { isEnabled(key: string): Promise<boolean> };
  adapters: Array<{ key: string; getStatus(): AdapterStatus }>;
  audio: {
    getSnapshots(): QueueSnapshot[];
    skip(guildExternalId: string): Promise<InternalActionResult>;
    stop(guildExternalId: string): Promise<InternalActionResult>;
    clearQueue(guildExternalId: string): Promise<InternalActionResult>;
  };
  audit: AuditLogPort;
  startedAt: Date;
}

/**
 * The bot worker's HTTP surface: a public health endpoint for container
 * checks plus a token-guarded internal API consumed by the admin panel over
 * the Docker network. Never exposed to the host.
 */
export function buildInternalApi(deps: InternalApiDeps): FastifyInstance {
  const app = fastify({ logger: false });

  app.get('/healthz', async (_request, reply) => {
    const result = await deps.health.run();
    return reply.code(result.status === 'ok' ? 200 : 503).send(result);
  });

  app.register(async (internal) => {
    internal.addHook('onRequest', async (request, reply) => {
      const token = request.headers[INTERNAL_TOKEN_HEADER];
      const expected = deps.config.bot.internalApiToken;
      if (typeof token !== 'string' || !timingSafeEqualStrings(token, expected)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });

    internal.get('/status', async (): Promise<InternalBotStatus> => {
      const modules = await Promise.all(
        deps.modules.list().map(async (module) => ({
          key: module.key,
          name: module.name,
          enabled: await deps.moduleState.isEnabled(module.key),
        }))
      );
      return {
        startedAt: deps.startedAt.toISOString(),
        uptimeSeconds: Math.floor((Date.now() - deps.startedAt.getTime()) / 1000),
        version: deps.config.version,
        environment: deps.config.nodeEnv,
        adapters: deps.adapters.map((adapter) => ({
          key: adapter.key,
          ...adapter.getStatus(),
        })),
        modules,
        audio: { sessions: deps.audio.getSnapshots() },
      };
    });

    const audioActions = [
      { path: '/audio/:guildId/skip', action: 'skip' as const },
      { path: '/audio/:guildId/stop', action: 'stop' as const },
      { path: '/audio/:guildId/clear-queue', action: 'clearQueue' as const },
    ];
    for (const { path, action } of audioActions) {
      internal.post<{ Params: { guildId: string } }>(path, async (request) => {
        const { guildId } = request.params;
        const result = await deps.audio[action](guildId);
        await deps.audit.record({
          actorType: 'admin',
          action: `audio.admin.${action === 'clearQueue' ? 'clear-queue' : action}`,
          guildId,
          metadata: { ok: result.ok },
        });
        return result;
      });
    }
  }, { prefix: '/internal' });

  return app;
}
