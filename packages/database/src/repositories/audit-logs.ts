import { desc, eq, sql, type SQL } from 'drizzle-orm';
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
        guildId: entry.guildId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: sanitizeMetadata(entry.metadata),
      });
    },

    async listRecent(options: { limit?: number; offset?: number; action?: string } = {}): Promise<
      AuditLogRow[]
    > {
      const limit = Math.min(options.limit ?? 50, 200);
      const where: SQL | undefined = options.action
        ? eq(auditLogs.action, options.action)
        : undefined;
      const query = db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit)
        .offset(options.offset ?? 0);
      return where ? query.where(where) : query;
    },

    async count(): Promise<number> {
      const rows = await db.select({ value: sql<number>`count(*)::int` }).from(auditLogs);
      return rows[0]?.value ?? 0;
    },
  };
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
