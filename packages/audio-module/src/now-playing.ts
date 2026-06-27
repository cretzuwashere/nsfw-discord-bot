import type { OutgoingMessage } from '@botplatform/core';
import { formatDuration, truncate, type QueueSnapshot } from '@botplatform/shared';

/**
 * Visual now-playing panel for the audio bot: a rich embed with a Unicode
 * progress bar plus a row of control buttons. Pure (no I/O) so it is easy to
 * unit-test and reuse from `/controls`, `/nowplaying` and the button handler.
 */

/** customId prefix for audio control buttons (routed via component.interaction). */
export const AUDIO_BUTTON_PREFIX = 'audio:';

export type AudioControl = 'pause' | 'resume' | 'skip' | 'stop' | 'leave' | 'refresh';

export function audioButtonId(control: AudioControl): string {
  return `${AUDIO_BUTTON_PREFIX}${control}`;
}

export function parseAudioButton(customId: string): AudioControl | null {
  if (!customId.startsWith(AUDIO_BUTTON_PREFIX)) return null;
  const control = customId.slice(AUDIO_BUTTON_PREFIX.length);
  return ['pause', 'resume', 'skip', 'stop', 'leave', 'refresh'].includes(control)
    ? (control as AudioControl)
    : null;
}

/**
 * Render a text progress bar, e.g. `████████▒▒▒▒▒▒▒▒  1:23 / 4:56`.
 * When the duration is unknown, shows elapsed time with an indeterminate bar.
 */
export function progressBar(elapsedSeconds: number, durationSeconds: number | undefined, width = 18): string {
  const filledChar = '█';
  const emptyChar = '▒';
  if (!durationSeconds || durationSeconds <= 0) {
    return `🔴 LIVE / streaming · ${formatDuration(elapsedSeconds)}`;
  }
  const ratio = Math.min(Math.max(elapsedSeconds / durationSeconds, 0), 1);
  const filled = Math.round(ratio * width);
  const bar = filledChar.repeat(filled) + emptyChar.repeat(Math.max(width - filled, 0));
  return `${bar}  ${formatDuration(elapsedSeconds)} / ${formatDuration(durationSeconds)}`;
}

const COLOR_PLAYING = 0x2ea66b; // green
const COLOR_PAUSED = 0xd9a23b; // amber
const COLOR_IDLE = 0x4f8cff; // blue

/** The short command cheat-sheet shown on the panel. */
const COMMAND_HINTS =
  '`/play <link>` · `/queue` · `/skip` · `/pause` · `/resume` · `/stop` · `/leave` · `/controls`';

/**
 * Build the now-playing control panel for a guild's snapshot.
 * Buttons: ⏸/▶ (contextual) · ⏭ Skip · ⏹ Stop · 👋 Leave · 🔄 Refresh.
 */
export function buildNowPlayingPanel(snapshot: QueueSnapshot | undefined): OutgoingMessage {
  const noMentions = { everyone: false, roles: [], users: [] };

  if (!snapshot || !snapshot.nowPlaying) {
    return {
      embed: {
        title: '🎵 Audio Player — idle',
        description: 'Nothing is playing. Use `/play <link>` to start.',
        color: COLOR_IDLE,
        fields: [{ name: 'Commands', value: COMMAND_HINTS }],
      },
      buttons: [
        { customId: audioButtonId('refresh'), label: 'Refresh', style: 'secondary', emoji: '🔄' },
        { customId: audioButtonId('leave'), label: 'Leave', style: 'danger', emoji: '👋' },
      ],
      allowMentions: noMentions,
    };
  }

  const track = snapshot.nowPlaying;
  const paused = snapshot.status === 'paused';
  const elapsed = snapshot.elapsedSeconds ?? 0;

  const fields: NonNullable<OutgoingMessage['embed']>['fields'] = [
    { name: 'Progress', value: '`' + progressBar(elapsed, track.durationSeconds) + '`' },
    { name: 'Source', value: track.provider, inline: true },
    { name: 'Requested by', value: track.requestedBy || 'someone', inline: true },
  ];
  if (snapshot.loop) {
    const scope = snapshot.loop.mode === 'track' ? 'Track' : 'Queue';
    const count = snapshot.loop.remaining === null ? 'forever' : `${snapshot.loop.remaining} left`;
    fields.push({ name: 'Loop', value: `🔁 ${scope} · ${count}`, inline: true });
  }
  if (snapshot.queue.length > 0) {
    const upcoming = snapshot.queue
      .slice(0, 3)
      .map((t, i) => `${i + 1}. ${truncate(t.title, 50)}`)
      .join('\n');
    const more = snapshot.queue.length > 3 ? `\n…and ${snapshot.queue.length - 3} more` : '';
    fields.push({ name: `Up next (${snapshot.queue.length})`, value: upcoming + more });
  }
  fields.push({ name: 'Commands', value: COMMAND_HINTS });

  return {
    embed: {
      title: paused ? '⏸ Paused' : '🎶 Now Playing',
      description: `**${truncate(track.title, 200)}**\n${truncate(track.url, 300)}`,
      color: paused ? COLOR_PAUSED : COLOR_PLAYING,
      fields,
      footer: snapshot.channelName ? `🔊 #${snapshot.channelName}` : undefined,
    },
    buttons: [
      paused
        ? { customId: audioButtonId('resume'), label: 'Resume', style: 'success', emoji: '▶️' }
        : { customId: audioButtonId('pause'), label: 'Pause', style: 'primary', emoji: '⏸️' },
      { customId: audioButtonId('skip'), label: 'Skip', style: 'secondary', emoji: '⏭️' },
      { customId: audioButtonId('stop'), label: 'Stop', style: 'secondary', emoji: '⏹️' },
      { customId: audioButtonId('leave'), label: 'Leave', style: 'danger', emoji: '👋' },
      { customId: audioButtonId('refresh'), label: 'Refresh', style: 'secondary', emoji: '🔄' },
    ],
    allowMentions: noMentions,
  };
}
