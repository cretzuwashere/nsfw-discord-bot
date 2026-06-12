import type { AuditLogPort } from '@botplatform/core';
import type { ModerationActionRow, ModerationActionTypeValue } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { truncate } from '@botplatform/shared';
import type { GuildsRepoPort, ModerationRepoPort } from './deps.js';

const AUDIT_REASON_MAX = 300;

export interface RecordActionInput {
  guildExternalId: string;
  adapterKey: string;
  /** Omit for actions without a single target user (e.g. purge). */
  user?: { externalId: string; username?: string };
  moderatorId: string;
  actionType: ModerationActionTypeValue;
  reason?: string;
  metadata?: Record<string, unknown>;
  /** For temporary actions (mute/ban) — enforcement arrives with the job layer. */
  expiresAt?: Date;
}

export interface ModerationActionService {
  recordAction(input: RecordActionInput): Promise<ModerationActionRow>;
  listRecent(limit?: number): Promise<ModerationActionRow[]>;
}

export interface ModerationActionServiceDeps {
  moderation: Pick<ModerationRepoPort, 'upsertPlatformUser' | 'addAction' | 'listActions'>;
  guilds: GuildsRepoPort;
  logger: Logger;
  audit: AuditLogPort;
}

export function createModerationActionService(
  deps: ModerationActionServiceDeps
): ModerationActionService {
  return {
    async recordAction(input) {
      const guild = await deps.guilds.upsertByExternalId({
        adapterKey: input.adapterKey,
        externalId: input.guildExternalId,
      });
      let userId: string | undefined;
      if (input.user) {
        const user = await deps.moderation.upsertPlatformUser({
          adapterKey: input.adapterKey,
          externalId: input.user.externalId,
          ...(input.user.username !== undefined ? { username: input.user.username } : {}),
        });
        userId = user.id;
      }
      const action = await deps.moderation.addAction({
        guildId: guild.id,
        userId,
        moderatorId: input.moderatorId,
        actionType: input.actionType,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      });
      deps.logger.debug(
        { actionId: action.id, actionType: input.actionType, guildId: guild.id },
        'moderation action recorded'
      );
      // Caller-supplied `metadata` is intentionally NOT copied into the audit
      // entry — audit metadata must stay a small, known-safe summary.
      await deps.audit.record({
        actorType: 'platform_user',
        actorId: input.moderatorId,
        action: `moderation.action.${input.actionType}`,
        guildId: input.guildExternalId,
        ...(input.user
          ? { targetType: 'platform_user', targetId: input.user.externalId }
          : {}),
        metadata: {
          actionId: action.id,
          ...(input.reason ? { reason: truncate(input.reason, AUDIT_REASON_MAX) } : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
        },
      });
      return action;
    },

    listRecent(limit = 50) {
      return deps.moderation.listActions(limit);
    },
  };
}
