import type { CommandDefinition } from '@botplatform/core';
import { truncate } from '@botplatform/shared';
import type { GuildsRepo } from '@botplatform/database';
import type { RoleMenuRepo } from './repo.js';
import type { RoleMenuService } from './service.js';

export interface RoleMenuCommandDeps {
  menus: RoleMenuRepo;
  guilds: GuildsRepo;
  service: RoleMenuService;
  adapterKey?: string;
}

/** `/roles menu|list|refresh|remove` — admin panel is the primary editor. */
export function buildRoleMenuCommands(deps: RoleMenuCommandDeps): CommandDefinition[] {
  const { menus, guilds, service } = deps;
  const adapterKey = deps.adapterKey ?? 'discord';

  async function guildId(externalId: string): Promise<string> {
    const guild = await guilds.upsertByExternalId({ adapterKey, externalId });
    return guild.id;
  }

  async function findMenu(idPrefix: string, externalId: string) {
    const rows = await menus.listByGuild(await guildId(externalId));
    return rows.find((m) => m.id === idPrefix || m.id.startsWith(idPrefix));
  }

  const command: CommandDefinition = {
    name: 'roles',
    description: 'Manage self-assignable role menus',
    guildOnly: true,
    subcommands: [
      {
        name: 'list',
        description: 'List role menus',
        async execute(ctx) {
          const rows = await menus.listByGuild(await guildId(ctx.guildId!));
          if (rows.length === 0) {
            await ctx.reply({ content: 'No role menus yet — create one in the admin panel.', ephemeral: true });
            return;
          }
          const lines = rows.map(
            (m) => `• \`${m.id.slice(0, 8)}\` ${truncate(m.name, 40)} [${m.type}/${m.mode}]${m.enabled ? '' : ' (disabled)'}`
          );
          await ctx.reply({ content: lines.join('\n'), ephemeral: true });
        },
      },
      {
        name: 'menu',
        description: 'Publish a role menu to this channel',
        options: [{ name: 'id', description: 'Role menu id (first 8 chars ok)', type: 'string', required: true }],
        async execute(ctx) {
          await ctx.defer();
          const menu = await findMenu(String(ctx.options['id'] ?? ''), ctx.guildId!);
          if (!menu) {
            await ctx.reply({ content: 'No role menu matches that id.', ephemeral: true });
            return;
          }
          const result = await service.publishMenu(ctx.guildId!, menu.id, ctx.channelId!);
          await ctx.reply({ content: result.message, ephemeral: true });
        },
      },
      {
        name: 'refresh',
        description: 'Re-publish a role menu (updates the existing message)',
        options: [{ name: 'id', description: 'Role menu id', type: 'string', required: true }],
        async execute(ctx) {
          await ctx.defer();
          const menu = await findMenu(String(ctx.options['id'] ?? ''), ctx.guildId!);
          if (!menu) {
            await ctx.reply({ content: 'No role menu matches that id.', ephemeral: true });
            return;
          }
          const channelId = menu.channelId ?? ctx.channelId!;
          const result = await service.publishMenu(ctx.guildId!, menu.id, channelId);
          await ctx.reply({ content: result.message, ephemeral: true });
        },
      },
      {
        name: 'remove',
        description: 'Disable a role menu',
        options: [{ name: 'id', description: 'Role menu id', type: 'string', required: true }],
        async execute(ctx) {
          const menu = await findMenu(String(ctx.options['id'] ?? ''), ctx.guildId!);
          if (!menu) {
            await ctx.reply({ content: 'No role menu matches that id.', ephemeral: true });
            return;
          }
          await menus.update(menu.id, { enabled: false });
          await ctx.reply({ content: 'Role menu disabled.', ephemeral: true });
        },
      },
    ],
  };

  return [command];
}
