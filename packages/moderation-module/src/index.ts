import type { AppConfig } from '@botplatform/config';
import type { AuditLogPort, BotModule, CommandDefinition, GuildServiceProvider } from '@botplatform/core';
import type { Db } from '@botplatform/database';
import { createGuildsRepo, createModerationRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { createModerationCasesRepo, type ModerationCasesRepo } from './cases-repo.js';
import { buildModerationCommands } from './commands.js';
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
  /** Required to expose moderation slash commands (kick/ban/timeout/…). */
  guildServiceProvider?: GuildServiceProvider;
}

export interface ModerationModuleHandle {
  module: BotModule;
  services: ModerationServices | null;
  cases: ModerationCasesRepo | null;
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

  const cases = options.db ? createModerationCasesRepo(options.db) : null;

  let commands: CommandDefinition[] = [];
  if (options.db && options.guildServiceProvider && services && cases) {
    commands = buildModerationCommands({
      cases,
      guilds: createGuildsRepo(options.db),
      warnings: services.warnings,
      guildServiceProvider: options.guildServiceProvider,
      audit,
    });
  }

  const module: BotModule = {
    key: MODULE_KEYS.moderation,
    name: 'Moderation',
    description:
      'Moderation commands (warn, timeout, kick, ban, purge, slowmode, lock) with case logging.',
    metadata: {
      requiredPermissions: ['ModerateMembers', 'KickMembers', 'BanMembers', 'ManageMessages', 'ManageChannels'],
      requiredIntents: ['Guilds', 'GuildModeration'],
      auditEvents: ['moderation.warn', 'moderation.mute', 'moderation.kick', 'moderation.ban', 'moderation.purge'],
    },
    commands,
    onLoad(ctx) {
      ctx.logger.info(
        { persistence: services ? 'database' : 'unavailable', commands: commands.length },
        'moderation module ready'
      );
    },
  };

  return { module, services, cases };
}

export { createModerationCasesRepo } from './cases-repo.js';
export type { ModerationCasesRepo, ModerationCaseRow, ModerationSettingsRow } from './cases-repo.js';
export { buildModerationCommands } from './commands.js';

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
