import type {
  ComponentInteractionEvent,
  GuildServiceProvider,
  OutgoingMessage,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import {
  CATEGORY_TITLE,
  getBankLength,
  PROMPT_CATEGORIES,
  renderPrompt,
  type PromptCategory,
} from './banks.js';
import { isQotdDue, pickIndex, ymdUtc, type Rng } from './logic.js';
import type { PromptConfigInput, PromptRepo } from './repo.js';

const COLOR = 0x5865f2;

export interface PromptServiceDeps {
  repo: PromptRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  logger: Logger;
  adapterKey: string;
  rng?: Rng;
}

export function createPromptService(deps: PromptServiceDeps) {
  const rng = deps.rng ?? Math.random;

  function buildMessage(category: PromptCategory, index: number): OutgoingMessage {
    return {
      embed: {
        title: CATEGORY_TITLE[category],
        description: renderPrompt(category, index),
        color: COLOR,
      },
      buttons: [
        { customId: `prompt:another:${category}`, label: 'Another', style: 'secondary', emoji: '🔁' },
      ],
      allowMentions: { everyone: false, roles: [], users: [] },
    };
  }

  /** Pick a non-recent prompt for an internal guild id and persist the ring. */
  async function pickAndRender(guildId: string, category: PromptCategory): Promise<OutgoingMessage> {
    const settings = await deps.repo.ensure(guildId);
    const recentMap = settings.recent ?? {};
    const recent = recentMap[category] ?? [];
    const { index, recent: nextRecent } = pickIndex(getBankLength(category), recent, rng);
    await deps.repo.setRecent(guildId, { ...recentMap, [category]: nextRecent });
    return buildMessage(category, index);
  }

  return {
    /** Build a prompt for an external (Discord) guild id (used by slash commands). */
    async promptFor(guildExternalId: string, category: PromptCategory): Promise<OutgoingMessage> {
      const guild = await deps.guilds.upsertByExternalId({
        adapterKey: deps.adapterKey,
        externalId: guildExternalId,
      });
      return pickAndRender(guild.id, category);
    },

    async setConfig(guildExternalId: string, cfg: PromptConfigInput): Promise<void> {
      const guild = await deps.guilds.upsertByExternalId({
        adapterKey: deps.adapterKey,
        externalId: guildExternalId,
      });
      await deps.repo.setConfig(guild.id, cfg);
    },

    async handleInteraction(event: ComponentInteractionEvent): Promise<void> {
      if (!event.customId.startsWith('prompt:another:')) return;
      const category = event.customId.split(':')[2] as PromptCategory;
      if (!PROMPT_CATEGORIES.includes(category) || !event.guild) {
        await event.reply('That prompt is no longer available.');
        return;
      }
      const guild = await deps.guilds.upsertByExternalId({
        adapterKey: deps.adapterKey,
        externalId: event.guild.externalId,
      });
      const msg = await pickAndRender(guild.id, category);
      if (event.update) await event.update(msg);
      else await event.reply(renderPrompt(category, 0));
    },

    /** Scheduler tick: post the daily QOTD to every guild that is due. */
    async deliverDailyQotd(now: Date): Promise<number> {
      const rows = await deps.repo.listEnabledDaily();
      let posted = 0;
      for (const s of rows) {
        if (!isQotdDue(s, now)) continue;
        const guild = await deps.guilds.getById(s.guildId).catch(() => undefined);
        if (!guild) continue;
        const svc = deps.guildServiceProvider.forGuild(guild.externalId);
        if (!svc) continue; // bot offline — retry next tick (date not advanced)
        const msg = await pickAndRender(s.guildId, 'qotd');
        try {
          await svc.sendMessage(s.qotdChannelId!, msg);
          await deps.repo.markQotdPosted(s.guildId, ymdUtc(now));
          posted++;
        } catch (error) {
          deps.logger.warn({ err: error, guildId: s.guildId }, 'daily QOTD post failed');
          // Advance the date so a permission/channel error does not retry every tick.
          await deps.repo.markQotdPosted(s.guildId, ymdUtc(now));
        }
      }
      return posted;
    },
  };
}

export type PromptService = ReturnType<typeof createPromptService>;
