import type { AppConfig } from '@botplatform/config';
import type { AuditLogPort, BotModule } from '@botplatform/core';
import type { Db } from '@botplatform/database';
import { createGuildsRepo, createModerationRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import type { ModerationServices } from './services/index.js';
import { createModerationServices } from './services/index.js';
import { createPermissionsRepo } from './services/permissions-repo.js';

export interface ModerationModuleOptions {
  config: AppConfig;
  logger: Logger;
  /** Null = run without persistence (services unavailable) — test convenience. */
  db: Db | null;
  /**
   * Audit sink for moderation events. Defaults to a no-op port so the module
   * can be constructed in isolation; the bot app should pass the database
   * audit log (createDbAuditLog from @botplatform/database) in production.
   */
  audit?: AuditLogPort;
}

export interface ModerationModuleHandle {
  module: BotModule;
  services: ModerationServices | null;
}

const NOOP_AUDIT: AuditLogPort = {
  record: async () => {},
};

export function createModerationModule(options: ModerationModuleOptions): ModerationModuleHandle {
  const audit = options.audit ?? NOOP_AUDIT;
  const services = options.db
    ? createModerationServices({
        moderation: createModerationRepo(options.db),
        guilds: createGuildsRepo(options.db),
        permissions: createPermissionsRepo(options.db),
        logger: options.logger.child({ module: MODULE_KEYS.moderation }),
        audit,
      })
    : null;

  const module: BotModule = {
    key: MODULE_KEYS.moderation,
    name: 'Moderation Foundation',
    description:
      'Foundation for moderation: warnings, action records, rules and role permission mappings. ' +
      'Slash commands arrive in later phases — see docs/MODERATION_ROADMAP.md.',
    commands: [],
    onLoad(ctx) {
      ctx.logger.info(
        { persistence: services ? 'database' : 'unavailable', commands: 0 },
        'moderation foundation ready'
      );
    },
  };

  return { module, services };
}

export type { ModerationServiceDeps, ModerationRepoPort, GuildsRepoPort, PermissionsRepoPort } from './services/deps.js';
export { createModerationServices } from './services/index.js';
export type { ModerationServices } from './services/index.js';
export { createWarningService } from './services/warning-service.js';
export type { WarningService, WarningServiceDeps, WarnUserInput } from './services/warning-service.js';
export { createModerationActionService } from './services/action-service.js';
export type {
  ModerationActionService,
  ModerationActionServiceDeps,
  RecordActionInput,
} from './services/action-service.js';
export { createRuleService } from './services/rule-service.js';
export type { RuleService, RuleServiceDeps, UpsertRuleInput } from './services/rule-service.js';
export { createPermissionService } from './services/permission-service.js';
export type {
  PermissionService,
  PermissionServiceDeps,
  PermissionCheckInput,
  PermissionMappingInput,
} from './services/permission-service.js';
export { createPermissionsRepo } from './services/permissions-repo.js';
export type { PermissionsRepo, PermissionMappingRow } from './services/permissions-repo.js';
