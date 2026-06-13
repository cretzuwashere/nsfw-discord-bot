import type { AppConfig } from '@botplatform/config';
import type {
  AuditLogPort,
  BotModule,
  ComponentInteractionEvent,
  GuildServiceProvider,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildRoleMenuCommands } from './commands.js';
import { createRoleMenuRepo } from './repo.js';
import { createRoleMenuService, type RoleMenuService } from './service.js';

export interface RoleMenusModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
}

export interface RoleMenusModuleHandle {
  module: BotModule;
  service: RoleMenuService;
}

export function createRoleMenusModule(options: RoleMenusModuleOptions): RoleMenusModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.roleMenus });
  const menus = createRoleMenuRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createRoleMenuService({
    menus,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    audit: options.audit,
    logger,
  });

  const module: BotModule = {
    key: MODULE_KEYS.roleMenus,
    name: 'Reaction Roles',
    description: 'Self-assignable roles via buttons and select menus.',
    metadata: {
      requiredPermissions: ['ManageRoles', 'SendMessages'],
      requiredIntents: ['Guilds'],
      auditEvents: ['rolemenu.published'],
    },
    commands: buildRoleMenuCommands({ menus, guilds, service }),
    events: [
      {
        type: 'component.interaction',
        handle: (event) => service.handleInteraction(event as ComponentInteractionEvent),
      },
    ],
    onLoad(ctx) {
      ctx.logger.info('role menus module ready');
    },
  };

  return { module, service };
}

export { createRoleMenuRepo } from './repo.js';
export type { RoleMenuRepo, RoleMenuRow, RoleMenuWithOptions } from './repo.js';
export { createRoleMenuService } from './service.js';
export type { RoleMenuService } from './service.js';
export {
  computeRoleChanges,
  buildMenuMessage,
  parseCustomId,
  buttonCustomId,
  selectCustomId,
} from './logic.js';
export type { RoleMenuMode, MenuConstraints, RoleChanges } from './logic.js';
