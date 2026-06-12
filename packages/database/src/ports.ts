import type { AuditEntry, AuditLogPort, HealthIndicator, ModuleStatePort } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import type { Db } from './client.js';
import { pingDatabase } from './client.js';
import { createAuditLogsRepo } from './repositories/audit-logs.js';
import { createModulesRepo } from './repositories/modules.js';

/**
 * Database-backed audit log. NEVER throws — an audit failure must not break
 * the feature being audited. Failures are logged instead.
 */
export function createDbAuditLog(db: Db, logger: Logger): AuditLogPort {
  const repo = createAuditLogsRepo(db);
  return {
    async record(entry: AuditEntry): Promise<void> {
      try {
        await repo.insert(entry);
      } catch (error) {
        logger.warn({ err: error, action: entry.action }, 'audit log write failed');
      }
    },
  };
}

/** Database-backed module enabled/disabled state. */
export function createDbModuleState(db: Db): ModuleStatePort {
  const repo = createModulesRepo(db);
  return {
    isEnabled: (moduleKey: string) => repo.isEnabled(moduleKey),
  };
}

/** Health indicator that probes database connectivity. */
export function createDbHealthIndicator(db: Db): HealthIndicator {
  return {
    name: 'database',
    async check() {
      try {
        await pingDatabase(db);
        return { status: 'ok' as const };
      } catch (error) {
        return {
          status: 'error' as const,
          detail: error instanceof Error ? 'connection failed' : 'unknown error',
        };
      }
    },
  };
}
