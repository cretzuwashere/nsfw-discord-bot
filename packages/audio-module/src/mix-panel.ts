import type { ComponentInteractionEvent, MessageButton, OutgoingMessage } from '@botplatform/core';
import { truncate, type QueueSnapshot } from '@botplatform/shared';
import type { PlayerManager } from './engine/manager.js';

/**
 * The "YouTube Mix" panel + its react-style buttons. When a `list=RD…` link is
 * played, a default few tracks are queued and this panel lets the user pull more
 * from the buffered mix (or clear the queue) — the same button mechanism as the
 * now-playing controls.
 */

export const MIX_BUTTON_PREFIX = 'mix:';
const NO_MENTIONS = { everyone: false, roles: [], users: [] };

export function mixButtonId(action: 'add' | 'remove' | 'clear', n?: number | 'all'): string {
  return action === 'clear' ? `${MIX_BUTTON_PREFIX}clear` : `${MIX_BUTTON_PREFIX}${action}:${n}`;
}

export type MixButton =
  | { action: 'add'; n: number | 'all' }
  | { action: 'remove'; n: number }
  | { action: 'clear' };

export function parseMixButton(customId: string): MixButton | null {
  if (!customId.startsWith(MIX_BUTTON_PREFIX)) return null;
  const rest = customId.slice(MIX_BUTTON_PREFIX.length);
  if (rest === 'clear') return { action: 'clear' };
  if (rest.startsWith('add:')) {
    const arg = rest.slice('add:'.length);
    if (arg === 'all') return { action: 'add', n: 'all' };
    const n = Number(arg);
    return Number.isInteger(n) && n > 0 ? { action: 'add', n } : null;
  }
  if (rest.startsWith('remove:')) {
    const n = Number(rest.slice('remove:'.length));
    return Number.isInteger(n) && n > 0 ? { action: 'remove', n } : null;
  }
  return null;
}

export interface MixPanelState {
  title: string;
  /** One-line status, e.g. "Queued 10 from the mix." */
  note: string;
  /** How many tracks are still buffered (drives whether "add" buttons show). */
  remaining: number;
}

export function buildMixPanel(
  snapshot: QueueSnapshot | undefined,
  mix: MixPanelState
): OutgoingMessage {
  const nowPlaying = snapshot?.nowPlaying;
  const description = [
    nowPlaying ? `▶️ **${truncate(nowPlaying.title, 110)}**` : 'Nothing is playing right now.',
    `🎶 Mix: **${truncate(mix.title, 90)}**`,
    mix.note,
    `**${mix.remaining}** more track(s) buffered from this mix.`,
  ].join('\n');

  const buttons: MessageButton[] = [];
  if (mix.remaining > 0) {
    buttons.push(
      { customId: mixButtonId('add', 5), label: '+5', style: 'success', emoji: '➕' },
      { customId: mixButtonId('add', 10), label: '+10', style: 'success' },
      { customId: mixButtonId('add', 25), label: '+25', style: 'success' },
      { customId: mixButtonId('add', 'all'), label: `Add all (${mix.remaining})`, style: 'primary' }
    );
  }
  // "Fewer": pop the most-recently-queued tracks. Only when something is queued.
  if ((snapshot?.queue.length ?? 0) > 0) {
    buttons.push({ customId: mixButtonId('remove', 5), label: '−5', style: 'secondary', emoji: '➖' });
  }
  buttons.push({ customId: mixButtonId('clear'), label: 'Clear queue', style: 'danger', emoji: '🗑️' });

  return {
    embed: {
      title: '🎵 YouTube Mix',
      description,
      color: 0x2ea66b,
      fields: [
        {
          name: 'Add more — or fewer',
          value:
            'Queue more from this mix (`+5/+10/+25/Add all`), drop the last few (`−5`), ' +
            'or clear the queue. Playback: `/controls`, `/skip`, `/stop`. Re-open with `/mix`.',
        },
      ],
    },
    buttons,
    allowMentions: NO_MENTIONS,
  };
}

/**
 * Handles the `mix:` buttons: pull more tracks from the buffered mix, or clear
 * the queue. Pulls happen on the guild's active session (state lives there).
 */
export function buildMixComponentHandler(
  manager: PlayerManager
): (event: ComponentInteractionEvent) => Promise<void> {
  return async (event) => {
    const parsed = parseMixButton(event.customId);
    if (!parsed) return; // not a mix button — ignore
    const guildId = event.guild?.externalId;
    if (!guildId) return;

    const session = manager.get(guildId);
    if (!session) {
      await event.reply("I'm not playing anything right now.");
      return;
    }

    let note: string;
    if (parsed.action === 'clear') {
      const cleared = session.clearQueue();
      session.clearPendingMix();
      note = cleared > 0 ? `Cleared ${cleared} upcoming track(s).` : 'The queue was already empty.';
    } else if (parsed.action === 'remove') {
      const removed = session.removeFromQueue(parsed.n);
      note =
        removed > 0
          ? `Removed the last ${removed} upcoming track(s).`
          : 'There were no upcoming tracks to remove.';
    } else {
      const n = parsed.n === 'all' ? Number.POSITIVE_INFINITY : parsed.n;
      const { added, remaining } = session.addFromPendingMix(n);
      note =
        added > 0
          ? `Added ${added} more from the mix.` +
            (remaining > 0 ? ` ${remaining} still buffered.` : ' That was the last buffered track.')
          : remaining > 0
            ? `The queue is full (max ${session.getSnapshot().maxQueueSize}) — drop or skip a track, then try again. ${remaining} still buffered.`
            : 'No more tracks are buffered from this mix.';
    }

    const panel = buildMixPanel(session.getSnapshot(), {
      title: session.pendingMixTitle ?? 'Mix',
      note,
      remaining: session.pendingMixCount,
    });
    if (event.update) await event.update(panel);
    else await event.reply(note);
  };
}
