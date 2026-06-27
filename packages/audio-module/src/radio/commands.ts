import type {
  CommandContext,
  CommandDefinition,
  ComponentInteractionEvent,
  MessageEmbed,
  OutgoingMessage,
  SubcommandDefinition,
  VoiceCapability,
} from '@botplatform/core';
import { truncate, UserFacingError } from '@botplatform/shared';
import type { GuildPlaybackSession } from '../engine/session.js';
import type { PlayerManager } from '../engine/manager.js';
import { buildNowPlayingPanel } from '../now-playing.js';
import type { ResolveContext } from '../resolver/types.js';
import { buildRadioTrack } from './radio-source.js';
import type { RadioRegistry } from './registry.js';
import type { RadioStation } from './stations.js';

/** customId of the station select menu; routed via component.interaction. */
export const RADIO_SELECT_ID = 'radio:select';
export const RADIO_COMPONENT_PREFIX = 'radio:';

/** Discord caps a select menu at 25 options. */
const SELECT_LIMIT = 25;
const NO_MENTIONS = { everyone: false, roles: [], users: [] };

export interface RadioCommandDeps {
  manager: PlayerManager;
  registry: RadioRegistry;
  resolveCtx: ResolveContext;
}

function requireVoice(ctx: CommandContext): VoiceCapability {
  if (!ctx.voice) throw new UserFacingError('VOICE_UNAVAILABLE', 'Voice is not available here.');
  return ctx.voice;
}

function requireGuildId(ctx: CommandContext): string {
  if (!ctx.guildId) {
    throw new UserFacingError('VOICE_UNAVAILABLE', 'This command only works inside a server.');
  }
  return ctx.guildId;
}

/** Ensure the bot is in a voice channel, joining the user's if needed. */
async function ensureSession(
  ctx: CommandContext,
  manager: PlayerManager
): Promise<GuildPlaybackSession | null> {
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
  return manager.ensureSession(guildId, active);
}

/** Take over playback with a station (stops whatever was playing). */
async function startRadio(
  session: GuildPlaybackSession,
  station: RadioStation,
  resolveCtx: ResolveContext,
  requestedBy?: string
): Promise<void> {
  const track = buildRadioTrack(station, resolveCtx, requestedBy);
  session.stop(); // radio replaces the current track + clears the queue
  await session.enqueueOrPlay(track);
}

function stationSelectMenu(stations: RadioStation[]): NonNullable<OutgoingMessage['selectMenu']> {
  return {
    customId: RADIO_SELECT_ID,
    placeholder: 'Pick a station to play…',
    options: stations.slice(0, SELECT_LIMIT).map((station) => ({
      label: truncate(station.name, 100),
      value: station.id,
      description: truncate(station.description ?? station.category, 100),
    })),
  };
}

function buildListEmbed(
  stations: RadioStation[],
  categories: string[],
  activeCategory?: string
): MessageEmbed {
  const byCategory = new Map<string, RadioStation[]>();
  for (const station of stations) {
    const list = byCategory.get(station.category) ?? [];
    list.push(station);
    byCategory.set(station.category, list);
  }
  const fields = [...byCategory.entries()].map(([category, list]) => ({
    name: category,
    value: list
      .map((station) => `• **${truncate(station.name, 60)}** — \`${station.id}\``)
      .join('\n')
      .slice(0, 1024),
  }));
  fields.push({
    name: 'How to play',
    value: 'Pick from the menu below, or use `/radio play <name or id>`.',
  });
  return {
    title: '📻 Online Radio',
    description: activeCategory
      ? `Category: **${activeCategory}**`
      : `Categories: ${categories.join(', ') || '—'}`,
    color: 0x4f8cff,
    fields,
  };
}

function textList(stations: RadioStation[]): string {
  return [
    '📻 Radio stations:',
    ...stations.map((station) => `• ${station.name} — \`${station.id}\` (${station.category})`),
    'Play with `/radio play <id>`.',
  ].join('\n');
}

export function buildRadioCommand(deps: RadioCommandDeps): CommandDefinition {
  const { manager, registry, resolveCtx } = deps;

  const list: SubcommandDefinition = {
    name: 'list',
    description: 'List the available radio stations',
    options: [
      { name: 'category', description: 'Filter by category', type: 'string', required: false },
    ],
    async execute(ctx) {
      const category =
        ctx.options['category'] !== undefined ? String(ctx.options['category']) : undefined;
      const stations = registry.list({ category });
      if (stations.length === 0) {
        await ctx.reply(
          category
            ? `No stations in “${category}”. Try \`/radio list\` to see categories.`
            : 'No radio stations are configured.'
        );
        return;
      }
      if (ctx.replyRich) {
        await ctx.replyRich({
          embed: buildListEmbed(stations, registry.categories(), category),
          selectMenu: stationSelectMenu(stations),
          allowMentions: NO_MENTIONS,
        });
        return;
      }
      await ctx.reply(textList(stations));
    },
  };

  const play: SubcommandDefinition = {
    name: 'play',
    description: 'Play a radio station by name or id',
    options: [
      { name: 'station', description: 'Station name or id (see /radio list)', type: 'string', required: true },
    ],
    async execute(ctx) {
      await ctx.defer();
      const query = String(ctx.options['station'] ?? '').trim();
      const station = registry.findByQuery(query);
      if (!station) {
        await ctx.reply({
          content: `Unknown station “${query}”. Use \`/radio list\` to see options.`,
          ephemeral: true,
        });
        return;
      }
      const session = await ensureSession(ctx, manager);
      if (!session) return;
      try {
        await startRadio(session, station, resolveCtx, ctx.user.displayName);
      } catch (error) {
        if (error instanceof UserFacingError) throw error; // precise SSRF/validation message
        await ctx.reply({
          content: `Could not start ${station.name} — it may be offline.`,
          ephemeral: true,
        });
        return;
      }
      if (ctx.replyRich) {
        await ctx.replyRich(buildNowPlayingPanel(session.getSnapshot()));
        return;
      }
      await ctx.reply(`📻 Now playing **${station.name}** (${station.category}).`);
    },
  };

  const stop: SubcommandDefinition = {
    name: 'stop',
    description: 'Stop the radio (and clear the queue)',
    async execute(ctx) {
      const session = manager.get(requireGuildId(ctx));
      if (!session || !session.isActive) {
        await ctx.reply({ content: 'Nothing is playing.', ephemeral: true });
        return;
      }
      session.stop();
      await ctx.reply('📻 Radio stopped.');
    },
  };

  const nowplaying: SubcommandDefinition = {
    name: 'nowplaying',
    description: 'Show what is currently playing',
    async execute(ctx) {
      const snapshot = manager.get(requireGuildId(ctx))?.getSnapshot();
      if (ctx.replyRich) {
        await ctx.replyRich(buildNowPlayingPanel(snapshot));
        return;
      }
      await ctx.reply(
        snapshot?.nowPlaying ? `Now playing: ${snapshot.nowPlaying.title}` : 'Nothing is playing.'
      );
    },
  };

  return {
    name: 'radio',
    description: 'Play online radio stations',
    guildOnly: true,
    subcommands: [list, play, stop, nowplaying],
  };
}

/**
 * Handles the `radio:` station select menu. Plays the chosen station on the
 * guild's ACTIVE session (components carry no voice capability, so the bot must
 * already be connected — otherwise it guides the user to `/radio play`).
 */
export function buildRadioComponentHandler(
  deps: RadioCommandDeps
): (event: ComponentInteractionEvent) => Promise<void> {
  const { manager, registry, resolveCtx } = deps;
  return async (event) => {
    if (!event.customId.startsWith(RADIO_COMPONENT_PREFIX)) return;
    const guildId = event.guild?.externalId;
    if (!guildId) return;

    const stationId = event.values[0];
    const station = stationId ? registry.get(stationId) : undefined;
    if (!station) {
      await event.reply('That station is no longer available.');
      return;
    }
    const session = manager.get(guildId);
    if (!session) {
      await event.reply(
        `I'm not in a voice channel. Use \`/radio play ${station.id}\` to start ${station.name}.`
      );
      return;
    }
    try {
      await startRadio(session, station, resolveCtx, event.user.displayName);
    } catch {
      await event.reply(`Could not start ${station.name} — it may be offline.`);
      return;
    }
    const panel = buildNowPlayingPanel(session.getSnapshot());
    if (event.update) await event.update(panel);
    else await event.reply(`📻 Now playing ${station.name}.`);
  };
}
