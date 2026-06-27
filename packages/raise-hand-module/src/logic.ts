import type { OutgoingMessage } from '@botplatform/core';
import { truncate } from '@botplatform/shared';

/**
 * Discord permission that gates the moderator controls. "Mute Members" is the
 * natural "manage who speaks" permission — note the module never actually mutes
 * anyone; it is only used to identify who may run the moderator actions.
 */
export const MODERATOR_PERMISSION = 'MuteMembers';

/** Blurple — matches the project's component palette. */
export const PANEL_COLOR = 0x5865f2;

export type EntryStatus = 'waiting' | 'active' | 'done';

/** Pure, adapter-neutral view of a queue entry (decoupled from the DB row). */
export interface QueueEntryView {
  userExternalId: string;
  displayName: string;
  status: EntryStatus;
  priority: number;
  raisedAt: Date;
}

/** Front-to-back order of the waiting list: priority DESC, then earliest raise. */
export function sortWaiting(entries: QueueEntryView[]): QueueEntryView[] {
  return entries
    .filter((e) => e.status === 'waiting')
    .slice()
    .sort((a, b) => b.priority - a.priority || a.raisedAt.getTime() - b.raisedAt.getTime());
}

/** The single current speaker, if any. */
export function activeSpeaker(entries: QueueEntryView[]): QueueEntryView | null {
  return entries.find((e) => e.status === 'active') ?? null;
}

/** The next waiter the moderator would advance to. */
export function nextWaiting(entries: QueueEntryView[]): QueueEntryView | null {
  return sortWaiting(entries)[0] ?? null;
}

/** Priority value that places a promoted user ahead of every current waiter. */
export function promotedPriority(entries: QueueEntryView[]): number {
  const max = entries
    .filter((e) => e.status === 'waiting')
    .reduce((m, e) => Math.max(m, e.priority), 0);
  return max + 1;
}

/** 1-based position of a user in the waiting list, or null if not waiting. */
export function waitingPosition(entries: QueueEntryView[], userExternalId: string): number | null {
  const idx = sortWaiting(entries).findIndex((e) => e.userExternalId === userExternalId);
  return idx === -1 ? null : idx + 1;
}

// --- Control-panel customId encoding: `rh:<action>:<voiceChannelId>` ---------

export type PanelAction = 'raise' | 'lower' | 'show' | 'next' | 'clear';
const PANEL_PREFIX = 'rh';
const PANEL_ACTIONS: readonly PanelAction[] = ['raise', 'lower', 'show', 'next', 'clear'];

/** Panel actions that require moderator permission (re-checked server-side). */
export const MODERATOR_ACTIONS: ReadonlySet<PanelAction> = new Set<PanelAction>(['next', 'clear']);

export function panelCustomId(action: PanelAction, voiceChannelId: string): string {
  return `${PANEL_PREFIX}:${action}:${voiceChannelId}`;
}

export function parsePanelCustomId(
  customId: string
): { action: PanelAction; voiceChannelId: string } | null {
  const parts = customId.split(':');
  if (parts[0] !== PANEL_PREFIX || !parts[1] || !parts[2]) return null;
  const action = parts[1] as PanelAction;
  if (!PANEL_ACTIONS.includes(action)) return null;
  // voice channel ids never contain ':', but re-join defensively.
  return { action, voiceChannelId: parts.slice(2).join(':') };
}

// --- Rendering ---------------------------------------------------------------

/** Human-readable queue summary (used by the panel embed and /speaker-queue). */
export function formatQueueLines(entries: QueueEntryView[]): string {
  const active = activeSpeaker(entries);
  const waiting = sortWaiting(entries);
  const lines: string[] = [];
  if (active) lines.push(`🎤 **Now speaking:** ${truncate(active.displayName, 80)}`);
  if (waiting.length === 0) {
    lines.push(active ? '_No one else is waiting._' : '_The queue is empty — raise your hand to join._');
  } else {
    waiting.forEach((e, i) => lines.push(`**${i + 1}.** ${truncate(e.displayName, 80)}`));
  }
  return lines.join('\n');
}

/** Build the persistent control-panel message (embed + 5 buttons). */
export function buildPanelMessage(input: {
  voiceChannelId: string;
  voiceChannelName: string;
  entries: QueueEntryView[];
}): OutgoingMessage {
  const { voiceChannelId, voiceChannelName, entries } = input;
  return {
    embed: {
      title: `🙋 Speaker Queue — ${truncate(voiceChannelName, 80)}`,
      description: formatQueueLines(entries),
      color: PANEL_COLOR,
      footer: 'Raise your hand to join. Moderators advance or clear the queue.',
    },
    buttons: [
      { customId: panelCustomId('raise', voiceChannelId), label: 'Raise Hand', style: 'success', emoji: '🙋' },
      { customId: panelCustomId('lower', voiceChannelId), label: 'Lower Hand', style: 'secondary', emoji: '✋' },
      { customId: panelCustomId('show', voiceChannelId), label: 'Show Queue', style: 'secondary', emoji: '📋' },
      { customId: panelCustomId('next', voiceChannelId), label: 'Next Speaker', style: 'primary', emoji: '⏭️' },
      { customId: panelCustomId('clear', voiceChannelId), label: 'Clear', style: 'danger', emoji: '🧹' },
    ],
    // The panel must never ping anyone.
    allowMentions: { everyone: false, roles: [], users: [] },
  };
}
