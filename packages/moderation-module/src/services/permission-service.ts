import type { AuditLogPort } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import { ADAPTER_KEYS } from '@botplatform/shared';
import type { GuildsRepoPort, PermissionsRepoPort } from './deps.js';
import type { PermissionMappingRow } from './permissions-repo.js';

export interface PermissionCheckInput {
  guildExternalId: string;
  /** External role ids the member holds (e.g. Discord role snowflakes). */
  roleExternalIds: string[];
  /** Platform permission key, e.g. 'moderation.warn'. */
  permission: string;
  /** Defaults to the Discord adapter. */
  adapterKey?: string;
}

export interface PermissionMappingInput {
  guildExternalId: string;
  adapterKey: string;
  externalRoleId: string;
  permission: string;
}

/**
 * Foundation for role-based command permissions: maps adapter roles to
 * platform permission keys via the permission_mappings table.
 */
export interface PermissionService {
  hasPermission(input: PermissionCheckInput): Promise<boolean>;
  grant(input: PermissionMappingInput): Promise<PermissionMappingRow>;
  revoke(input: PermissionMappingInput): Promise<void>;
  listForGuild(guildId: string): Promise<PermissionMappingRow[]>;
}

export interface PermissionServiceDeps {
  permissions: PermissionsRepoPort;
  guilds: GuildsRepoPort;
  logger: Logger;
  audit: AuditLogPort;
}

export function createPermissionService(deps: PermissionServiceDeps): PermissionService {
  return {
    async hasPermission(input) {
      // No roles can never grant anything; also keeps inArray() non-empty downstream.
      if (input.roleExternalIds.length === 0) return false;
      return deps.permissions.hasAny({
        adapterKey: input.adapterKey ?? ADAPTER_KEYS.discord,
        guildExternalId: input.guildExternalId,
        roleExternalIds: input.roleExternalIds,
        permission: input.permission,
      });
    },

    async grant(input) {
      const guild = await deps.guilds.upsertByExternalId({
        adapterKey: input.adapterKey,
        externalId: input.guildExternalId,
      });
      const mapping = await deps.permissions.grant({
        guildId: guild.id,
        externalRoleId: input.externalRoleId,
        permission: input.permission,
      });
      deps.logger.debug({ mappingId: mapping.id, permission: input.permission }, 'permission granted');
      await deps.audit.record({
        actorType: 'system',
        action: 'moderation.permission.granted',
        guildId: input.guildExternalId,
        targetType: 'role',
        targetId: input.externalRoleId,
        metadata: { permission: input.permission },
      });
      return mapping;
    },

    async revoke(input) {
      const guild = await deps.guilds.upsertByExternalId({
        adapterKey: input.adapterKey,
        externalId: input.guildExternalId,
      });
      await deps.permissions.revoke({
        guildId: guild.id,
        externalRoleId: input.externalRoleId,
        permission: input.permission,
      });
      await deps.audit.record({
        actorType: 'system',
        action: 'moderation.permission.revoked',
        guildId: input.guildExternalId,
        targetType: 'role',
        targetId: input.externalRoleId,
        metadata: { permission: input.permission },
      });
    },

    listForGuild(guildId) {
      return deps.permissions.listForGuild(guildId);
    },
  };
}
