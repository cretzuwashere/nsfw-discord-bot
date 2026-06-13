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
import { applyPlaceholders, buildPlaceholderData, MODULE_KEYS } from '@botplatform/shared';
import { DateTime } from 'luxon';
import { announcementDateKey, computeAge, isValidMonthDay, localMonthDay } from './date-logic.js';
import { createBirthdayRepo, type BirthdayRepo } from './repo.js';

export interface BirthdaysModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface BirthdaysModuleHandle {
  module: BotModule;
  repo: BirthdayRepo;
  schedulerJob: ScheduledJob;
}

const TICK_MS = 5 * 60_000; // every 5 minutes; the per-hour gate dedups

export function createBirthdaysModule(options: BirthdaysModuleOptions): BirthdaysModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.birthdays });
  const repo = createBirthdayRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const adapterKey = options.adapterKey ?? 'discord';

  async function guildId(externalId: string): Promise<string> {
    const guild = await guilds.upsertByExternalId({ adapterKey, externalId });
    return guild.id;
  }

  const command: CommandDefinition = {
    name: 'birthday',
    description: 'Birthdays (opt-in)',
    guildOnly: true,
    subcommands: [
      {
        name: 'set',
        description: 'Set your birthday (opt-in; you can remove it any time)',
        options: [
          { name: 'month', description: 'Month (1-12)', type: 'integer', required: true },
          { name: 'day', description: 'Day (1-31)', type: 'integer', required: true },
          { name: 'year', description: 'Year (optional — only used for age)', type: 'integer' },
          { name: 'timezone', description: 'IANA timezone, e.g. Europe/Bucharest', type: 'string' },
        ],
        async execute(ctx) {
          const month = Number(ctx.options['month'] ?? 0);
          const day = Number(ctx.options['day'] ?? 0);
          if (!isValidMonthDay(month, day)) {
            await ctx.reply({ content: 'That is not a valid date.', ephemeral: true });
            return;
          }
          const year = ctx.options['year'] ? Number(ctx.options['year']) : null;
          const timezone = ctx.options['timezone'] ? String(ctx.options['timezone']) : 'UTC';
          await repo.set({
            guildId: await guildId(ctx.guildId!),
            userExternalId: ctx.user.id,
            month,
            day,
            year,
            timezone: DateTime.local().setZone(timezone).isValid ? timezone : 'UTC',
          });
          await ctx.reply({ content: 'Your birthday is saved. Use `/birthday remove` to delete it any time.', ephemeral: true });
        },
      },
      {
        name: 'view',
        description: 'View your saved birthday',
        async execute(ctx) {
          const row = await repo.get(await guildId(ctx.guildId!), ctx.user.id);
          if (!row) {
            await ctx.reply({ content: 'You have not set a birthday.', ephemeral: true });
            return;
          }
          const yearPart = row.year ? ` ${row.year}` : '';
          await ctx.reply({ content: `Your birthday: ${row.month}/${row.day}${yearPart} (${row.timezone})`, ephemeral: true });
        },
      },
      {
        name: 'remove',
        description: 'Delete your saved birthday',
        async execute(ctx) {
          await repo.remove(await guildId(ctx.guildId!), ctx.user.id);
          await ctx.reply({ content: 'Your birthday has been deleted.', ephemeral: true });
        },
      },
      {
        name: 'upcoming',
        description: 'Show upcoming birthdays',
        async execute(ctx) {
          const rows = (await repo.forGuild(await guildId(ctx.guildId!))).filter((r) => r.visibility !== 'private');
          if (rows.length === 0) {
            await ctx.reply({ content: 'No birthdays to show.', ephemeral: true });
            return;
          }
          const lines = rows.slice(0, 15).map((r) => `• <@${r.userExternalId}> — ${r.month}/${r.day}`);
          await ctx.reply({ content: lines.join('\n'), ephemeral: true });
        },
      },
    ],
  };

  /** Daily/hourly job: announce birthdays at each guild's configured hour. */
  const schedulerJob: ScheduledJob = {
    name: 'birthdays.announce',
    intervalMs: TICK_MS,
    run: async () => {
      const now = new Date();
      const allSettings = await repo.allEnabledSettings();
      for (const settings of allSettings) {
        if (!settings.announcementChannelId) continue;
        const guild = await guilds.getById(settings.guildId).catch(() => undefined);
        if (!guild) continue;

        // Gate by the guild's announce hour (UTC — birthday_settings has no
        // timezone column); the per-birthday calendar match uses each user's
        // own timezone below.
        const gateKey = announcementDateKey('UTC', settings.announceHour, now);
        if (!gateKey) continue;

        const service = options.guildServiceProvider.forGuild(guild.externalId);
        if (!service) continue;

        const allBirthdays = await repo.forGuild(settings.guildId);
        for (const birthday of allBirthdays) {
          // Is it this birthday's month/day right now in ITS timezone?
          const local = localMonthDay(birthday.timezone, now);
          if (local.month !== birthday.month || local.day !== birthday.day) continue;

          // Dedup on the user's local date so it announces once per local day.
          const dateKey = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
          if (await repo.hasAnnounced(settings.guildId, birthday.userExternalId, dateKey)) continue;

          const age = birthday.year ? computeAge(birthday.year, birthday.month, birthday.day, DateTime.fromJSDate(now)) : null;
          const data = buildPlaceholderData({
            user: { id: birthday.userExternalId, username: '', displayName: '' },
            server: { name: guild.name },
            birthday: age !== null ? { age } : undefined,
          });

          // Send FIRST; only record the dedup row after a confirmed delivery,
          // so a transient failure retries on a later tick instead of being
          // silently dropped.
          const sent = await service
            .sendMessage(settings.announcementChannelId, {
              content: applyPlaceholders(settings.message, data),
              allowMentions: { everyone: false, roles: [], users: [birthday.userExternalId] },
            })
            .then(() => true)
            .catch((error) => {
              logger.warn({ err: error }, 'birthday announcement failed');
              return false;
            });
          if (!sent) continue;

          await repo.markAnnounced(settings.guildId, birthday.userExternalId, dateKey);
          if (settings.roleEnabled && settings.roleId) {
            await service.addRole(birthday.userExternalId, settings.roleId, 'birthday').catch(() => {});
          }
          await options.audit.record({
            actorType: 'system',
            action: 'birthday.announced',
            moduleKey: 'birthdays',
            guildId: guild.externalId,
            targetType: 'user',
            targetId: birthday.userExternalId,
          });
        }
      }
    },
  };

  const module: BotModule = {
    key: MODULE_KEYS.birthdays,
    name: 'Birthdays',
    description: 'Opt-in birthday announcements with optional role and card.',
    metadata: {
      requiredPermissions: ['SendMessages', 'ManageRoles'],
      requiredIntents: ['Guilds'],
      auditEvents: ['birthday.announced'],
    },
    commands: [command],
    onLoad(ctx) {
      ctx.logger.info('birthdays module ready (opt-in)');
    },
  };

  return { module, repo, schedulerJob };
}

export { createBirthdayRepo } from './repo.js';
export type { BirthdayRepo, BirthdayRow, BirthdaySettingsRow } from './repo.js';
export { isValidMonthDay, computeAge, announcementDateKey, localMonthDay } from './date-logic.js';
