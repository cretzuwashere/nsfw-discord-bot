import type {
  ComponentInteractionEvent,
  GuildServiceProvider,
  MessageButton,
  OutgoingMessage,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { truncate, UserFacingError } from '@botplatform/shared';
import { computeDaily, validatePurchase, validateTransfer, ymdUtc } from './logic.js';
import type { EconomyConfigInput, EconomyRepo, EconomySettingsRow } from './repo.js';

const PAGE_SIZE = 10;
const COLOR = 0xf1c40f;

export interface EconomyServiceDeps {
  repo: EconomyRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  logger: Logger;
  adapterKey: string;
}

export function createEconomyService(deps: EconomyServiceDeps) {
  async function resolveGuildId(externalId: string): Promise<string> {
    const guild = await deps.guilds.upsertByExternalId({ adapterKey: deps.adapterKey, externalId });
    return guild.id;
  }

  function fmt(amount: number, s: EconomySettingsRow): string {
    return `**${amount.toLocaleString()}** ${s.currencyEmoji}`;
  }

  function pageButtons(prefix: string, page: number): MessageButton[] {
    return [
      { customId: `${prefix}:${page - 1}`, label: '◀ Prev', style: 'secondary' },
      { customId: `${prefix}:${page + 1}`, label: 'Next ▶', style: 'secondary' },
    ];
  }

  async function baltopPage(guildExternalId: string, page: number): Promise<OutgoingMessage> {
    const guildId = await resolveGuildId(guildExternalId);
    const settings = await deps.repo.ensureSettings(guildId);
    const total = await deps.repo.countAccounts(guildId);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const p = Math.max(0, Math.min(page, pages - 1));
    const rows = await deps.repo.topBalances(guildId, PAGE_SIZE, p * PAGE_SIZE);
    const medals = ['🥇', '🥈', '🥉'];
    const body =
      rows.length === 0
        ? '_No accounts yet._'
        : rows
            .map((r, i) => {
              const rank = p * PAGE_SIZE + i;
              return `${medals[rank] ?? `**${rank + 1}.**`} <@${r.userExternalId}> — ${fmt(r.balance, settings)}`;
            })
            .join('\n');
    return {
      embed: { title: `${settings.currencyEmoji} Richest members`, description: body, color: COLOR, footer: `Page ${p + 1}/${pages}` },
      buttons: pageButtons('eco:baltop', p),
      allowMentions: { everyone: false, roles: [], users: [] },
    };
  }

  async function shopPage(guildExternalId: string, page: number): Promise<OutgoingMessage> {
    const guildId = await resolveGuildId(guildExternalId);
    const settings = await deps.repo.ensureSettings(guildId);
    const all = await deps.repo.listActiveItems(guildId);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const p = Math.max(0, Math.min(page, pages - 1));
    const slice = all.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
    const body =
      slice.length === 0
        ? '_The shop is empty. An admin can add items with /shopadmin add._'
        : slice
            .map((it) => `\`${it.id.slice(0, 8)}\` ${it.label || `<@&${it.roleId}>`} — ${fmt(it.price, settings)}`)
            .join('\n');
    return {
      embed: { title: '🛒 Shop', description: `${body}\n\n_Buy with_ \`/buy <id>\`.`, color: COLOR, footer: `Page ${p + 1}/${pages}` },
      buttons: pageButtons('eco:shop', p),
      allowMentions: { everyone: false, roles: [], users: [] },
    };
  }

  return {
    baltopPage,
    shopPage,

    async balance(guildExternalId: string, userExternalId: string): Promise<OutgoingMessage> {
      const guildId = await resolveGuildId(guildExternalId);
      const settings = await deps.repo.ensureSettings(guildId);
      const balance = await deps.repo.getBalance(guildId, userExternalId, settings.startingBalance);
      return {
        embed: {
          title: `${settings.currencyEmoji} Balance`,
          description: `<@${userExternalId}> has ${fmt(balance, settings)} ${settings.currencyName}.`,
          color: COLOR,
        },
        allowMentions: { everyone: false, roles: [], users: [] },
      };
    },

    async give(guildExternalId: string, fromId: string, toId: string, amount: number): Promise<string> {
      if (toId === fromId) throw new UserFacingError('NOT_FOUND', 'You cannot give to yourself.');
      const guildId = await resolveGuildId(guildExternalId);
      const settings = await deps.repo.ensureSettings(guildId);
      const from = await deps.repo.ensureAccount(guildId, fromId, settings.startingBalance);
      const check = validateTransfer(from.balance, amount);
      if (!check.ok) throw new UserFacingError('NOT_FOUND', check.error!);
      const ok = await deps.repo.transfer(guildId, fromId, toId, amount, settings.startingBalance);
      if (!ok) throw new UserFacingError('NOT_FOUND', 'You do not have enough to give that much.');
      return `You gave ${fmt(amount, settings)} to <@${toId}>.`;
    },

    async daily(guildExternalId: string, userExternalId: string): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      const settings = await deps.repo.ensureSettings(guildId);
      const account = await deps.repo.ensureAccount(guildId, userExternalId, settings.startingBalance);
      const result = computeDaily(new Date(), account.lastDailyDate, account.streak, settings);
      if (!result.canClaim) return '⏳ You already claimed your daily reward today. Come back tomorrow (UTC)!';
      const claimed = await deps.repo.claimDaily(
        guildId,
        userExternalId,
        result.amount,
        result.newStreak,
        ymdUtc(new Date()),
        settings.startingBalance
      );
      if (!claimed) return '⏳ You already claimed your daily reward today.';
      return `✅ You claimed ${fmt(result.amount, settings)}! 🔥 Streak: **${result.newStreak}** day(s).`;
    },

    async buy(guildExternalId: string, userExternalId: string, shortId: string): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      const settings = await deps.repo.ensureSettings(guildId);
      const item = await deps.repo.findItemByShortId(guildId, shortId.trim());
      if (!item || !item.active) throw new UserFacingError('NOT_FOUND', 'No shop item matches that id.');
      const svc = deps.guildServiceProvider.forGuild(guildExternalId);
      if (!svc) throw new UserFacingError('ADAPTER_ERROR', 'The bot is not connected right now.');
      const account = await deps.repo.ensureAccount(guildId, userExternalId, settings.startingBalance);
      const check = validatePurchase(account.balance, item.price);
      if (!check.ok) throw new UserFacingError('NOT_FOUND', check.error!);
      const roleIds = await svc.getMemberRoleIds(userExternalId).catch(() => [] as string[]);
      if (roleIds.includes(item.roleId)) throw new UserFacingError('NOT_FOUND', 'You already own this role.');
      const canManage = await svc.canManageRole(item.roleId).catch(() => false);
      if (!canManage) {
        throw new UserFacingError('PERMISSION_DENIED', "I can't assign that role — ask an admin to move my role above it.");
      }
      const debited = await deps.repo.tryDebit(guildId, userExternalId, item.price, `shop:${item.id}`, settings.startingBalance);
      if (!debited) throw new UserFacingError('NOT_FOUND', 'You can no longer afford this item.');
      try {
        await svc.addRole(userExternalId, item.roleId, 'shop purchase');
      } catch (error) {
        await deps.repo.applyDelta(guildId, userExternalId, item.price, 'refund: role grant failed', settings.startingBalance);
        deps.logger.warn({ err: error, itemId: item.id }, 'shop role grant failed, refunded');
        throw new UserFacingError('ADAPTER_ERROR', 'Could not assign the role — your balance was refunded.');
      }
      await deps.repo.recordPurchase(guildId, userExternalId, item.id, item.price);
      return `🛒 You bought **${truncate(item.label || 'a role', 80)}** for ${fmt(item.price, settings)}!`;
    },

    async grant(guildExternalId: string, targetId: string, amount: number): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      const settings = await deps.repo.ensureSettings(guildId);
      const next = await deps.repo.applyDelta(guildId, targetId, Math.abs(amount), 'admin grant', settings.startingBalance);
      return `Granted ${fmt(Math.abs(amount), settings)} to <@${targetId}> (new balance ${fmt(next, settings)}).`;
    },

    async take(guildExternalId: string, targetId: string, amount: number): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      const settings = await deps.repo.ensureSettings(guildId);
      const next = await deps.repo.applyDelta(guildId, targetId, -Math.abs(amount), 'admin take', settings.startingBalance);
      return `Took ${fmt(Math.abs(amount), settings)} from <@${targetId}> (new balance ${fmt(next, settings)}).`;
    },

    async setConfig(guildExternalId: string, patch: EconomyConfigInput): Promise<void> {
      const guildId = await resolveGuildId(guildExternalId);
      await deps.repo.setConfig(guildId, patch);
    },

    async addShopItem(guildExternalId: string, roleId: string, label: string, price: number): Promise<string> {
      if (!Number.isInteger(price) || price <= 0) throw new UserFacingError('NOT_FOUND', 'Price must be a positive whole number.');
      const guildId = await resolveGuildId(guildExternalId);
      const item = await deps.repo.addItem(guildId, roleId, truncate(label, 80), price);
      return `Added shop item \`${item.id.slice(0, 8)}\` (<@&${roleId}>) for ${price}.`;
    },

    async removeShopItem(guildExternalId: string, shortId: string): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      const item = await deps.repo.findItemByShortId(guildId, shortId.trim());
      if (!item) throw new UserFacingError('NOT_FOUND', 'No shop item matches that id.');
      await deps.repo.deactivateItem(item.id);
      return 'Shop item removed.';
    },

    async handleInteraction(event: ComponentInteractionEvent): Promise<void> {
      if (!event.guild) return;
      let msg: OutgoingMessage | null = null;
      if (event.customId.startsWith('eco:baltop:')) {
        msg = await baltopPage(event.guild.externalId, Number.parseInt(event.customId.split(':')[2] ?? '0', 10) || 0);
      } else if (event.customId.startsWith('eco:shop:')) {
        msg = await shopPage(event.guild.externalId, Number.parseInt(event.customId.split(':')[2] ?? '0', 10) || 0);
      }
      if (!msg) return;
      if (event.update) await event.update(msg);
      else await event.reply('Updated.');
    },
  };
}

export type EconomyService = ReturnType<typeof createEconomyService>;
