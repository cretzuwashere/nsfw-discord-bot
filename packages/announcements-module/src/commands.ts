import type { CommandDefinition } from '@botplatform/core';
import { truncate, UserFacingError } from '@botplatform/shared';
import type { GuildsRepo } from '@botplatform/database';
import type { AnnouncementRepo } from './repo.js';
import type { AnnouncementService } from './service.js';

export interface AnnouncementCommandDeps {
  announcements: AnnouncementRepo;
  guilds: GuildsRepo;
  service: AnnouncementService;
  adapterKey: string;
}

/** `/announcement preview|send|list|cancel` — the admin panel is the primary UI. */
export function buildAnnouncementCommands(deps: AnnouncementCommandDeps): CommandDefinition[] {
  const { announcements, guilds, service, adapterKey } = deps;

  async function resolveGuildId(externalId: string): Promise<string> {
    const guild = await guilds.upsertByExternalId({ adapterKey, externalId });
    return guild.id;
  }

  const command: CommandDefinition = {
    name: 'announcement',
    description: 'Manage server announcements',
    guildOnly: true,
    subcommands: [
      {
        name: 'list',
        description: 'List recent announcements',
        async execute(ctx) {
          const guildId = await resolveGuildId(ctx.guildId!);
          const rows = await announcements.listByGuild(guildId, { limit: 10 });
          if (rows.length === 0) {
            await ctx.reply({ content: 'No announcements yet. Create one in the admin panel.', ephemeral: true });
            return;
          }
          const lines = rows.map(
            (row) => `• \`${row.id.slice(0, 8)}\` [${row.status}] ${truncate(row.title || row.body || '(empty)', 60)}`
          );
          await ctx.reply({ content: lines.join('\n'), ephemeral: true });
        },
      },
      {
        name: 'preview',
        description: 'Preview an announcement by id',
        options: [{ name: 'id', description: 'Announcement id (first 8 chars ok)', type: 'string', required: true }],
        async execute(ctx) {
          const announcement = await findByShortId(ctx.options['id'], ctx.guildId!);
          await ctx.reply({
            content: `**Preview** [${announcement.status}]\n${truncate(announcement.title, 100)}\n${truncate(
              announcement.body,
              500
            )}`,
            ephemeral: true,
          });
        },
      },
      {
        name: 'send',
        description: 'Send an announcement now',
        options: [{ name: 'id', description: 'Announcement id (first 8 chars ok)', type: 'string', required: true }],
        async execute(ctx) {
          await ctx.defer();
          const announcement = await findByShortId(ctx.options['id'], ctx.guildId!);
          const result = await service.deliverById(announcement.id);
          await ctx.reply({ content: result.message, ephemeral: true });
        },
      },
      {
        name: 'cancel',
        description: 'Cancel a scheduled or draft announcement',
        options: [{ name: 'id', description: 'Announcement id (first 8 chars ok)', type: 'string', required: true }],
        async execute(ctx) {
          const announcement = await findByShortId(ctx.options['id'], ctx.guildId!);
          if (announcement.status === 'sent') {
            await ctx.reply({ content: 'That announcement was already sent.', ephemeral: true });
            return;
          }
          await announcements.setStatus(announcement.id, 'canceled');
          await ctx.reply({ content: 'Announcement canceled.', ephemeral: true });
        },
      },
    ],
  };

  async function findByShortId(rawId: string | number | boolean | undefined, guildExternalId: string) {
    const id = String(rawId ?? '').trim();
    const guildId = await resolveGuildId(guildExternalId);
    const rows = await announcements.listByGuild(guildId, { includeTemplates: true, limit: 200 });
    const match = rows.find((row) => row.id === id || row.id.startsWith(id));
    if (!match || id.length < 4) {
      throw new UserFacingError('NOT_FOUND', 'No announcement matches that id.');
    }
    return match;
  }

  return [command];
}
