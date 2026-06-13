import type { AppConfig } from '@botplatform/config';
import type {
  AuditLogPort,
  BotModule,
  CommandDefinition,
  GuildServiceProvider,
  ScheduledJob,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS, truncate } from '@botplatform/shared';
import { parseDuration } from './duration.js';
import { createReminderRepo, type ReminderRepo, type ReminderRow } from './repo.js';

export interface RemindersModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface RemindersModuleHandle {
  module: BotModule;
  repo: ReminderRepo;
  schedulerJob: ScheduledJob;
}

const TICK_MS = 30_000;
const MAX_PER_USER = 25;

export function createRemindersModule(options: RemindersModuleOptions): RemindersModuleHandle {
  const repo = createReminderRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const adapterKey = options.adapterKey ?? 'discord';

  async function deliver(reminder: ReminderRow): Promise<void> {
    const guildExternalId = await guildExternal(reminder.guildId);
    const service = guildExternalId ? options.guildServiceProvider.forGuild(guildExternalId) : null;

    const text = `⏰ Reminder: ${reminder.message}`;
    const mentionPrefix =
      reminder.mentionRoleIds.length > 0 ? `${reminder.mentionRoleIds.map((r) => `<@&${r}>`).join(' ')} ` : '';

    let delivered = false;
    if (reminder.deliveryType === 'channel' && reminder.channelId && service) {
      delivered = await service
        .sendMessage(reminder.channelId, {
          content: `${mentionPrefix}<@${reminder.userExternalId}> ${text}`,
          allowMentions: { everyone: false, roles: reminder.mentionRoleIds, users: [reminder.userExternalId] },
        })
        .then(() => true)
        .catch(() => false);
    } else if (service) {
      delivered = await service
        .sendDirectMessage(reminder.userExternalId, {
          content: text,
          allowMentions: { everyone: false, roles: [], users: [] },
        })
        .then(() => true)
        .catch(() => false);
    }
    if (!service) return; // bot offline — retry next tick

    if (reminder.recurrenceSeconds && reminder.recurrenceSeconds > 0) {
      await repo.reschedule(reminder.id, new Date(Date.now() + reminder.recurrenceSeconds * 1000));
    } else {
      await repo.deactivate(reminder.id);
    }
    if (delivered) {
      await options.audit.record({
        actorType: 'system',
        action: 'reminder.delivered',
        moduleKey: 'reminders',
        guildId: guildExternalId ?? undefined,
        targetType: 'user',
        targetId: reminder.userExternalId,
      });
    }
  }

  async function guildExternal(guildId: string | null): Promise<string | undefined> {
    if (!guildId) return undefined;
    const guild = await guilds.getById(guildId).catch(() => undefined);
    return guild?.externalId;
  }

  const command: CommandDefinition = {
    name: 'reminder',
    description: 'Personal reminders',
    guildOnly: true,
    subcommands: [
      {
        name: 'create',
        description: 'Create a reminder',
        options: [
          { name: 'message', description: 'What to remind you about', type: 'string', required: true },
          { name: 'when', description: 'Delay, e.g. 30m, 2h, 1d 6h', type: 'string', required: true },
          { name: 'here', description: 'Send in this channel instead of DM', type: 'boolean' },
          { name: 'repeat', description: 'Repeat every (e.g. 1d) — optional', type: 'string' },
        ],
        async execute(ctx) {
          const seconds = parseDuration(String(ctx.options['when'] ?? ''));
          if (!seconds) {
            await ctx.reply({ content: 'I could not understand that delay. Try `30m`, `2h` or `1d 6h`.', ephemeral: true });
            return;
          }
          if ((await repo.countActiveForUser(ctx.user.id)) >= MAX_PER_USER) {
            await ctx.reply({ content: `You already have the maximum of ${MAX_PER_USER} active reminders.`, ephemeral: true });
            return;
          }
          const guild = await guilds.upsertByExternalId({ adapterKey, externalId: ctx.guildId! });
          const repeat = ctx.options['repeat'] ? parseDuration(String(ctx.options['repeat'])) : null;
          const inChannel = ctx.options['here'] === true;
          await repo.create({
            guildId: guild.id,
            userExternalId: ctx.user.id,
            deliveryType: inChannel ? 'channel' : 'dm',
            channelId: inChannel ? ctx.channelId : null,
            message: truncate(String(ctx.options['message'] ?? ''), 1000),
            dueAt: new Date(Date.now() + seconds * 1000),
            recurrenceSeconds: repeat,
          });
          await ctx.reply({ content: `Reminder set${inChannel ? ' (here)' : ' (DM)'}${repeat ? ', repeating' : ''}.`, ephemeral: true });
        },
      },
      {
        name: 'list',
        description: 'List your active reminders',
        async execute(ctx) {
          const rows = await repo.listForUser(ctx.user.id);
          if (rows.length === 0) {
            await ctx.reply({ content: 'You have no active reminders.', ephemeral: true });
            return;
          }
          const lines = rows.map(
            (r) => `\`${r.id.slice(0, 8)}\` ${r.dueAt.toISOString().slice(0, 16).replace('T', ' ')} — ${truncate(r.message, 60)}`
          );
          await ctx.reply({ content: lines.join('\n'), ephemeral: true });
        },
      },
      {
        name: 'remove',
        description: 'Remove a reminder',
        options: [{ name: 'id', description: 'Reminder id (first 8 chars)', type: 'string', required: true }],
        async execute(ctx) {
          const rows = await repo.listForUser(ctx.user.id);
          const match = rows.find((r) => r.id.startsWith(String(ctx.options['id'] ?? '')));
          if (!match) {
            await ctx.reply({ content: 'No matching reminder.', ephemeral: true });
            return;
          }
          await repo.remove(match.id, ctx.user.id);
          await ctx.reply({ content: 'Reminder removed.', ephemeral: true });
        },
      },
    ],
  };

  const schedulerJob: ScheduledJob = {
    name: 'reminders.deliver-due',
    intervalMs: TICK_MS,
    run: async () => {
      const due = await repo.listDue(new Date());
      for (const reminder of due) await deliver(reminder);
    },
  };

  const module: BotModule = {
    key: MODULE_KEYS.reminders,
    name: 'Reminders',
    description: 'Personal and recurring reminders, delivered by DM or in a channel.',
    metadata: {
      requiredPermissions: ['SendMessages'],
      requiredIntents: ['Guilds'],
      auditEvents: ['reminder.delivered'],
    },
    commands: [command],
    onLoad(ctx) {
      ctx.logger.info('reminders module ready');
    },
  };

  return { module, repo, schedulerJob };
}

export { createReminderRepo } from './repo.js';
export type { ReminderRepo, ReminderRow } from './repo.js';
export { parseDuration } from './duration.js';
