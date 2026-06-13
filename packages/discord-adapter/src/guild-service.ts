import type {
  GuildChannelInfo,
  GuildRoleInfo,
  GuildService,
  MessageButton,
  OutgoingMessage,
  SelectOption,
  SentMessageRef,
} from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import { PlatformError } from '@botplatform/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';

const BUTTON_STYLES: Record<NonNullable<MessageButton['style']>, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  link: ButtonStyle.Link,
};

/**
 * discord.js-backed implementation of the adapter-neutral GuildService.
 * Every method wraps Discord calls and throws PlatformError (never raw
 * adapter errors) so callers can present safe messages.
 */
export class DiscordGuildService implements GuildService {
  constructor(
    readonly guildExternalId: string,
    private readonly client: Client,
    private readonly logger: Logger
  ) {}

  private async guild(): Promise<Guild> {
    try {
      return await this.client.guilds.fetch(this.guildExternalId);
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'guild not available', { cause: error });
    }
  }

  private async textChannel(channelId: string): Promise<TextChannel> {
    const guild = await this.guild();
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new PlatformError('NOT_FOUND', 'text channel not found');
    }
    return channel as TextChannel;
  }

  async sendMessage(channelId: string, message: OutgoingMessage): Promise<SentMessageRef> {
    const channel = await this.textChannel(channelId);
    try {
      const sent = await channel.send(buildMessagePayload(message));
      return { channelId, messageId: sent.id };
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to send message', { cause: error });
    }
  }

  async editMessage(channelId: string, messageId: string, message: OutgoingMessage): Promise<void> {
    const channel = await this.textChannel(channelId);
    try {
      const existing = await channel.messages.fetch(messageId);
      // send/edit option types overlap for the fields we set (content, embeds,
      // components, allowedMentions); the payload is built generically.
      await existing.edit(buildMessagePayload(message) as Parameters<typeof existing.edit>[0]);
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to edit message', { cause: error });
    }
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const channel = await this.textChannel(channelId);
    try {
      const existing = await channel.messages.fetch(messageId);
      await existing.delete();
    } catch (error) {
      this.logger.debug({ err: error, channelId, messageId }, 'message delete failed (ignored)');
    }
  }

  async sendDirectMessage(userExternalId: string, message: OutgoingMessage): Promise<void> {
    try {
      const user = await this.client.users.fetch(userExternalId);
      await user.send(buildMessagePayload(message));
    } catch (error) {
      // Users can block DMs; surface a clean error.
      throw new PlatformError('ADAPTER_ERROR', 'could not send a direct message', { cause: error });
    }
  }

  async listRoles(): Promise<GuildRoleInfo[]> {
    const guild = await this.guild();
    const roles = await guild.roles.fetch();
    return [...roles.values()]
      .filter((role) => role.id !== guild.id) // drop @everyone
      .map((role) => ({
        id: role.id,
        name: role.name,
        position: role.position,
        managed: role.managed,
      }))
      .sort((a, b) => b.position - a.position);
  }

  async listChannels(): Promise<GuildChannelInfo[]> {
    const guild = await this.guild();
    const channels = await guild.channels.fetch();
    return [...channels.values()].filter(Boolean).map((channel) => ({
      id: (channel as GuildBasedChannel).id,
      name: (channel as GuildBasedChannel).name,
      type: mapChannelType((channel as GuildBasedChannel).type),
    }));
  }

  async canManageRole(roleId: string): Promise<boolean> {
    const guild = await this.guild();
    const me = await guild.members.fetchMe();
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) return false;
    if (role.managed) return false;
    return (
      me.permissions.has(PermissionsBitField.Flags.ManageRoles) &&
      me.roles.highest.position > role.position
    );
  }

  async addRole(userExternalId: string, roleId: string, reason?: string): Promise<void> {
    await this.changeRole(userExternalId, roleId, 'add', reason);
  }

  async removeRole(userExternalId: string, roleId: string, reason?: string): Promise<void> {
    await this.changeRole(userExternalId, roleId, 'remove', reason);
  }

  private async changeRole(
    userExternalId: string,
    roleId: string,
    op: 'add' | 'remove',
    reason?: string
  ): Promise<void> {
    if (!(await this.canManageRole(roleId))) {
      throw new PlatformError('PERMISSION_DENIED', 'I cannot manage that role (hierarchy/permission).');
    }
    const guild = await this.guild();
    const member = await guild.members.fetch(userExternalId).catch(() => null);
    if (!member) throw new PlatformError('NOT_FOUND', 'member not found');
    try {
      if (op === 'add') await member.roles.add(roleId, reason);
      else await member.roles.remove(roleId, reason);
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to change role', { cause: error });
    }
  }

  async timeoutMember(userExternalId: string, durationSeconds: number, reason?: string): Promise<void> {
    const guild = await this.guild();
    const member = await guild.members.fetch(userExternalId).catch(() => null);
    if (!member) throw new PlatformError('NOT_FOUND', 'member not found');
    try {
      await member.timeout(durationSeconds * 1000, reason);
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to time out member', { cause: error });
    }
  }

  async removeTimeout(userExternalId: string, reason?: string): Promise<void> {
    const guild = await this.guild();
    const member = await guild.members.fetch(userExternalId).catch(() => null);
    if (!member) throw new PlatformError('NOT_FOUND', 'member not found');
    try {
      await member.timeout(null, reason);
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to remove timeout', { cause: error });
    }
  }

  async kickMember(userExternalId: string, reason?: string): Promise<void> {
    const guild = await this.guild();
    const member = await guild.members.fetch(userExternalId).catch(() => null);
    if (!member) throw new PlatformError('NOT_FOUND', 'member not found');
    if (!member.kickable) throw new PlatformError('PERMISSION_DENIED', 'I cannot kick that member.');
    try {
      await member.kick(reason);
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to kick member', { cause: error });
    }
  }

  async banMember(userExternalId: string, reason?: string, deleteMessageSeconds?: number): Promise<void> {
    const guild = await this.guild();
    try {
      await guild.members.ban(userExternalId, { reason, deleteMessageSeconds });
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to ban member', { cause: error });
    }
  }

  async unbanMember(userExternalId: string, reason?: string): Promise<void> {
    const guild = await this.guild();
    try {
      await guild.bans.remove(userExternalId, reason);
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to unban member', { cause: error });
    }
  }

  async purgeMessages(channelId: string, count: number): Promise<number> {
    const channel = await this.textChannel(channelId);
    try {
      const deleted = await channel.bulkDelete(Math.min(Math.max(count, 1), 100), true);
      return deleted.size;
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to purge messages', { cause: error });
    }
  }

  async setSlowmode(channelId: string, seconds: number): Promise<void> {
    const channel = await this.textChannel(channelId);
    try {
      await channel.setRateLimitPerUser(Math.min(Math.max(seconds, 0), 21600));
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to set slowmode', { cause: error });
    }
  }

  async setChannelLocked(channelId: string, locked: boolean, reason?: string): Promise<void> {
    const guild = await this.guild();
    const channel = await this.textChannel(channelId);
    try {
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: locked ? false : null },
        { reason }
      );
    } catch (error) {
      throw new PlatformError('ADAPTER_ERROR', 'failed to lock channel', { cause: error });
    }
  }

  async botHasPermission(permission: string, channelId?: string): Promise<boolean> {
    const guild = await this.guild();
    const me = await guild.members.fetchMe();
    const flag = (PermissionsBitField.Flags as Record<string, bigint>)[permission];
    if (flag === undefined) return false;
    if (channelId) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) return false;
      return channel.permissionsFor(me)?.has(flag) ?? false;
    }
    return me.permissions.has(flag);
  }

  async getMemberRoleIds(userExternalId: string): Promise<string[]> {
    const guild = await this.guild();
    const member = await guild.members.fetch(userExternalId).catch(() => null);
    return member ? [...member.roles.cache.keys()] : [];
  }

  async isGuildOwner(userExternalId: string): Promise<boolean> {
    const guild = await this.guild();
    return guild.ownerId === userExternalId;
  }
}

function mapChannelType(type: ChannelType): GuildChannelInfo['type'] {
  switch (type) {
    case ChannelType.GuildText:
    case ChannelType.GuildAnnouncement:
      return 'text';
    case ChannelType.GuildVoice:
    case ChannelType.GuildStageVoice:
      return 'voice';
    case ChannelType.GuildCategory:
      return 'category';
    default:
      return 'other';
  }
}

/** Build a discord.js message payload from the neutral OutgoingMessage. */
export function buildMessagePayload(
  message: OutgoingMessage
): Record<string, unknown> & Parameters<TextChannel['send']>[0] {
  const payload: Record<string, unknown> = {};
  if (message.content) payload['content'] = message.content;

  if (message.embed) {
    const embed = new EmbedBuilder();
    if (message.embed.title) embed.setTitle(message.embed.title);
    if (message.embed.description) embed.setDescription(message.embed.description);
    if (typeof message.embed.color === 'number') embed.setColor(message.embed.color);
    if (message.embed.footer) embed.setFooter({ text: message.embed.footer });
    if (message.embed.imageUrl) embed.setImage(message.embed.imageUrl);
    if (message.embed.thumbnailUrl) embed.setThumbnail(message.embed.thumbnailUrl);
    if (message.embed.fields?.length) {
      embed.addFields(
        message.embed.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false }))
      );
    }
    payload['embeds'] = [embed];
  }

  const components = buildComponents(message.buttons, message.selectMenu);
  if (components.length) payload['components'] = components;

  if (message.attachment) {
    payload['files'] = [{ attachment: message.attachment.data, name: message.attachment.filename }];
  }

  // Default to NO pings unless explicitly allowed (mass-mention safety).
  payload['allowedMentions'] = {
    parse: message.allowMentions?.everyone ? ['everyone'] : [],
    roles: message.allowMentions?.roles ?? [],
    users: message.allowMentions?.users ?? [],
  };

  return payload as Record<string, unknown> & Parameters<TextChannel['send']>[0];
}

function buildComponents(
  buttons: MessageButton[] | undefined,
  selectMenu: OutgoingMessage['selectMenu']
): unknown[] {
  const rows: unknown[] = [];
  if (buttons?.length) {
    // Up to 5 buttons per row; Discord allows 5 rows.
    for (let i = 0; i < buttons.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const button of buttons.slice(i, i + 5)) {
        const builder = new ButtonBuilder()
          .setLabel(button.label)
          .setStyle(BUTTON_STYLES[button.style ?? 'secondary']);
        if (button.emoji) builder.setEmoji(button.emoji);
        if (button.style === 'link' && button.url) builder.setURL(button.url);
        else if (button.customId) builder.setCustomId(button.customId);
        row.addComponents(builder);
      }
      rows.push(row);
    }
  }
  if (selectMenu) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(selectMenu.customId)
      .setMinValues(selectMenu.minValues ?? 0)
      .setMaxValues(selectMenu.maxValues ?? selectMenu.options.length)
      .addOptions(selectMenu.options.map(toSelectOption));
    if (selectMenu.placeholder) menu.setPlaceholder(selectMenu.placeholder);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }
  return rows;
}

function toSelectOption(option: SelectOption) {
  const built: { label: string; value: string; description?: string; emoji?: string } = {
    label: option.label,
    value: option.value,
  };
  if (option.description) built.description = option.description;
  if (option.emoji) built.emoji = option.emoji;
  return built;
}
