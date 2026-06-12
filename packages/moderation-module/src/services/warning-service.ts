import type { AuditLogPort } from '@botplatform/core';
import type { WarningRow } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { truncate } from '@botplatform/shared';
import type { GuildsRepoPort, ModerationRepoPort } from './deps.js';

/** Audit metadata stays small and free of arbitrary user payloads. */
const AUDIT_REASON_MAX = 300;

export interface WarnUserInput {
  guildExternalId: string;
  adapterKey: string;
  user: { externalId: string; username?: string };
  /** External id of the moderator issuing the warning. */
  moderatorId: string;
  reason: string;
}

export interface WarningService {
  warnUser(input: WarnUserInput): Promise<WarningRow>;
  listRecent(limit?: number): Promise<WarningRow[]>;
  revoke(id: string): Promise<void>;
}

export interface WarningServiceDeps {
  moderation: Pick<
    ModerationRepoPort,
    'upsertPlatformUser' | 'addWarning' | 'revokeWarning' | 'listWarnings'
  >;
  guilds: GuildsRepoPort;
  logger: Logger;
  audit: AuditLogPort;
}

export function createWarningService(deps: WarningServiceDeps): WarningService {
  return {
    async warnUser(input) {
      const guild = await deps.guilds.upsertByExternalId({
        adapterKey: input.adapterKey,
        externalId: input.guildExternalId,
      });
      const user = await deps.moderation.upsertPlatformUser({
        adapterKey: input.adapterKey,
        externalId: input.user.externalId,
        ...(input.user.username !== undefined ? { username: input.user.username } : {}),
      });
      const warning = await deps.moderation.addWarning({
        guildId: guild.id,
        userId: user.id,
        moderatorId: input.moderatorId,
        reason: input.reason,
      });
      deps.logger.debug({ warningId: warning.id, guildId: guild.id }, 'warning recorded');
      await deps.audit.record({
        actorType: 'platform_user',
        actorId: input.moderatorId,
        action: 'moderation.warning.created',
        guildId: input.guildExternalId,
        targetType: 'platform_user',
        targetId: input.user.externalId,
        metadata: { warningId: warning.id, reason: truncate(input.reason, AUDIT_REASON_MAX) },
      });
      return warning;
    },

    listRecent(limit = 50) {
      return deps.moderation.listWarnings(limit);
    },

    async revoke(id) {
      await deps.moderation.revokeWarning(id);
      await deps.audit.record({
        actorType: 'system',
        action: 'moderation.warning.revoked',
        targetType: 'warning',
        targetId: id,
      });
    },
  };
}
