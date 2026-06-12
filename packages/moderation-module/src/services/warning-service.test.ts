import type { AuditEntry } from '@botplatform/core';
import type { GuildRow, PlatformUserRow, WarningRow } from '@botplatform/database';
import { createSilentLogger } from '@botplatform/logger';
import { describe, expect, it, vi } from 'vitest';
import { createWarningService } from './warning-service.js';

const now = new Date();

const guildRow: GuildRow = {
  id: 'guild-uuid',
  adapterKey: 'discord',
  externalId: 'guild-ext-1',
  name: 'Test Guild',
  createdAt: now,
  updatedAt: now,
};

const userRow: PlatformUserRow = {
  id: 'user-uuid',
  adapterKey: 'discord',
  externalId: 'user-ext-1',
  username: 'tester',
  firstSeenAt: now,
  lastSeenAt: now,
};

const warningRow: WarningRow = {
  id: 'warning-uuid',
  guildId: 'guild-uuid',
  userId: 'user-uuid',
  moderatorId: 'mod-ext-1',
  reason: 'spamming links',
  createdAt: now,
  revokedAt: null,
};

function makeDeps() {
  const auditEntries: AuditEntry[] = [];
  return {
    guilds: { upsertByExternalId: vi.fn(async () => guildRow) },
    moderation: {
      upsertPlatformUser: vi.fn(async () => userRow),
      addWarning: vi.fn(async () => warningRow),
      revokeWarning: vi.fn(async () => {}),
      listWarnings: vi.fn(async () => [warningRow]),
    },
    logger: createSilentLogger(),
    audit: {
      record: vi.fn(async (entry: AuditEntry) => {
        auditEntries.push(entry);
      }),
    },
    auditEntries,
  };
}

describe('WarningService', () => {
  it('ensures guild and user rows, inserts the warning, then audits', async () => {
    const deps = makeDeps();
    const service = createWarningService(deps);

    const result = await service.warnUser({
      guildExternalId: 'guild-ext-1',
      adapterKey: 'discord',
      user: { externalId: 'user-ext-1', username: 'tester' },
      moderatorId: 'mod-ext-1',
      reason: 'spamming links',
    });

    expect(result).toBe(warningRow);
    expect(deps.guilds.upsertByExternalId).toHaveBeenCalledWith({
      adapterKey: 'discord',
      externalId: 'guild-ext-1',
    });
    expect(deps.moderation.upsertPlatformUser).toHaveBeenCalledWith({
      adapterKey: 'discord',
      externalId: 'user-ext-1',
      username: 'tester',
    });
    expect(deps.moderation.addWarning).toHaveBeenCalledWith({
      guildId: 'guild-uuid',
      userId: 'user-uuid',
      moderatorId: 'mod-ext-1',
      reason: 'spamming links',
    });

    // The ensure-rows calls must precede the insert.
    const guildOrder = deps.guilds.upsertByExternalId.mock.invocationCallOrder[0] ?? Infinity;
    const userOrder = deps.moderation.upsertPlatformUser.mock.invocationCallOrder[0] ?? Infinity;
    const insertOrder = deps.moderation.addWarning.mock.invocationCallOrder[0] ?? -1;
    expect(guildOrder).toBeLessThan(insertOrder);
    expect(userOrder).toBeLessThan(insertOrder);

    expect(deps.auditEntries).toHaveLength(1);
    expect(deps.auditEntries[0]?.action).toBe('moderation.warning.created');
    expect(deps.auditEntries[0]?.guildId).toBe('guild-ext-1');
    expect(deps.auditEntries[0]?.metadata).toMatchObject({ warningId: 'warning-uuid' });
  });

  it('revokes a warning and audits the revocation', async () => {
    const deps = makeDeps();
    const service = createWarningService(deps);

    await service.revoke('warning-uuid');

    expect(deps.moderation.revokeWarning).toHaveBeenCalledWith('warning-uuid');
    expect(deps.auditEntries[0]?.action).toBe('moderation.warning.revoked');
    expect(deps.auditEntries[0]?.targetId).toBe('warning-uuid');
  });

  it('lists recent warnings through the repo', async () => {
    const deps = makeDeps();
    const service = createWarningService(deps);

    await expect(service.listRecent(10)).resolves.toEqual([warningRow]);
    expect(deps.moderation.listWarnings).toHaveBeenCalledWith(10);
  });
});
