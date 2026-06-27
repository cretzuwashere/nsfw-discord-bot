import type {
  AuditLogPort,
  ComponentInteractionEvent,
  GuildServiceProvider,
  VoiceStateUpdateEvent,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import {
  buildPanelMessage,
  formatQueueLines,
  MODERATOR_ACTIONS,
  MODERATOR_PERMISSION,
  parsePanelCustomId,
  waitingPosition,
  type QueueEntryView,
} from './logic.js';
import type { SpeakerQueueEntryRow, SpeakerQueueRepo, SpeakerQueueRow } from './repo.js';

export interface SpeakerQueueServiceDeps {
  repo: SpeakerQueueRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  audit: AuditLogPort;
  logger: Logger;
  adapterKey?: string;
}

/** The actor performing a queue action. */
export interface ActorRef {
  externalId: string;
  displayName: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

const toViews = (rows: SpeakerQueueEntryRow[]): QueueEntryView[] =>
  rows.map((r) => ({
    userExternalId: r.userExternalId,
    displayName: r.displayName,
    status: r.status as QueueEntryView['status'],
    priority: r.priority,
    raisedAt: r.raisedAt,
  }));

export function createSpeakerQueueService(deps: SpeakerQueueServiceDeps) {
  const { repo, guilds, guildServiceProvider, audit, logger } = deps;
  const adapterKey = deps.adapterKey ?? 'discord';

  async function guildId(externalId: string, name?: string): Promise<string> {
    const guild = await guilds.upsertByExternalId({ adapterKey, externalId, name });
    return guild.id;
  }

  /** True when the user is the guild owner or holds the moderator permission. */
  async function isModerator(guildExternalId: string, userExternalId: string): Promise<boolean> {
    const svc = guildServiceProvider.forGuild(guildExternalId);
    if (!svc) return false;
    try {
      if (await svc.isGuildOwner(userExternalId)) return true;
      return await svc.memberHasPermission(userExternalId, MODERATOR_PERMISSION);
    } catch (err) {
      logger.debug({ err }, 'moderator check failed');
      return false;
    }
  }

  /** Re-render the persistent panel in place, if one is posted. */
  async function refreshPanel(guildExternalId: string, queue: SpeakerQueueRow): Promise<void> {
    if (!queue.panelChannelId || !queue.panelMessageId) return;
    const svc = guildServiceProvider.forGuild(guildExternalId);
    if (!svc) return;
    const entries = toViews(await repo.listEntries(queue.id));
    const message = buildPanelMessage({
      voiceChannelId: queue.voiceChannelId,
      voiceChannelName: queue.voiceChannelName || 'Voice channel',
      entries,
    });
    await svc
      .editMessage(queue.panelChannelId, queue.panelMessageId, message)
      .catch((err) => logger.debug({ err }, 'panel refresh failed'));
  }

  /** Announce the next speaker (or an empty queue) in the announce/panel channel. */
  async function announce(
    guildExternalId: string,
    queue: SpeakerQueueRow,
    next: SpeakerQueueEntryRow | null
  ): Promise<void> {
    const channelId = queue.announceChannelId ?? queue.panelChannelId;
    if (!channelId) return;
    const svc = guildServiceProvider.forGuild(guildExternalId);
    if (!svc) return;
    const content = next
      ? `🎤 <@${next.userExternalId}> is next to speak!`
      : 'The speaker queue is now empty.';
    await svc
      .sendMessage(channelId, {
        content,
        allowMentions: { everyone: false, roles: [], users: next ? [next.userExternalId] : [] },
      })
      .catch((err) => logger.debug({ err }, 'announce failed'));
  }

  async function recordAudit(action: string, guildExternalId: string, targetId?: string): Promise<void> {
    await audit.record({
      actorType: 'platform_user',
      action,
      moduleKey: MODULE_KEYS.raiseHand,
      guildId: guildExternalId,
      ...(targetId ? { targetType: 'voice_channel', targetId } : {}),
    });
  }

  // --- User actions ----------------------------------------------------------

  async function raiseHand(input: {
    guildExternalId: string;
    guildName?: string;
    voiceChannelId: string;
    voiceChannelName: string;
    user: ActorRef;
  }): Promise<string> {
    const gid = await guildId(input.guildExternalId, input.guildName);
    const queue = await repo.getOrCreateQueue(gid, input.voiceChannelId, input.voiceChannelName);
    const current = toViews(await repo.listEntries(queue.id));
    if (current.some((e) => e.status === 'active' && e.userExternalId === input.user.externalId)) {
      return 'You are the current speaker — your hand is already up. 🎤';
    }
    const { created } = await repo.addEntry({
      queueId: queue.id,
      userExternalId: input.user.externalId,
      displayName: input.user.displayName,
    });
    const after = toViews(await repo.listEntries(queue.id));
    const pos = waitingPosition(after, input.user.externalId);
    await refreshPanel(input.guildExternalId, queue);
    return created
      ? `🙋 Hand raised — you are **#${pos ?? '?'}** in the queue.`
      : `You already raised your hand — you are **#${pos ?? '?'}** in the queue.`;
  }

  async function lowerHand(input: {
    guildExternalId: string;
    voiceChannelId: string;
    user: ActorRef;
  }): Promise<string> {
    const gid = await guildId(input.guildExternalId);
    const queue = await repo.getQueue(gid, input.voiceChannelId);
    if (!queue) return 'Your hand was not raised.';
    const removed = await repo.removeEntry(queue.id, input.user.externalId);
    await refreshPanel(input.guildExternalId, queue);
    return removed > 0 ? '✋ Hand lowered — you left the queue.' : 'Your hand was not raised.';
  }

  async function showQueue(input: {
    guildExternalId: string;
    voiceChannelId: string;
  }): Promise<string> {
    const gid = await guildId(input.guildExternalId);
    const queue = await repo.getQueue(gid, input.voiceChannelId);
    if (!queue) return '_The queue is empty — raise your hand to join._';
    const entries = toViews(await repo.listEntries(queue.id));
    return formatQueueLines(entries);
  }

  // --- Moderator actions -----------------------------------------------------

  async function nextSpeaker(input: {
    guildExternalId: string;
    voiceChannelId: string;
  }): Promise<string> {
    const gid = await guildId(input.guildExternalId);
    const queue = await repo.getQueue(gid, input.voiceChannelId);
    if (!queue) return 'There is no speaker queue for this voice channel yet.';
    const next = await repo.advance(queue.id);
    await refreshPanel(input.guildExternalId, queue);
    await announce(input.guildExternalId, queue, next);
    await recordAudit('raisehand.next', input.guildExternalId, input.voiceChannelId);
    return next
      ? `⏭️ ${next.displayName} is now the active speaker.`
      : 'No one is waiting — the queue is empty.';
  }

  async function removeSpeaker(input: {
    guildExternalId: string;
    voiceChannelId: string;
    targetExternalId: string;
  }): Promise<string> {
    const gid = await guildId(input.guildExternalId);
    const queue = await repo.getQueue(gid, input.voiceChannelId);
    if (!queue) return 'There is no speaker queue for this voice channel yet.';
    const removed = await repo.removeEntry(queue.id, input.targetExternalId);
    await refreshPanel(input.guildExternalId, queue);
    return removed > 0
      ? '✅ Removed that member from the queue.'
      : 'That member was not in the queue.';
  }

  async function clearQueue(input: {
    guildExternalId: string;
    voiceChannelId: string;
  }): Promise<string> {
    const gid = await guildId(input.guildExternalId);
    const queue = await repo.getQueue(gid, input.voiceChannelId);
    if (!queue) return 'There is no speaker queue for this voice channel yet.';
    const count = await repo.clearQueue(queue.id);
    await refreshPanel(input.guildExternalId, queue);
    await recordAudit('raisehand.cleared', input.guildExternalId, input.voiceChannelId);
    return `🧹 Cleared the queue (${count} ${count === 1 ? 'entry' : 'entries'} removed).`;
  }

  async function promoteSpeaker(input: {
    guildExternalId: string;
    voiceChannelId: string;
    targetExternalId: string;
  }): Promise<string> {
    const gid = await guildId(input.guildExternalId);
    const queue = await repo.getQueue(gid, input.voiceChannelId);
    if (!queue) return 'There is no speaker queue for this voice channel yet.';
    const promoted = await repo.promote(queue.id, input.targetExternalId);
    await refreshPanel(input.guildExternalId, queue);
    return promoted
      ? `⬆️ Moved ${promoted.displayName} to the front of the queue.`
      : 'That member is not waiting in the queue.';
  }

  // --- Control panel ---------------------------------------------------------

  async function postPanel(input: {
    guildExternalId: string;
    guildName?: string;
    voiceChannelId: string;
    voiceChannelName: string;
    channelId: string;
  }): Promise<ActionResult> {
    const svc = guildServiceProvider.forGuild(input.guildExternalId);
    if (!svc) return { ok: false, message: 'The bot is not connected right now — try again shortly.' };
    const gid = await guildId(input.guildExternalId, input.guildName);
    const queue = await repo.getOrCreateQueue(gid, input.voiceChannelId, input.voiceChannelName);
    const entries = toViews(await repo.listEntries(queue.id));
    const payload = buildPanelMessage({
      voiceChannelId: queue.voiceChannelId,
      voiceChannelName: input.voiceChannelName,
      entries,
    });
    try {
      if (queue.panelChannelId && queue.panelMessageId) {
        await svc.deleteMessage(queue.panelChannelId, queue.panelMessageId).catch(() => {});
      }
      const sent = await svc.sendMessage(input.channelId, payload);
      await repo.setPanel(queue.id, sent.channelId, sent.messageId);
      await recordAudit('raisehand.panel', input.guildExternalId, input.voiceChannelId);
      return { ok: true, message: '✅ Speaker panel posted for your voice channel.' };
    } catch (err) {
      logger.warn({ err }, 'panel post failed');
      return { ok: false, message: 'I could not post the panel — check my channel permissions.' };
    }
  }

  // --- Event handlers --------------------------------------------------------

  /** Route a panel button click. Moderator buttons are re-checked server-side. */
  async function handleInteraction(event: ComponentInteractionEvent): Promise<void> {
    const parsed = parsePanelCustomId(event.customId);
    if (!parsed || !event.guild) return;
    const { action, voiceChannelId } = parsed;
    const guildExternalId = event.guild.externalId;
    const guildName = event.guild.name;
    const user: ActorRef = {
      externalId: event.user.externalId,
      displayName: event.user.displayName,
    };

    if (MODERATOR_ACTIONS.has(action)) {
      if (!(await isModerator(guildExternalId, user.externalId))) {
        await event.reply('Only moderators (Mute Members) can use that control.');
        return;
      }
    }

    switch (action) {
      case 'raise': {
        const msg = await raiseHand({ guildExternalId, guildName, voiceChannelId, voiceChannelName: '', user });
        await event.reply(msg);
        return;
      }
      case 'lower': {
        const msg = await lowerHand({ guildExternalId, voiceChannelId, user });
        await event.reply(msg);
        return;
      }
      case 'show': {
        const msg = await showQueue({ guildExternalId, voiceChannelId });
        await event.reply(msg);
        return;
      }
      case 'next': {
        const msg = await nextSpeaker({ guildExternalId, voiceChannelId });
        await event.reply(msg);
        return;
      }
      case 'clear': {
        const msg = await clearQueue({ guildExternalId, voiceChannelId });
        await event.reply(msg);
        return;
      }
    }
  }

  /** Drop a user from the queue of any channel they leave or move away from. */
  async function handleVoiceState(event: VoiceStateUpdateEvent): Promise<void> {
    if (!event.oldChannelId || event.oldChannelId === event.newChannelId) return;
    const gid = await guildId(event.guild.externalId, event.guild.name);
    const queue = await repo.getQueue(gid, event.oldChannelId);
    if (!queue) return;
    const removed = await repo.removeEntry(queue.id, event.user.externalId);
    if (removed > 0) await refreshPanel(event.guild.externalId, queue);
  }

  return {
    raiseHand,
    lowerHand,
    showQueue,
    nextSpeaker,
    removeSpeaker,
    clearQueue,
    promoteSpeaker,
    postPanel,
    handleInteraction,
    handleVoiceState,
    isModerator,
  };
}

export type SpeakerQueueService = ReturnType<typeof createSpeakerQueueService>;
