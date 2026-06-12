import type { AuditLogPort } from '@botplatform/core';
import type { GuildsRepo, ModerationRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { PermissionsRepo } from './permissions-repo.js';

/**
 * Narrow, repo-shaped ports so unit tests can inject plain fake objects
 * instead of a real Db. The real repos from @botplatform/database satisfy
 * these structurally.
 */
export type ModerationRepoPort = Pick<
  ModerationRepo,
  | 'upsertPlatformUser'
  | 'addWarning'
  | 'revokeWarning'
  | 'listWarnings'
  | 'addAction'
  | 'listActions'
  | 'listRules'
  | 'upsertRule'
  | 'setRuleEnabled'
>;

export type GuildsRepoPort = Pick<GuildsRepo, 'upsertByExternalId'>;

export type PermissionsRepoPort = Pick<
  PermissionsRepo,
  'hasAny' | 'grant' | 'revoke' | 'listForGuild'
>;

export interface ModerationServiceDeps {
  moderation: ModerationRepoPort;
  guilds: GuildsRepoPort;
  permissions: PermissionsRepoPort;
  logger: Logger;
  audit: AuditLogPort;
}
