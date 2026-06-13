import type { AppConfig } from '@botplatform/config';
import type {
  AuditLogPort,
  BotModule,
  GuildServiceProvider,
  MemberJoinEvent,
  MemberLeaveEvent,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { createWelcomeRepo } from './repo.js';
import { createWelcomeService, type CardRenderer } from './service.js';

export interface WelcomeModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
  /** Optional welcome-card renderer (from the cards module). */
  renderCard?: CardRenderer;
}

export interface WelcomeModuleHandle {
  module: BotModule;
}

export function createWelcomeModule(options: WelcomeModuleOptions): WelcomeModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.welcome });
  const welcome = createWelcomeRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createWelcomeService({
    welcome,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    audit: options.audit,
    logger,
    renderCard: options.renderCard,
  });

  const module: BotModule = {
    key: MODULE_KEYS.welcome,
    name: 'Welcome / Leave',
    description: 'Welcome and leave messages, cards, auto-roles and DMs.',
    metadata: {
      requiredPermissions: ['SendMessages', 'ManageRoles', 'AttachFiles'],
      requiredIntents: ['GuildMembers'],
      auditEvents: ['welcome.sent', 'welcome.leave'],
    },
    commands: [],
    events: [
      { type: 'member.join', handle: (event) => service.handleJoin(event as MemberJoinEvent) },
      { type: 'member.leave', handle: (event) => service.handleLeave(event as MemberLeaveEvent) },
    ],
    onLoad(ctx) {
      ctx.logger.info('welcome/leave module ready');
    },
  };

  return { module };
}

export { createWelcomeRepo } from './repo.js';
export type { WelcomeRepo, WelcomeSettingsRow } from './repo.js';
export { createWelcomeService } from './service.js';
export type { WelcomeService, CardRenderer } from './service.js';
