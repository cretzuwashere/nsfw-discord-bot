import { randomUUID } from 'node:crypto';
import { createSilentLogger } from '@botplatform/logger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAuditLogsRepo,
  createDatabase,
  createDbAuditLog,
  resolveTestDatabaseUrl,
  type Database,
} from '../../src/index.js';

let database: Database;

beforeAll(() => {
  database = createDatabase(resolveTestDatabaseUrl());
});

afterAll(async () => {
  await database.close();
});

describe('db audit log', () => {
  it('records entries readable via listRecent', async () => {
    const auditLog = createDbAuditLog(database.db, createSilentLogger());
    const repo = createAuditLogsRepo(database.db);
    const action = `test.audit.${randomUUID()}`;

    await auditLog.record({
      actorType: 'system',
      actorId: 'integration-test',
      action,
      guildId: 'guild-123',
      targetType: 'track',
      targetId: 'track-1',
      metadata: { detail: 'hello' },
    });

    const rows = await repo.listRecent({ action });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorType).toBe('system');
    expect(rows[0]?.actorId).toBe('integration-test');
    expect(rows[0]?.guildId).toBe('guild-123');
    expect(rows[0]?.metadata).toEqual({ detail: 'hello' });
  });

  it('redacts metadata keys that look like secrets', async () => {
    const auditLog = createDbAuditLog(database.db, createSilentLogger());
    const repo = createAuditLogsRepo(database.db);
    const action = `test.audit.redact.${randomUUID()}`;

    await auditLog.record({
      actorType: 'admin',
      action,
      metadata: {
        apiToken: 'super-secret-token',
        password: 'hunter2',
        clientSecret: 'shhh',
        safeField: 'keep me',
      },
    });

    const rows = await repo.listRecent({ action });
    expect(rows).toHaveLength(1);
    const metadata = rows[0]?.metadata as Record<string, unknown>;
    expect(metadata.apiToken).toBe('[REDACTED]');
    expect(metadata.password).toBe('[REDACTED]');
    expect(metadata.clientSecret).toBe('[REDACTED]');
    expect(metadata.safeField).toBe('keep me');
  });

  it('never throws even when the underlying database is unusable', async () => {
    // A pool that has been closed rejects every query — exactly the failure
    // mode the audit port must swallow.
    const closedDatabase = createDatabase(resolveTestDatabaseUrl());
    await closedDatabase.close();

    const auditLog = createDbAuditLog(closedDatabase.db, createSilentLogger());
    await expect(
      auditLog.record({ actorType: 'system', action: 'test.audit.broken-db' })
    ).resolves.toBeUndefined();
  });
});
