import type {
  ComponentInteractionEvent,
  GuildServiceProvider,
  OutgoingMessage,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { truncate, UserFacingError } from '@botplatform/shared';
import { drawWinners, type Rng } from './logic.js';
import type { GiveawayRepo, GiveawayRow } from './repo.js';

export interface GiveawayServiceDeps {
  repo: GiveawayRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  logger: Logger;
  adapterKey: string;
  rng?: Rng;
}

export interface StartGiveawayInput {
  guildExternalId: string;
  hostId: string;
  channelId: string;
  prize: string;
  durationSec: number;
  winnersCount: number;
}

type RenderState = Pick<GiveawayRow, 'id' | 'prize' | 'winnersCount' | 'endsAt' | 'status' | 'winners'>;

function buildMessage(g: RenderState): OutgoingMessage {
  const prize = truncate(g.prize, 200);
  if (g.status === 'active') {
    const unix = Math.floor(g.endsAt.getTime() / 1000);
    return {
      embed: {
        title: `🎉 Giveaway: ${prize}`,
        description: `Click **Enter** below to join!\n\n**Winners:** ${g.winnersCount}\n**Ends:** <t:${unix}:R>`,
        color: 0x57f287,
      },
      buttons: [{ customId: `giveaway:enter:${g.id}`, label: 'Enter', style: 'success', emoji: '🎉' }],
      allowMentions: { everyone: false, roles: [], users: [] },
    };
  }
  const winnersText =
    g.status === 'canceled'
      ? '_Canceled._'
      : g.winners.length > 0
        ? g.winners.map((w) => `<@${w}>`).join(', ')
        : '_No valid entrants._';
  return {
    embed: {
      title: `🎉 Giveaway ended: ${prize}`,
      description: `**Winners:** ${winnersText}`,
      color: 0x99aab5,
    },
    allowMentions: { everyone: false, roles: [], users: g.status === 'canceled' ? [] : g.winners },
  };
}

export function createGiveawayService(deps: GiveawayServiceDeps) {
  const rng = deps.rng ?? Math.random;

  async function resolveGuildId(externalId: string): Promise<string> {
    const guild = await deps.guilds.upsertByExternalId({
      adapterKey: deps.adapterKey,
      externalId,
    });
    return guild.id;
  }

  async function findOrThrow(guildId: string, shortId: string): Promise<GiveawayRow> {
    const id = shortId.trim();
    if (id.length < 4) throw new UserFacingError('NOT_FOUND', 'Give me at least the first 4 characters of the giveaway id.');
    const match = await deps.repo.findByShortId(guildId, id);
    if (!match) throw new UserFacingError('NOT_FOUND', 'No giveaway matches that id.');
    return match;
  }

  /** Post the win announcement + edit the original message (best effort). */
  async function announce(g: GiveawayRow, winners: string[]): Promise<void> {
    const guild = await deps.guilds.getById(g.guildId).catch(() => undefined);
    if (!guild) return;
    const svc = deps.guildServiceProvider.forGuild(guild.externalId);
    if (!svc) return;
    if (g.messageId) {
      await svc
        .editMessage(g.channelId, g.messageId, buildMessage({ ...g, status: 'ended', winners }))
        .catch((error) => deps.logger.warn({ err: error }, 'giveaway message edit failed'));
    }
    const prize = truncate(g.prize, 200);
    const content =
      winners.length > 0
        ? `🎉 Congratulations ${winners.map((w) => `<@${w}>`).join(', ')}! You won **${prize}**!`
        : `Nobody entered the giveaway for **${prize}**. 😢`;
    await svc
      .sendMessage(g.channelId, { content, allowMentions: { everyone: false, roles: [], users: winners } })
      .catch((error) => deps.logger.warn({ err: error }, 'giveaway announce failed'));
  }

  return {
    async start(input: StartGiveawayInput): Promise<GiveawayRow> {
      const svc = deps.guildServiceProvider.forGuild(input.guildExternalId);
      if (!svc) throw new UserFacingError('ADAPTER_ERROR', 'The bot is not connected right now — try again shortly.');
      const guildId = await resolveGuildId(input.guildExternalId);
      const row = await deps.repo.create({
        guildId,
        channelId: input.channelId,
        prize: truncate(input.prize, 200),
        winnersCount: input.winnersCount,
        hostExternalId: input.hostId,
        endsAt: new Date(Date.now() + input.durationSec * 1000),
      });
      const sent = await svc.sendMessage(input.channelId, buildMessage(row));
      await deps.repo.setMessageId(row.id, sent.messageId);
      return row;
    },

    async enter(event: ComponentInteractionEvent): Promise<void> {
      if (!event.customId.startsWith('giveaway:enter:')) return;
      const id = event.customId.split(':')[2] ?? '';
      const g = await deps.repo.getById(id);
      if (!g || g.status !== 'active' || new Date() > g.endsAt) {
        await event.reply('This giveaway has ended.');
        return;
      }
      const inserted = await deps.repo.addEntry(id, event.user.externalId);
      await event.reply(
        inserted ? '🎉 You have entered the giveaway — good luck!' : "You're already entered."
      );
    },

    /** Scheduler tick: draw every active giveaway whose time is up. */
    async drawDue(now: Date): Promise<number> {
      const due = await deps.repo.listDue(now);
      let drawn = 0;
      for (const g of due) {
        const entrants = await deps.repo.listEntrants(g.id);
        const winners = drawWinners(entrants, g.winnersCount, rng);
        await deps.repo.finish(g.id, winners, now);
        await announce(g, winners);
        drawn++;
      }
      return drawn;
    },

    async endNow(guildExternalId: string, shortId: string): Promise<string[]> {
      const guildId = await resolveGuildId(guildExternalId);
      const g = await findOrThrow(guildId, shortId);
      if (g.status !== 'active') throw new UserFacingError('NOT_FOUND', 'That giveaway is not active.');
      const entrants = await deps.repo.listEntrants(g.id);
      const winners = drawWinners(entrants, g.winnersCount, rng);
      await deps.repo.finish(g.id, winners, new Date());
      await announce(g, winners);
      return winners;
    },

    async reroll(guildExternalId: string, shortId: string): Promise<string[]> {
      const guildId = await resolveGuildId(guildExternalId);
      const g = await findOrThrow(guildId, shortId);
      if (g.status !== 'ended') throw new UserFacingError('NOT_FOUND', 'You can only reroll an ended giveaway.');
      const entrants = await deps.repo.listEntrants(g.id);
      const winners = drawWinners(entrants, g.winnersCount, rng);
      await deps.repo.setWinners(g.id, winners);
      await announce(g, winners);
      return winners;
    },

    async cancel(guildExternalId: string, shortId: string): Promise<void> {
      const guildId = await resolveGuildId(guildExternalId);
      const g = await findOrThrow(guildId, shortId);
      if (g.status !== 'active') throw new UserFacingError('NOT_FOUND', 'Only active giveaways can be canceled.');
      await deps.repo.setCanceled(g.id);
      const guild = await deps.guilds.getById(g.guildId).catch(() => undefined);
      const svc = guild ? deps.guildServiceProvider.forGuild(guild.externalId) : null;
      if (svc && g.messageId) {
        await svc
          .editMessage(g.channelId, g.messageId, buildMessage({ ...g, status: 'canceled', winners: [] }))
          .catch(() => {});
      }
    },

    async listActive(guildExternalId: string): Promise<GiveawayRow[]> {
      const guildId = await resolveGuildId(guildExternalId);
      return deps.repo.listActiveByGuild(guildId);
    },
  };
}

export type GiveawayService = ReturnType<typeof createGiveawayService>;
