import type {
  AuditLogPort,
  ComponentInteractionEvent,
  GuildServiceProvider,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import {
  buildMenuMessage,
  computeRoleChanges,
  parseCustomId,
  type MenuConstraints,
} from './logic.js';
import type { RoleMenuRepo } from './repo.js';

export interface RoleMenuServiceDeps {
  menus: RoleMenuRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  audit: AuditLogPort;
  logger: Logger;
  adapterKey?: string;
}

export function createRoleMenuService(deps: RoleMenuServiceDeps) {
  const { menus, guilds, guildServiceProvider, audit, logger } = deps;
  const adapterKey = deps.adapterKey ?? 'discord';

  /** Handle a button click or select submission on a role menu. */
  async function handleInteraction(event: ComponentInteractionEvent): Promise<void> {
    const parsed = parseCustomId(event.customId);
    if (!parsed || !event.guild) return;

    const menu = await menus.getWithOptions(parsed.menuId);
    if (!menu || !menu.enabled) {
      await event.reply('This role menu is no longer active.');
      return;
    }

    const service = guildServiceProvider.forGuild(event.guild.externalId);
    if (!service) {
      await event.reply('The bot is not available right now — please try again shortly.');
      return;
    }

    const requested = parsed.roleId ? [parsed.roleId] : event.values;
    const menuRoleIds = menu.options.map((o) => o.roleId);
    const changes = computeRoleChanges({
      mode: menu.mode,
      menuRoleIds,
      held: new Set(event.userRoleIds),
      requested,
      constraints: (menu.constraints ?? {}) as MenuConstraints,
    });

    if (changes.rejected) {
      await event.reply(changes.rejected);
      return;
    }

    const guild = await guilds.upsertByExternalId({
      adapterKey,
      externalId: event.guild.externalId,
      name: event.guild.name,
    });

    let changed = 0;
    let skipped = 0;
    for (const roleId of changes.add) {
      try {
        await service.addRole(event.user.externalId, roleId, 'role menu');
        await menus.logAssignment({
          guildId: guild.id,
          menuId: menu.id,
          userExternalId: event.user.externalId,
          roleId,
          action: 'added',
        });
        changed++;
      } catch (error) {
        skipped++;
        logger.debug({ err: error, roleId }, 'role menu add failed');
      }
    }
    for (const roleId of changes.remove) {
      try {
        await service.removeRole(event.user.externalId, roleId, 'role menu');
        await menus.logAssignment({
          guildId: guild.id,
          menuId: menu.id,
          userExternalId: event.user.externalId,
          roleId,
          action: 'removed',
        });
        changed++;
      } catch (error) {
        skipped++;
        logger.debug({ err: error, roleId }, 'role menu remove failed');
      }
    }

    if (changed === 0 && skipped > 0) {
      await event.reply('I could not update those roles — I may lack permission or role hierarchy.');
    } else if (changed === 0) {
      await event.reply('No changes were made.');
    } else {
      await event.reply('Your roles have been updated.');
    }
  }

  /** Publish (or re-publish) a menu's message to a channel. */
  async function publishMenu(
    guildExternalId: string,
    menuId: string,
    channelId: string
  ): Promise<{ ok: boolean; message: string }> {
    const menu = await menus.getWithOptions(menuId);
    if (!menu) return { ok: false, message: 'Role menu not found.' };
    if (menu.options.length === 0) return { ok: false, message: 'Add at least one role option first.' };

    const service = guildServiceProvider.forGuild(guildExternalId);
    if (!service) return { ok: false, message: 'The bot is not connected right now.' };

    const payload = buildMenuMessage(menu);
    try {
      // Re-publish: delete the old message if present.
      if (menu.channelId && menu.messageId) {
        await service.deleteMessage(menu.channelId, menu.messageId).catch(() => {});
      }
      const sent = await service.sendMessage(channelId, payload);
      await menus.setPublished(menuId, channelId, sent.messageId);
      await audit.record({
        actorType: 'platform_user',
        action: 'rolemenu.published',
        moduleKey: 'role-menus',
        guildId: guildExternalId,
        targetType: 'role_menu',
        targetId: menuId,
      });
      return { ok: true, message: 'Role menu published.' };
    } catch (error) {
      logger.warn({ err: error, menuId }, 'role menu publish failed');
      return { ok: false, message: 'I could not post the menu — check my channel permissions.' };
    }
  }

  return { handleInteraction, publishMenu };
}

export type RoleMenuService = ReturnType<typeof createRoleMenuService>;
