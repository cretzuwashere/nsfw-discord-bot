import type { AuditEntry } from '@botplatform/core';
import type { GuildRow, ModerationActionRow, PlatformUserRow } from '@botplatform/database';
import { createSilentLogger } from '@botplatform/logger';
import { describe, expect, it, vi } from 'vitest';
import { createModerationActionService } from './action-service.js';

const now = new Date();

const guildRow: GuildRow = {
  id: 'guild-uuid',
  adapterKey: 'discord',
  externalId: 'guild-ext-1',
  name: '',
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

const actionRow: ModerationActionRow = {
  id: 'action-uuid',
  guildId: 'guild-uuid',
  userId: 'user-uuid',
  moderatorId: 'mod-ext-1',
  actionType: 'ban',
  reason: 'repeated spam',
  metadata: {},
  expiresAt: null,
  createdAt: now,
};

function makeDeps() {
  const auditEntries: AuditEntry[] = [];
  return {
    guilds: { upsertByExternalId: vi.fn(async () => guildRow) },
    moderation: {
      upsertPlatformUser: vi.fn(async () => userRow),
      addAction: vi.fn(async () => actionRow),
      listActions: vi.fn(async () => [actionRow]),
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

describe('ModerationActionService', () => {
  it('maps input fields onto the repo insert and audits with the action type', async () => {
    const deps = makeDeps();
    const service = createModerationActionService(deps);
    const expiresAt = new Date('2026-07-01T00:00:00Z');

    const result = await service.recordAction({
      guildExternalId: 'guild-ext-1',
      adapterKey: 'discord',
      user: { externalId: 'user-ext-1', username: 'tester' },
      moderatorId: 'mod-ext-1',
      actionType: 'ban',
      reason: 'repeated spam',
      metadata: { deletedMessageDays: 1 },
      expiresAt,
    });

    expect(result).toBe(actionRow);
    expect(deps.moderation.addAction).toHaveBeenCalledWith({
      guildId: 'guild-uuid',
      userId: 'user-uuid',
      moderatorId: 'mod-ext-1',
      actionType: 'ban',
      reason: 'repeated spam',
      metadata: { deletedMessageDays: 1 },
      expiresAt,
    });
    expect(deps.auditEntries[0]?.action).toBe('moderation.action.ban');
    expect(deps.auditEntries[0]?.targetId).toBe('user-ext-1');
    // Caller metadata must not leak into the audit entry.
    expect(deps.auditEntries[0]?.metadata).not.toHaveProperty('deletedMessageDays');
    expect(deps.auditEntries[0]?.metadata).toMatchObject({ actionId: 'action-uuid' });
  });

  it('supports actions without a target user (e.g. purge)', async () => {
    const deps = makeDeps();
    const service = createModerationActionService(deps);

    await service.recordAction({
      guildExternalId: 'guild-ext-1',
      adapterKey: 'discord',
      moderatorId: 'mod-ext-1',
      actionType: 'purge',
    });

    expect(deps.moderation.upsertPlatformUser).not.toHaveBeenCalled();
    expect(deps.moderation.addAction).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: 'guild-uuid', userId: undefined, actionType: 'purge' })
    );
    expect(deps.auditEntries[0]?.action).toBe('moderation.action.purge');
    expect(deps.auditEntries[0]?.targetId).toBeUndefined();
  });

  it('lists recent actions through the repo', async () => {
    const deps = makeDeps();
    const service = createModerationActionService(deps);

    await expect(service.listRecent(25)).resolves.toEqual([actionRow]);
    expect(deps.moderation.listActions).toHaveBeenCalledWith(25);
  });
});
