import type { CommandContext, CommandDefinition, VoiceCapability } from '@botplatform/core';
import { formatDuration, truncate, UserFacingError } from '@botplatform/shared';
import type { PlayerManager } from './engine/manager.js';
import type { AudioResolver } from './resolver/resolver.js';
import type { ResolveContext } from './resolver/types.js';

export interface CommandDeps {
  manager: PlayerManager;
  resolver: AudioResolver;
  resolveCtx: ResolveContext;
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
  const { manager, resolver, resolveCtx } = deps;

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
      const voice = requireVoice(ctx);
      const guildId = requireGuildId(ctx);

      let active = voice.getActiveSession();
      if (!active || active.destroyed) {
        const channel = await voice.getUserVoiceChannel();
        if (!channel) {
          await ctx.reply({ content: 'You need to join a voice channel first.', ephemeral: true });
          return;
        }
        active = await voice.join(channel.id);
      }

      const rawUrl = String(ctx.options['url'] ?? '').trim();
      // Resolution validates the URL (SSRF guards included) and throws
      // UserFacingError for anything unsafe — the core boundary formats it.
      const resolved = await resolver.resolve(rawUrl, resolveCtx);
      const track = {
        ...resolved,
        metadata: { ...resolved.metadata, requestedBy: ctx.user.displayName },
      };

      const session = manager.ensureSession(guildId, active);
      const result = await session.enqueueOrPlay(track);
      const title = truncate(track.metadata.title, 120);
      if (result.status === 'playing') {
        await ctx.reply(`Now playing: **${title}**`);
      } else {
        await ctx.reply(`Queued (#${result.position}): **${title}**`);
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

  const nowplaying: CommandDefinition = {
    name: 'nowplaying',
    description: 'Show the current track',
    guildOnly: true,
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      const snapshot = session?.getSnapshot();
      if (!snapshot?.nowPlaying) {
        await ctx.reply('Nothing is playing right now.');
        return;
      }
      const track = snapshot.nowPlaying;
      const lines = [
        `**${truncate(track.title, 120)}**`,
        `Status: ${snapshot.status === 'paused' ? 'paused' : 'playing'}`,
        `Source: ${track.provider} — ${truncate(track.url, 200)}`,
      ];
      if (track.requestedBy) lines.push(`Requested by: ${track.requestedBy}`);
      await ctx.reply(lines.join('\n'));
    },
  };

  return [join, leave, play, queue, skip, pause, resume, stop, nowplaying];
}
