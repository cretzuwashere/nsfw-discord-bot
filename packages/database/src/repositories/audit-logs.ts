import { and, desc, eq, like, sql, type SQL } from 'drizzle-orm';
import type { AuditEntry } from '@botplatform/core';
import type { Db } from '../client.js';
import { auditLogs } from '../schema.js';

export type AuditLogRow = typeof auditLogs.$inferSelect;

export function createAuditLogsRepo(db: Db) {
  return {
    async insert(entry: AuditEntry): Promise<void> {
      await db.insert(auditLogs).values({
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action.slice(0, 200),
        moduleKey: entry.moduleKey ?? null,
        severity: entry.severity ?? 'info',
        guildId: entry.guildId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: sanitizeMetadata(entry.metadata),
      });
    },

    async listRecent(options: AuditFilter & { limit?: number; offset?: number } = {}): Promise<
      AuditLogRow[]
    > {
      const limit = Math.min(options.limit ?? 50, 200);
      const where = buildFilter(options);
      const query = db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit)
        .offset(options.offset ?? 0);
      return where ? query.where(where) : query;
    },

    async count(options: AuditFilter = {}): Promise<number> {
      const where = buildFilter(options);
      const base = db.select({ value: sql<number>`count(*)::int` }).from(auditLogs);
      const rows = await (where ? base.where(where) : base);
      return rows[0]?.value ?? 0;
    },
  };
}

export interface AuditFilter {
  action?: string | undefined;
  moduleKey?: string | undefined;
  severity?: string | undefined;
  actorId?: string | undefined;
}

/** Combine the optional filter dimensions into a single WHERE clause. */
function buildFilter(options: AuditFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (options.action) {
    const escaped = options.action.replace(/[\\%_]/g, (char) => `\\${char}`);
    clauses.push(like(auditLogs.action, `%${escaped}%`));
  }
  if (options.moduleKey) clauses.push(eq(auditLogs.moduleKey, options.moduleKey));
  if (options.severity) {
    clauses.push(
      eq(auditLogs.severity, options.severity as (typeof auditLogs.severity.enumValues)[number])
    );
  }
  if (options.actorId) clauses.push(eq(auditLogs.actorId, options.actorId));
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

/** Defensive: metadata must be JSON-serializable and free of obvious secrets. */
function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const clean = JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
    for (const key of Object.keys(clean)) {
      if (/token|password|secret|authorization/i.test(key)) {
        clean[key] = '[REDACTED]';
      }
    }
    return clean;
  } catch {
    return { note: 'metadata was not serializable' };
  }
}

export type AuditLogsRepo = ReturnType<typeof createAuditLogsRepo>;
