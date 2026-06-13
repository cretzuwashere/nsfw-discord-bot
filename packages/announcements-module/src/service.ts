import type { AuditLogPort, GuildServiceProvider, OutgoingMessage } from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import type { AnnouncementRepo, AnnouncementRow } from './repo.js';
import { hexColorToInt } from './validation.js';

export interface AnnouncementServiceDeps {
  announcements: AnnouncementRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  audit: AuditLogPort;
  logger: Logger;
}

export interface DeliveryResult {
  ok: boolean;
  message: string;
}

/**
 * Delivers announcements to Discord. Used by the `/announcement send` command
 * and the scheduler job. Validates the target channel + bot permissions and
 * applies strict mass-mention controls; raw errors never reach users.
 */
export function createAnnouncementService(deps: AnnouncementServiceDeps) {
  const { announcements, guilds, guildServiceProvider, audit, logger } = deps;

  async function deliver(announcement: AnnouncementRow): Promise<DeliveryResult> {
    if (announcement.isTemplate) {
      return { ok: false, message: 'Templates are not delivered.' };
    }
    if (!announcement.targetChannelId) {
      await fail(announcement, 'No target channel configured.');
      return { ok: false, message: 'No target channel configured.' };
    }

    const guild = await guilds.getById(announcement.guildId);
    if (!guild) {
      await fail(announcement, 'Guild not found.');
      return { ok: false, message: 'That server is no longer available.' };
    }

    const guildService = guildServiceProvider.forGuild(guild.externalId);
    if (!guildService) {
      // Bot offline — leave it scheduled so the next tick retries.
      return { ok: false, message: 'The bot is not connected right now; will retry.' };
    }

    const canSend = await guildService
      .botHasPermission('SendMessages', announcement.targetChannelId)
      .catch(() => false);
    if (!canSend) {
      await fail(announcement, 'Missing permission to post in the target channel.');
      return { ok: false, message: 'I lack permission to post in that channel.' };
    }

    const message = buildOutgoing(announcement);

    try {
      const sent = await guildService.sendMessage(announcement.targetChannelId, message);
      await announcements.setStatus(announcement.id, 'sent', {
        sentAt: new Date(),
        sentMessageId: sent.messageId,
        failureReason: null,
      });
      await audit.record({
        actorType: announcement.createdBy ? 'admin' : 'system',
        actorId: announcement.createdBy ?? undefined,
        action: 'announcement.sent',
        moduleKey: 'announcements',
        guildId: guild.externalId,
        targetType: 'announcement',
        targetId: announcement.id,
        metadata: { channelId: announcement.targetChannelId, mentionMode: announcement.mentionMode },
      });
      return { ok: true, message: 'Announcement sent.' };
    } catch (error) {
      logger.warn({ err: error, id: announcement.id }, 'announcement delivery failed');
      await fail(announcement, 'Delivery failed.');
      return { ok: false, message: 'The announcement could not be delivered.' };
    }
  }

  async function deliverById(id: string): Promise<DeliveryResult> {
    const announcement = await announcements.getById(id);
    if (!announcement) throw new UserFacingError('NOT_FOUND', 'Announcement not found.');
    return deliver(announcement);
  }

  /** Deliver every due scheduled announcement (called by the scheduler). */
  async function deliverDue(now: Date): Promise<number> {
    const due = await announcements.listDue(now);
    let delivered = 0;
    for (const announcement of due) {
      const result = await deliver(announcement);
      if (result.ok) delivered++;
    }
    return delivered;
  }

  async function fail(announcement: AnnouncementRow, reason: string): Promise<void> {
    await announcements.setStatus(announcement.id, 'failed', { failureReason: reason });
    await audit.record({
      actorType: 'system',
      action: 'announcement.failed',
      moduleKey: 'announcements',
      severity: 'warning',
      guildId: announcement.guildId,
      targetType: 'announcement',
      targetId: announcement.id,
      metadata: { reason },
    });
  }

  return { deliver, deliverById, deliverDue };
}

export type AnnouncementService = ReturnType<typeof createAnnouncementService>;

/** Build the adapter-neutral message, applying mass-mention safety. */
export function buildOutgoing(announcement: AnnouncementRow): OutgoingMessage {
  const message: OutgoingMessage = {};
  const mentionPrefix =
    announcement.mentionMode === 'everyone'
      ? '@everyone '
      : announcement.mentionMode === 'here'
        ? '@here '
        : announcement.mentionMode === 'roles'
          ? `${announcement.mentionRoleIds.map((id) => `<@&${id}>`).join(' ')} `
          : '';

  if (announcement.format === 'embed') {
    if (mentionPrefix) message.content = mentionPrefix.trim();
    message.embed = {
      title: announcement.title || undefined,
      description: announcement.body || undefined,
      color: hexColorToInt(announcement.embedColor),
      footer: announcement.footer || undefined,
      imageUrl: announcement.imageUrl || undefined,
    };
  } else {
    const parts = [mentionPrefix, announcement.title ? `**${announcement.title}**` : '', announcement.body]
      .filter(Boolean)
      .join('\n');
    message.content = parts || '(empty announcement)';
    if (announcement.imageUrl) {
      message.embed = { imageUrl: announcement.imageUrl };
    }
  }

  // Allowed-mentions: only what the mode explicitly permits.
  message.allowMentions = {
    everyone: announcement.mentionMode === 'everyone' || announcement.mentionMode === 'here',
    roles: announcement.mentionMode === 'roles' ? announcement.mentionRoleIds : [],
    users: [],
  };
  return message;
}
