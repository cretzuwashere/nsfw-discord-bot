import type { AuditEntry } from '@botplatform/core';
import type { GuildRow } from '@botplatform/database';
import { createSilentLogger } from '@botplatform/logger';
import { describe, expect, it, vi } from 'vitest';
import { createPermissionService } from './permission-service.js';
import type { PermissionMappingRow } from './permissions-repo.js';

const now = new Date();

const guildRow: GuildRow = {
  id: 'guild-uuid',
  adapterKey: 'discord',
  externalId: 'guild-ext-1',
  name: '',
  createdAt: now,
  updatedAt: now,
};

const mappingRow: PermissionMappingRow = {
  id: 'mapping-uuid',
  guildId: 'guild-uuid',
  externalRoleId: 'role-ext-1',
  permission: 'moderation.warn',
  createdAt: now,
};

function makeDeps(found = true) {
  const auditEntries: AuditEntry[] = [];
  return {
    permissions: {
      hasAny: vi.fn(async () => found),
      grant: vi.fn(async () => mappingRow),
      revoke: vi.fn(async () => {}),
      listForGuild: vi.fn(async () => [mappingRow]),
    },
    guilds: { upsertByExternalId: vi.fn(async () => guildRow) },
    logger: createSilentLogger(),
    audit: {
      record: vi.fn(async (entry: AuditEntry) => {
        auditEntries.push(entry);
      }),
    },
    auditEntries,
  };
}

describe('PermissionService', () => {
  it('returns true when a role mapping grants the permission (default adapter)', async () => {
    const deps = makeDeps(true);
    const service = createPermissionService(deps);

    const allowed = await service.hasPermission({
      guildExternalId: 'guild-ext-1',
      roleExternalIds: ['role-ext-1', 'role-ext-2'],
      permission: 'moderation.warn',
    });

    expect(allowed).toBe(true);
    expect(deps.permissions.hasAny).toHaveBeenCalledWith({
      adapterKey: 'discord',
      guildExternalId: 'guild-ext-1',
      roleExternalIds: ['role-ext-1', 'role-ext-2'],
      permission: 'moderation.warn',
    });
  });

  it('returns false when no mapping matches', async () => {
    const deps = makeDeps(false);
    const service = createPermissionService(deps);

    const allowed = await service.hasPermission({
      guildExternalId: 'guild-ext-1',
      roleExternalIds: ['role-ext-9'],
      permission: 'moderation.ban',
    });

    expect(allowed).toBe(false);
  });

  it('returns false for an empty role list without querying', async () => {
    const deps = makeDeps(true);
    const service = createPermissionService(deps);

    const allowed = await service.hasPermission({
      guildExternalId: 'guild-ext-1',
      roleExternalIds: [],
      permission: 'moderation.warn',
    });

    expect(allowed).toBe(false);
    expect(deps.permissions.hasAny).not.toHaveBeenCalled();
  });

  it('grants a mapping against the internal guild id and audits', async () => {
    const deps = makeDeps();
    const service = createPermissionService(deps);

    const mapping = await service.grant({
      guildExternalId: 'guild-ext-1',
      adapterKey: 'discord',
      externalRoleId: 'role-ext-1',
      permission: 'moderation.warn',
    });

    expect(mapping).toBe(mappingRow);
    expect(deps.guilds.upsertByExternalId).toHaveBeenCalledWith({
      adapterKey: 'discord',
      externalId: 'guild-ext-1',
    });
    expect(deps.permissions.grant).toHaveBeenCalledWith({
      guildId: 'guild-uuid',
      externalRoleId: 'role-ext-1',
      permission: 'moderation.warn',
    });
    expect(deps.auditEntries[0]?.action).toBe('moderation.permission.granted');
    expect(deps.auditEntries[0]?.metadata).toEqual({ permission: 'moderation.warn' });
  });

  it('revokes a mapping and audits', async () => {
    const deps = makeDeps();
    const service = createPermissionService(deps);

    await service.revoke({
      guildExternalId: 'guild-ext-1',
      adapterKey: 'discord',
      externalRoleId: 'role-ext-1',
      permission: 'moderation.warn',
    });

    expect(deps.permissions.revoke).toHaveBeenCalledWith({
      guildId: 'guild-uuid',
      externalRoleId: 'role-ext-1',
      permission: 'moderation.warn',
    });
    expect(deps.auditEntries[0]?.action).toBe('moderation.permission.revoked');
  });
});
