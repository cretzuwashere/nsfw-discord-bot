import type { AppConfig } from '@botplatform/config';
import type {
  AuditLogPort,
  BotModule,
  GuildServiceProvider,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildAnnouncementCommands } from './commands.js';
import { createAnnouncementRepo } from './repo.js';
import { createAnnouncementService, type AnnouncementService } from './service.js';

export interface AnnouncementsModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface AnnouncementsModuleHandle {
  module: BotModule;
  service: AnnouncementService;
  /** Scheduler job the bot app registers (delivers due scheduled announcements). */
  schedulerJob: ScheduledJob;
}

const DELIVERY_TICK_MS = 30_000;

export function createAnnouncementsModule(
  options: AnnouncementsModuleOptions
): AnnouncementsModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.announcements });
  const adapterKey = options.adapterKey ?? 'discord';
  const announcements = createAnnouncementRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createAnnouncementService({
    announcements,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    audit: options.audit,
    logger,
  });

  const module: BotModule = {
    key: MODULE_KEYS.announcements,
    name: 'Announcements',
    description: 'Create, schedule and send server announcements from the admin panel.',
    metadata: {
      requiredPermissions: ['SendMessages', 'EmbedLinks'],
      requiredIntents: ['Guilds'],
      auditEvents: ['announcement.sent', 'announcement.failed', 'announcement.created'],
      configSchema: [
        { key: 'defaultChannelId', label: 'Default channel', type: 'channel' },
      ],
    },
    commands: buildAnnouncementCommands({ announcements, guilds, service, adapterKey }),
    onLoad(ctx) {
      ctx.logger.info('announcements module ready');
    },
  };

  const schedulerJob: ScheduledJob = {
    name: 'announcements.deliver-due',
    intervalMs: DELIVERY_TICK_MS,
    run: async () => {
      const delivered = await service.deliverDue(new Date());
      if (delivered > 0) logger.info({ delivered }, 'delivered scheduled announcements');
    },
  };

  return { module, service, schedulerJob };
}

export { createAnnouncementRepo } from './repo.js';
export type { AnnouncementRepo, AnnouncementRow } from './repo.js';
export { createAnnouncementService, buildOutgoing } from './service.js';
export type { AnnouncementService } from './service.js';
export { validateAnnouncement, hexColorToInt } from './validation.js';
export type { AnnouncementInput, AnnouncementValidation, MentionMode } from './validation.js';
