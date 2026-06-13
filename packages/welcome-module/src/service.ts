import type {
  AuditLogPort,
  GuildServiceProvider,
  MemberJoinEvent,
  MemberLeaveEvent,
  OutgoingMessage,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { applyPlaceholders, buildPlaceholderData, type PlaceholderData } from '@botplatform/shared';
import type { WelcomeRepo, WelcomeSettingsRow } from './repo.js';

export type CardRenderer = (
  templateId: string,
  data: PlaceholderData & { 'user.avatarUrl'?: string }
) => Promise<Buffer | null>;

export interface WelcomeServiceDeps {
  welcome: WelcomeRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  audit: AuditLogPort;
  logger: Logger;
  /** Optional — renders a welcome card when a template is configured. */
  renderCard?: CardRenderer | undefined;
  adapterKey?: string;
}

const DEDUP_TTL_MS = 60_000;

/** Handles member join/leave: messages, cards, DMs and auto-roles. */
export function createWelcomeService(deps: WelcomeServiceDeps) {
  const { welcome, guilds, guildServiceProvider, audit, logger } = deps;
  const adapterKey = deps.adapterKey ?? 'discord';
  // Guards against duplicate gateway events for the same join.
  const recentJoins = new Map<string, number>();

  async function handleJoin(event: MemberJoinEvent): Promise<void> {
    const dedupKey = `${event.guild.externalId}:${event.user.externalId}`;
    const now = Date.now();
    const last = recentJoins.get(dedupKey);
    if (last && now - last < DEDUP_TTL_MS) return;
    recentJoins.set(dedupKey, now);
    pruneDedup(recentJoins, now);

    const guild = await guilds.upsertByExternalId({
      adapterKey,
      externalId: event.guild.externalId,
      name: event.guild.name,
    });
    const settings = await welcome.get(guild.id);
    if (!settings || !settings.welcomeEnabled) return;

    const run = async () => {
      const service = guildServiceProvider.forGuild(event.guild.externalId);
      if (!service) return;

      const data = buildPlaceholderData({
        user: {
          id: event.user.externalId,
          username: event.user.username,
          displayName: event.user.displayName,
          avatarUrl: event.user.avatarUrl,
        },
        server: { name: event.guild.name, memberCount: event.memberCount },
      });

      // Auto-roles (each validated for hierarchy by the GuildService).
      for (const roleId of settings.autoRoleIds) {
        await service.addRole(event.user.externalId, roleId, 'welcome auto-role').catch((error) => {
          logger.warn({ err: error, roleId }, 'welcome auto-role failed');
        });
      }

      // Welcome message + optional card.
      if (settings.welcomeChannelId) {
        const message = await buildWelcomeMessage(settings, data, event.user.avatarUrl);
        await service.sendMessage(settings.welcomeChannelId, message).catch((error) => {
          logger.warn({ err: error }, 'welcome message failed');
        });
      }

      // Optional DM.
      if (settings.dmEnabled && settings.dmMessage) {
        await service
          .sendDirectMessage(event.user.externalId, {
            content: applyPlaceholders(settings.dmMessage, data),
            allowMentions: { everyone: false, roles: [], users: [] },
          })
          .catch((error) => logger.debug({ err: error }, 'welcome DM failed (user may block DMs)'));
      }

      await audit.record({
        actorType: 'system',
        action: 'welcome.sent',
        moduleKey: 'welcome',
        guildId: event.guild.externalId,
        targetType: 'user',
        targetId: event.user.externalId,
      });
    };

    if (settings.delaySeconds > 0) {
      const timer = setTimeout(() => void run(), settings.delaySeconds * 1000);
      timer.unref?.();
    } else {
      await run();
    }
  }

  async function handleLeave(event: MemberLeaveEvent): Promise<void> {
    const guild = await guilds.upsertByExternalId({
      adapterKey,
      externalId: event.guild.externalId,
      name: event.guild.name,
    });
    const settings = await welcome.get(guild.id);
    if (!settings || !settings.leaveEnabled || !settings.leaveChannelId) return;

    const service = guildServiceProvider.forGuild(event.guild.externalId);
    if (!service) return;

    const data = buildPlaceholderData({
      user: {
        id: event.user.externalId,
        username: event.user.username,
        displayName: event.user.displayName,
      },
      server: { name: event.guild.name, memberCount: event.memberCount },
    });
    await service
      .sendMessage(settings.leaveChannelId, {
        content: applyPlaceholders(settings.leaveMessage, data),
        allowMentions: { everyone: false, roles: [], users: [] },
      })
      .catch((error) => logger.warn({ err: error }, 'leave message failed'));

    await audit.record({
      actorType: 'system',
      action: 'welcome.leave',
      moduleKey: 'welcome',
      guildId: event.guild.externalId,
      targetType: 'user',
      targetId: event.user.externalId,
    });
  }

  async function buildWelcomeMessage(
    settings: WelcomeSettingsRow,
    data: PlaceholderData,
    avatarUrl: string | undefined
  ): Promise<OutgoingMessage> {
    const content = applyPlaceholders(settings.welcomeMessage, data);
    const message: OutgoingMessage = {
      content,
      // Allow pinging the welcomed user (their mention is in the message).
      allowMentions: {
        everyone: false,
        roles: [],
        users: typeof data['user.id'] === 'string' ? [data['user.id']] : [],
      },
    };
    if (settings.welcomeCardTemplateId && deps.renderCard) {
      const card = await deps
        .renderCard(settings.welcomeCardTemplateId, { ...data, 'user.avatarUrl': avatarUrl ?? '' })
        .catch(() => null);
      if (card) message.attachment = { data: card, filename: 'welcome.png' };
    }
    return message;
  }

  return { handleJoin, handleLeave };
}

function pruneDedup(map: Map<string, number>, now: number): void {
  if (map.size < 1000) return;
  for (const [key, ts] of map) {
    if (now - ts > DEDUP_TTL_MS) map.delete(key);
  }
}

export type WelcomeService = ReturnType<typeof createWelcomeService>;
