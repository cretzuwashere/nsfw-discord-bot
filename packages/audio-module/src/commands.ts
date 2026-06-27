import type {
  CommandContext,
  CommandDefinition,
  ComponentInteractionEvent,
  VoiceCapability,
} from '@botplatform/core';
import { formatDuration, truncate, UserFacingError, type InternalActionResult } from '@botplatform/shared';
import type { PlayerManager } from './engine/manager.js';
import type { GuildPlaybackSession } from './engine/session.js';
import { buildMixPanel } from './mix-panel.js';
import { buildNowPlayingPanel, parseAudioButton } from './now-playing.js';
import type { AudioResolver } from './resolver/resolver.js';
import type { ResolveContext, ResolvedTrack } from './resolver/types.js';
import { classifyYouTubeUrl, isMixList, type YouTubeUrlInfo } from './resolver/youtube-url.js';

export interface CommandDeps {
  manager: PlayerManager;
  resolver: AudioResolver;
  resolveCtx: ResolveContext;
  /** Max items pulled from a single YouTube playlist. */
  maxPlaylistItems: number;
  /** Default tracks auto-queued from a YouTube Mix/Radio before "add more". */
  mixDefaultItems: number;
}

/** How many mix tracks to buffer up front (the queue bound limits the rest). */
const MIX_BUFFER_MAX = 50;

/** Parse a string into a URL, or null when it is not a URL at all. */
function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

const QUEUE_DISPLAY_LIMIT = 10;

function requireVoice(ctx: CommandContext): VoiceCapability {
  if (!ctx.voice) {
    throw new UserFacingError('VOICE_UNAVAILABLE', 'Voice is not available here.');
  }
  return ctx.voice;
}

function requireGuildId(ctx: CommandContext): string {
  if (!ctx.guildId) {
    throw new UserFacingError('VOICE_UNAVAILABLE', 'This command only works inside a server.');
  }
  return ctx.guildId;
}

export function buildAudioCommands(deps: CommandDeps): CommandDefinition[] {
  const { manager, resolver, resolveCtx, maxPlaylistItems, mixDefaultItems } = deps;

  /**
   * Expand a playlist URL and batch-enqueue it, then report what happened.
   * Shared by `/play` (auto-expands pure playlist links) and `/playlist`.
   * Assumes `ctx.defer()` has already been called.
   */
  async function enqueuePlaylist(
    ctx: CommandContext,
    session: GuildPlaybackSession,
    rawUrl: string
  ): Promise<void> {
    const result = await resolver.resolvePlaylist(rawUrl, resolveCtx, maxPlaylistItems);
    if (result.tracks.length === 0) {
      await ctx.reply(
        result.total === 0
          ? 'That playlist is empty (or its items are all unavailable).'
          : `No playable tracks were found (${result.skipped} unavailable).`
      );
      return;
    }

    const requestedBy = ctx.user.displayName;
    for (const track of result.tracks) {
      track.metadata = { ...track.metadata, requestedBy };
    }

    const enq = await session.enqueueMany(result.tracks);
    const capped = Math.max(0, result.total - result.skipped - result.tracks.length);
    const parts = [`Added **${enq.accepted}** of ${result.total} track(s) from the playlist`];
    if (result.skipped > 0) parts.push(`${result.skipped} unavailable`);
    if (capped > 0) parts.push(`${capped} over the ${maxPlaylistItems}-track limit`);
    if (enq.rejected > 0) parts.push(`${enq.rejected} didn't fit the queue`);
    const summary = parts.join(' · ') + '.';
    await ctx.reply(
      enq.startedPlaying
        ? `${summary}\n▶️ Now playing the first track — use \`/queue\` to see what's next.`
        : summary
    );
  }

  /** Play (or queue) a single track and report it. Assumes defer() was called. */
  async function playSingle(
    ctx: CommandContext,
    session: GuildPlaybackSession,
    rawUrl: string
  ): Promise<void> {
    // Resolution validates the URL (SSRF guards included) and throws
    // UserFacingError for anything unsafe — the core boundary formats it.
    const resolved = await resolver.resolve(rawUrl, resolveCtx);
    const track = {
      ...resolved,
      metadata: { ...resolved.metadata, requestedBy: ctx.user.displayName },
    };
    const result = await session.enqueueOrPlay(track);
    const title = truncate(track.metadata.title, 120);
    if (result.status === 'playing') {
      // Show the visual control panel right away when playback starts.
      if (ctx.replyRich) {
        await ctx.replyRich(buildNowPlayingPanel(session.getSnapshot()));
      } else {
        await ctx.reply(`Now playing: **${title}**`);
      }
    } else {
      await ctx.reply(`Queued (#${result.position}): **${title}**`);
    }
  }

  /**
   * Handle a link that CONTAINS a playlist (`watch?v=…&list=…`): play the
   * chosen video right away, then load the rest of the playlist behind it.
   * Playlist expansion is best-effort — a hiccup there must never stop the
   * chosen video from playing.
   */
  async function playVideoWithPlaylist(
    ctx: CommandContext,
    session: GuildPlaybackSession,
    rawUrl: string,
    selectedVideoId: string | undefined
  ): Promise<void> {
    const resolved = await resolver.resolve(rawUrl, resolveCtx);
    const track = {
      ...resolved,
      metadata: { ...resolved.metadata, requestedBy: ctx.user.displayName },
    };
    const result = await session.enqueueOrPlay(track);
    const title = truncate(track.metadata.title, 120);

    let added = 0;
    try {
      const playlist = await resolver.resolvePlaylist(rawUrl, resolveCtx, maxPlaylistItems);
      // Skip the chosen video so it is not queued twice.
      const rest = playlist.tracks.filter(
        (t) => !selectedVideoId || !t.metadata.url.includes(selectedVideoId)
      );
      for (const t of rest) {
        t.metadata = { ...t.metadata, requestedBy: ctx.user.displayName };
      }
      added = (await session.enqueueMany(rest)).accepted;
    } catch (error) {
      ctx.logger.warn({ err: error }, 'could not expand the playlist behind the selected video');
    }

    const verb = result.status === 'playing' ? 'Now playing' : `Queued (#${result.position})`;
    await ctx.reply(
      added > 0
        ? `${verb}: **${title}** — and queued **${added}** more track(s) from the playlist.`
        : `${verb}: **${title}**`
    );
  }

  /**
   * Handle a YouTube Mix/Radio (`list=RD…`): play the seed video (if any), queue
   * `mixDefaultItems` tracks, buffer the rest, and show the mix panel so the user
   * can add more via buttons. Mix loading is best-effort.
   */
  async function playMix(
    ctx: CommandContext,
    session: GuildPlaybackSession,
    rawUrl: string,
    info: YouTubeUrlInfo
  ): Promise<void> {
    const requestedBy = ctx.user.displayName;

    // 1. Play the seed video right away when the link points at one.
    if (info.videoId) {
      const resolved = await resolver.resolve(rawUrl, resolveCtx);
      await session.enqueueOrPlay({
        ...resolved,
        metadata: { ...resolved.metadata, requestedBy },
      });
    }

    // 2. Fetch a bounded buffer of the mix (best-effort — the seed still plays).
    let mixTracks: ResolvedTrack[] = [];
    let title = 'YouTube Mix';
    try {
      // Always fetch enough to leave a buffer beyond the default-queued count,
      // even if an operator sets mixDefaultItems high.
      const fetchN = Math.min(maxPlaylistItems, Math.max(MIX_BUFFER_MAX, mixDefaultItems + 15));
      const playlist = await resolver.resolvePlaylist(rawUrl, resolveCtx, fetchN);
      title = playlist.title ?? title;
      mixTracks = playlist.tracks.filter(
        (t) => !info.videoId || !t.metadata.url.includes(info.videoId!)
      );
      for (const t of mixTracks) {
        t.metadata = { ...t.metadata, requestedBy };
      }
    } catch (error) {
      ctx.logger.warn({ err: error }, 'could not load the YouTube mix');
    }

    // 3. Queue the default few; buffer the rest for the add-more buttons.
    const initial = mixTracks.slice(0, mixDefaultItems);
    const buffer = mixTracks.slice(mixDefaultItems);
    const enq = await session.enqueueMany(initial);
    session.setPendingMix(buffer, title);

    const note =
      enq.accepted > 0
        ? `Queued **${enq.accepted}** track(s) from the mix.`
        : info.videoId
          ? 'Playing the track — no extra mix tracks were available.'
          : 'No playable mix tracks were found.';

    if (ctx.replyRich) {
      await ctx.replyRich(
        buildMixPanel(session.getSnapshot(), { title, note, remaining: buffer.length })
      );
    } else {
      await ctx.reply(
        `🎵 ${title}: ${note.replace(/\*\*/g, '')} ${buffer.length} more available ` +
          '(buttons need a rich-capable client).'
      );
    }
  }

  const join: CommandDefinition = {
    name: 'join',
    description: 'Join your current voice channel',
    guildOnly: true,
    async execute(ctx) {
      const voice = requireVoice(ctx);
      const channel = await voice.getUserVoiceChannel();
      if (!channel) {
        await ctx.reply({ content: 'You need to join a voice channel first.', ephemeral: true });
        return;
      }
      const active = voice.getActiveSession();
      if (active && !active.destroyed && active.channelId === channel.id) {
        await ctx.reply(`I'm already in #${channel.name}. Ready when you are!`);
        return;
      }
      const session = await voice.join(channel.id);
      manager.ensureSession(requireGuildId(ctx), session);
      await ctx.reply(`Joined #${channel.name}.`);
    },
  };

  const leave: CommandDefinition = {
    name: 'leave',
    description: 'Leave the voice channel',
    guildOnly: true,
    async execute(ctx) {
      const voice = requireVoice(ctx);
      const guildId = requireGuildId(ctx);
      const active = voice.getActiveSession();
      const destroyed = await manager.destroySession(guildId);
      if (!destroyed) {
        if (active && !active.destroyed) {
          await active.disconnect();
          await ctx.reply('Left the voice channel.');
          return;
        }
        await ctx.reply({ content: "I'm not in a voice channel.", ephemeral: true });
        return;
      }
      await ctx.reply('Left the voice channel.');
    },
  };

  /** Ensure the bot is in a voice channel, joining the user's if needed. */
  async function ensureActiveSession(ctx: CommandContext): Promise<GuildPlaybackSession | null> {
    const voice = requireVoice(ctx);
    const guildId = requireGuildId(ctx);
    let active = voice.getActiveSession();
    if (!active || active.destroyed) {
      const channel = await voice.getUserVoiceChannel();
      if (!channel) {
        await ctx.reply({ content: 'You need to join a voice channel first.', ephemeral: true });
        return null;
      }
      active = await voice.join(channel.id);
    }
    const session = manager.ensureSession(guildId, active);
    // Remember where to (re)post the now-playing panel on track changes.
    session.setTextChannel(ctx.channelId ?? undefined);
    return session;
  }

  const play: CommandDefinition = {
    name: 'play',
    description: 'Play from YouTube, SoundCloud, Spotify or a direct audio link (or queue it)',
    guildOnly: true,
    options: [
      {
        name: 'url',
        description: 'YouTube / SoundCloud / Spotify link, or a direct audio file URL',
        type: 'string',
        required: true,
      },
    ],
    async execute(ctx) {
      await ctx.defer();
      const session = await ensureActiveSession(ctx);
      if (!session) return;
      // A fresh /play invalidates any earlier mix buffer (so old mix-panel
      // buttons can't inject unrelated tracks). playMix re-sets it below.
      session.clearPendingMix();

      const rawUrl = String(ctx.options['url'] ?? '').trim();
      const parsed = tryParseUrl(rawUrl);
      const info: YouTubeUrlInfo = parsed ? classifyYouTubeUrl(parsed) : { kind: 'not-youtube' };
      const hasList = info.kind === 'playlist' || info.kind === 'video-in-playlist';

      // A YouTube Mix/Radio (list=RD…) queues a default few + an "add more" panel.
      // A pure playlist loads the whole list. A link that CONTAINS a playlist
      // (watch?v=…&list=…) plays the chosen video, then loads the rest behind it.
      // Everything else is a single track.
      if (hasList && isMixList(info.listId)) {
        await playMix(ctx, session, rawUrl, info);
      } else if (info.kind === 'playlist') {
        await enqueuePlaylist(ctx, session, rawUrl);
      } else if (info.kind === 'video-in-playlist') {
        await playVideoWithPlaylist(ctx, session, rawUrl, info.videoId);
      } else {
        await playSingle(ctx, session, rawUrl);
      }
    },
  };

  const playlist: CommandDefinition = {
    name: 'playlist',
    description: 'Add every track from a YouTube playlist link to the queue',
    guildOnly: true,
    options: [
      {
        name: 'url',
        description: 'A YouTube playlist link (playlist?list=… or watch?v=…&list=…)',
        type: 'string',
        required: true,
      },
    ],
    async execute(ctx) {
      await ctx.defer();
      const rawUrl = String(ctx.options['url'] ?? '').trim();
      const parsed = tryParseUrl(rawUrl);
      const info: YouTubeUrlInfo = parsed ? classifyYouTubeUrl(parsed) : { kind: 'not-youtube' };
      if (info.kind === 'video' || info.kind === 'not-youtube') {
        await ctx.reply({
          content: 'That link has no playlist. Use `/play <link>` for a single track.',
          ephemeral: true,
        });
        return;
      }
      const session = await ensureActiveSession(ctx);
      if (!session) return;
      session.clearPendingMix();
      // A Mix link goes through the same default-few + add-more panel as /play.
      if (isMixList(info.listId)) {
        await playMix(ctx, session, rawUrl, info);
      } else {
        await enqueuePlaylist(ctx, session, rawUrl);
      }
    },
  };

  const mixCmd: CommandDefinition = {
    name: 'mix',
    description: 'Re-open the YouTube Mix panel to add more tracks',
    guildOnly: true,
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      const remaining = session?.pendingMixCount ?? 0;
      if (!session || remaining === 0) {
        await ctx.reply({
          content: 'No active mix. Play a YouTube Mix link (a `…&list=RD…` URL) with `/play` first.',
          ephemeral: true,
        });
        return;
      }
      const state = {
        title: session.pendingMixTitle ?? 'Mix',
        note: `${remaining} track(s) buffered from the mix.`,
        remaining,
      };
      if (ctx.replyRich) {
        await ctx.replyRich(buildMixPanel(session.getSnapshot(), state));
      } else {
        await ctx.reply(`🎵 ${state.note} (a rich-capable client is needed for the buttons.)`);
      }
    },
  };

  const queue: CommandDefinition = {
    name: 'queue',
    description: 'Show the current queue',
    guildOnly: true,
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      const snapshot = session?.getSnapshot();
      if (!snapshot || (!snapshot.nowPlaying && snapshot.queue.length === 0)) {
        await ctx.reply('The queue is empty.');
        return;
      }
      const lines: string[] = [];
      if (snapshot.nowPlaying) {
        const requested = snapshot.nowPlaying.requestedBy
          ? ` (requested by ${snapshot.nowPlaying.requestedBy})`
          : '';
        lines.push(`Now playing: **${truncate(snapshot.nowPlaying.title, 120)}**${requested}`);
      }
      snapshot.queue.slice(0, QUEUE_DISPLAY_LIMIT).forEach((track, index) => {
        const duration =
          track.durationSeconds !== undefined ? ` [${formatDuration(track.durationSeconds)}]` : '';
        lines.push(`${index + 1}. ${truncate(track.title, 100)}${duration}`);
      });
      const remaining = snapshot.queue.length - QUEUE_DISPLAY_LIMIT;
      if (remaining > 0) lines.push(`…and ${remaining} more.`);
      await ctx.reply(lines.join('\n'));
    },
  };

  const skip: CommandDefinition = {
    name: 'skip',
    description: 'Skip the current track',
    guildOnly: true,
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      if (!session || !session.isActive) {
        await ctx.reply({ content: 'Nothing is playing.', ephemeral: true });
        return;
      }
      const result = await session.skip();
      if (result.next) {
        await ctx.reply(`Skipped. Now playing: **${truncate(result.next.title, 120)}**`);
      } else {
        await ctx.reply('Skipped. The queue is empty — stopping.');
      }
    },
  };

  const pause: CommandDefinition = {
    name: 'pause',
    description: 'Pause playback',
    guildOnly: true,
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      const result = session?.pause() ?? 'not-playing';
      const message =
        result === 'paused'
          ? 'Paused.'
          : result === 'already-paused'
            ? 'Already paused.'
            : 'Nothing is playing.';
      await ctx.reply(result === 'paused' ? message : { content: message, ephemeral: true });
    },
  };

  const resume: CommandDefinition = {
    name: 'resume',
    description: 'Resume paused playback',
    guildOnly: true,
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      const result = session?.resume() ?? 'not-paused';
      if (result === 'resumed') {
        await ctx.reply('Resumed.');
      } else {
        await ctx.reply({ content: 'Nothing is paused.', ephemeral: true });
      }
    },
  };

  const stop: CommandDefinition = {
    name: 'stop',
    description: 'Stop playback and clear the queue (stays in the channel)',
    guildOnly: true,
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      if (!session || (!session.isActive && session.getSnapshot().queue.length === 0)) {
        await ctx.reply({ content: 'Nothing is playing.', ephemeral: true });
        return;
      }
      session.stop();
      await ctx.reply('Stopped playback and cleared the queue.');
    },
  };

  /** Render the visual now-playing panel for this guild (idle-safe). */
  function panelFor(guildId: string) {
    return buildNowPlayingPanel(manager.get(guildId)?.getSnapshot());
  }

  const nowplaying: CommandDefinition = {
    name: 'nowplaying',
    description: 'Show the current track with a visual progress bar',
    guildOnly: true,
    async execute(ctx) {
      const guildId = requireGuildId(ctx);
      const snapshot = manager.get(guildId)?.getSnapshot();
      if (ctx.replyRich) {
        await ctx.replyRich(panelFor(guildId));
        return;
      }
      // Plain-text fallback for adapters without rich replies.
      if (!snapshot?.nowPlaying) {
        await ctx.reply('Nothing is playing right now.');
        return;
      }
      const track = snapshot.nowPlaying;
      await ctx.reply(
        `**${truncate(track.title, 120)}** — ${snapshot.status === 'paused' ? 'paused' : 'playing'}\n` +
          `Source: ${track.provider} · ${truncate(track.url, 200)}`
      );
    },
  };

  const controls: CommandDefinition = {
    name: 'controls',
    description: 'Show the audio player controls and live status',
    guildOnly: true,
    async execute(ctx) {
      const guildId = requireGuildId(ctx);
      if (ctx.replyRich) {
        await ctx.replyRich(panelFor(guildId));
        return;
      }
      await ctx.reply(
        'Controls: `/pause` `/resume` `/skip` `/stop` `/leave` · `/nowplaying` for status.'
      );
    },
  };

  async function applyLoop(ctx: CommandContext, mode: 'track' | 'queue' | 'off'): Promise<void> {
    const session = manager.get(requireGuildId(ctx));
    if (mode !== 'off' && (!session || !session.isActive)) {
      await ctx.reply({ content: 'Nothing is playing to loop.', ephemeral: true });
      return;
    }
    const timesRaw = ctx.options['times'];
    const times =
      typeof timesRaw === 'number' && Number.isFinite(timesRaw) && timesRaw > 0
        ? Math.floor(timesRaw)
        : null;
    session?.setLoop(mode, times);
    if (mode === 'off') {
      await ctx.reply('🔁 Looping turned off.');
    } else if (mode === 'track') {
      await ctx.reply(
        times
          ? `🔁 Looping the current track — ${times} more time(s).`
          : '🔁 Looping the current track — forever (use `/loop off` to stop).'
      );
    } else {
      const base = times
        ? `🔁 Looping the queue — ${times} more time(s).`
        : '🔁 Looping the whole queue — forever (use `/loop off` to stop).';
      await ctx.reply(
        `${base} (Tracks added later won't repeat — re-run \`/loop queue\` to include them.)`
      );
    }
  }

  const timesOption = {
    name: 'times',
    description: 'How many repeats (leave empty for forever)',
    type: 'integer' as const,
    required: false,
  };
  const loop: CommandDefinition = {
    name: 'loop',
    description: 'Repeat the current track or the whole queue (a set number of times, or forever)',
    guildOnly: true,
    subcommands: [
      {
        name: 'track',
        description: 'Repeat the current track',
        options: [timesOption],
        execute: (ctx) => applyLoop(ctx, 'track'),
      },
      {
        name: 'queue',
        description: 'Repeat the whole queue',
        options: [timesOption],
        execute: (ctx) => applyLoop(ctx, 'queue'),
      },
      {
        name: 'off',
        description: 'Turn looping off',
        execute: (ctx) => applyLoop(ctx, 'off'),
      },
    ],
  };

  return [join, leave, play, playlist, mixCmd, loop, queue, skip, pause, resume, stop, nowplaying, controls];
}

/**
 * Handles the audio control buttons (⏸/▶/⏭/⏹/👋/🔄) emitted by the
 * now-playing panel. Performs the action via the manager, then refreshes the
 * panel in place (or replies with the result when in-place edit is unavailable).
 */
export function buildAudioComponentHandler(
  manager: PlayerManager
): (event: ComponentInteractionEvent) => Promise<void> {
  return async (event) => {
    const control = parseAudioButton(event.customId);
    if (!control) return; // not an audio button — ignore
    const guildId = event.guild?.externalId;
    if (!guildId) return;

    let result: InternalActionResult = { ok: true, message: 'Refreshed.' };
    switch (control) {
      case 'pause':
        result = manager.pause(guildId);
        break;
      case 'resume':
        result = manager.resume(guildId);
        break;
      case 'skip':
        result = await manager.skip(guildId);
        break;
      case 'stop':
        result = await manager.stop(guildId);
        break;
      case 'leave': {
        const left = await manager.destroySession(guildId);
        result = { ok: left, message: left ? 'Left the voice channel.' : "I'm not in a voice channel." };
        break;
      }
      case 'refresh':
        break;
    }

    const panel = buildNowPlayingPanel(manager.get(guildId)?.getSnapshot());
    if (event.update) {
      await event.update(panel);
    } else {
      await event.reply(result.message || 'Done.');
    }
  };
}
