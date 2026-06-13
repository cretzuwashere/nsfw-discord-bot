import type { AppConfig } from '@botplatform/config';
import type {
  AuditLogPort,
  BotModule,
  GuildServiceProvider,
  OutgoingMessage,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { computeNextRun, type ScheduleConfig, type ScheduleType } from './next-run.js';
import { createScheduledMessageRepo, type ScheduledMessageRepo, type ScheduledMessageRow } from './repo.js';

export interface ScheduledMessagesModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface ScheduledMessagesModuleHandle {
  module: BotModule;
  repo: ScheduledMessageRepo;
  schedulerJob: ScheduledJob;
}

const TICK_MS = 30_000;
const RETRY_BACKOFF_MS = 5 * 60_000;

export function createScheduledMessagesModule(
  options: ScheduledMessagesModuleOptions
): ScheduledMessagesModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.scheduledMessages });
  const repo = createScheduledMessageRepo(options.db);
  const guilds = createGuildsRepo(options.db);

  async function deliver(row: ScheduledMessageRow): Promise<void> {
    const guild = await guilds.getById(row.guildId);
    if (!guild) return;
    const service = options.guildServiceProvider.forGuild(guild.externalId);
    if (!service) return; // bot offline; retry next tick (nextRunAt unchanged)

    const message: OutgoingMessage = {
      content: row.content || undefined,
      allowMentions: {
        everyone: row.mentionMode === 'everyone' || row.mentionMode === 'here',
        roles: row.mentionMode === 'roles' ? row.mentionRoleIds : [],
        users: [],
      },
    };
    if (row.mentionMode === 'roles' && row.mentionRoleIds.length > 0) {
      message.content = `${row.mentionRoleIds.map((id) => `<@&${id}>`).join(' ')} ${message.content ?? ''}`.trim();
    } else if (row.mentionMode === 'everyone') {
      message.content = `@everyone ${message.content ?? ''}`.trim();
    } else if (row.mentionMode === 'here') {
      message.content = `@here ${message.content ?? ''}`.trim();
    }

    let delivered = false;
    try {
      await service.sendMessage(row.channelId, message);
      await repo.recordRun(row.id, 'sent');
      await options.audit.record({
        actorType: 'system',
        action: 'scheduled-message.sent',
        moduleKey: 'scheduled-messages',
        guildId: guild.externalId,
        targetType: 'scheduled_message',
        targetId: row.id,
      });
      delivered = true;
    } catch (error) {
      logger.warn({ err: error, id: row.id }, 'scheduled message send failed');
      await repo.recordRun(row.id, 'failed', 'delivery error');
    }

    if (delivered) {
      // Advance to the next run, or stop one-offs.
      const next = computeNextRun(
        row.scheduleType as ScheduleType,
        (row.scheduleConfig ?? {}) as ScheduleConfig,
        row.timezone,
        new Date()
      );
      await repo.update(row.id, {
        lastRunAt: new Date(),
        nextRunAt: next,
        paused: next === null ? true : row.paused,
        lastFailureReason: null,
      });
    } else {
      // Delivery failed — DON'T drop a one-off or skip a recurrence. Retry
      // with a short backoff; the admin sees the failed runs and can pause.
      await repo.update(row.id, {
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + RETRY_BACKOFF_MS),
        lastFailureReason: 'Delivery failed; will retry.',
      });
    }
  }

  const schedulerJob: ScheduledJob = {
    name: 'scheduled-messages.deliver-due',
    intervalMs: TICK_MS,
    run: async () => {
      const due = await repo.listDue(new Date());
      for (const row of due) await deliver(row);
    },
  };

  const module: BotModule = {
    key: MODULE_KEYS.scheduledMessages,
    name: 'Scheduled Messages',
    description: 'Schedule one-off and recurring messages to channels.',
    metadata: {
      requiredPermissions: ['SendMessages'],
      requiredIntents: ['Guilds'],
      auditEvents: ['scheduled-message.sent'],
    },
    commands: [],
    onLoad(ctx) {
      ctx.logger.info('scheduled messages module ready');
    },
  };

  return { module, repo, schedulerJob };
}

export { createScheduledMessageRepo } from './repo.js';
export type { ScheduledMessageRepo, ScheduledMessageRow } from './repo.js';
export { computeNextRun, MIN_INTERVAL_SECONDS } from './next-run.js';
export type { ScheduleType, ScheduleConfig } from './next-run.js';
