import type { CommandContext, CommandDefinition } from '@botplatform/core';
import { toSafeUserMessage } from '@botplatform/shared';
import type { EconomyConfigInput } from './repo.js';
import type { EconomyService } from './service.js';

export interface EconomyCommandDeps {
  service: EconomyService;
}

async function richReply(ctx: CommandContext, message: Awaited<ReturnType<EconomyService['balance']>>): Promise<void> {
  if (ctx.replyRich) await ctx.replyRich(message);
  else await ctx.reply(`**${message.embed?.title ?? ''}**\n${message.embed?.description ?? ''}`);
}

export function buildEconomyCommands(deps: EconomyCommandDeps): CommandDefinition[] {
  const { service } = deps;

  const balance: CommandDefinition = {
    name: 'balance',
    description: 'Check a currency balance',
    guildOnly: true,
    options: [{ name: 'user', description: 'Whose balance (default: you)', type: 'user' }],
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      const target = ctx.options['user'] !== undefined ? String(ctx.options['user']) : ctx.user.id;
      await ctx.defer();
      await richReply(ctx, await service.balance(ctx.guildId, target));
    },
  };

  const give: CommandDefinition = {
    name: 'give',
    description: 'Give some of your currency to another member',
    guildOnly: true,
    options: [
      { name: 'user', description: 'Who to give to', type: 'user', required: true },
      { name: 'amount', description: 'How much', type: 'integer', required: true },
    ],
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      await ctx.defer();
      try {
        const msg = await service.give(ctx.guildId, ctx.user.id, String(ctx.options['user'] ?? ''), Number(ctx.options['amount'] ?? 0));
        await ctx.reply(msg);
      } catch (error) {
        await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
      }
    },
  };

  const daily: CommandDefinition = {
    name: 'daily',
    description: 'Claim your daily reward',
    guildOnly: true,
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      await ctx.defer();
      await ctx.reply(await service.daily(ctx.guildId, ctx.user.id));
    },
  };

  const baltop: CommandDefinition = {
    name: 'baltop',
    description: 'Show the richest members',
    guildOnly: true,
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      await ctx.defer();
      await richReply(ctx, await service.baltopPage(ctx.guildId, 0));
    },
  };

  const shop: CommandDefinition = {
    name: 'shop',
    description: 'Browse the role/perk shop',
    guildOnly: true,
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      await ctx.defer();
      await richReply(ctx, await service.shopPage(ctx.guildId, 0));
    },
  };

  const buy: CommandDefinition = {
    name: 'buy',
    description: 'Buy an item from the shop',
    guildOnly: true,
    options: [{ name: 'item', description: 'Item id (from /shop)', type: 'string', required: true }],
    async execute(ctx) {
      if (!ctx.guildId) return void ctx.reply({ content: 'Use this in a server.', ephemeral: true });
      await ctx.defer();
      try {
        await ctx.reply(await service.buy(ctx.guildId, ctx.user.id, String(ctx.options['item'] ?? '')));
      } catch (error) {
        await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
      }
    },
  };

  const economyAdmin: CommandDefinition = {
    name: 'economy',
    description: 'Economy administration',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    subcommands: [
      {
        name: 'grant',
        description: 'Grant currency to a member',
        options: [
          { name: 'user', description: 'Recipient', type: 'user', required: true },
          { name: 'amount', description: 'Amount', type: 'integer', required: true },
        ],
        async execute(ctx) {
          await ctx.reply({ content: await service.grant(ctx.guildId!, String(ctx.options['user'] ?? ''), Number(ctx.options['amount'] ?? 0)), ephemeral: true });
        },
      },
      {
        name: 'take',
        description: 'Take currency from a member',
        options: [
          { name: 'user', description: 'Target', type: 'user', required: true },
          { name: 'amount', description: 'Amount', type: 'integer', required: true },
        ],
        async execute(ctx) {
          await ctx.reply({ content: await service.take(ctx.guildId!, String(ctx.options['user'] ?? ''), Number(ctx.options['amount'] ?? 0)), ephemeral: true });
        },
      },
      {
        name: 'config',
        description: 'Configure currency name, emoji and daily reward',
        options: [
          { name: 'name', description: 'Currency name', type: 'string' },
          { name: 'emoji', description: 'Currency emoji', type: 'string' },
          { name: 'starting', description: 'Starting balance', type: 'integer' },
          { name: 'daily', description: 'Base daily amount', type: 'integer' },
          { name: 'bonus', description: 'Per-streak-day bonus', type: 'integer' },
          { name: 'cap', description: 'Max streak counted for bonus', type: 'integer' },
        ],
        async execute(ctx) {
          const patch: EconomyConfigInput = {};
          if (ctx.options['name'] !== undefined) patch.currencyName = String(ctx.options['name']);
          if (ctx.options['emoji'] !== undefined) patch.currencyEmoji = String(ctx.options['emoji']);
          if (ctx.options['starting'] !== undefined) patch.startingBalance = Math.max(0, Number(ctx.options['starting']));
          if (ctx.options['daily'] !== undefined) patch.dailyAmount = Math.max(0, Number(ctx.options['daily']));
          if (ctx.options['bonus'] !== undefined) patch.dailyStreakBonus = Math.max(0, Number(ctx.options['bonus']));
          if (ctx.options['cap'] !== undefined) patch.dailyStreakCap = Math.max(1, Number(ctx.options['cap']));
          await service.setConfig(ctx.guildId!, patch);
          await ctx.reply({ content: 'Economy settings updated.', ephemeral: true });
        },
      },
    ],
  };

  const shopAdmin: CommandDefinition = {
    name: 'shopadmin',
    description: 'Manage the shop catalog',
    guildOnly: true,
    defaultMemberPermissions: ['ManageGuild'],
    subcommands: [
      {
        name: 'add',
        description: 'Add a purchasable role',
        options: [
          { name: 'role', description: 'Role to sell', type: 'role', required: true },
          { name: 'price', description: 'Price', type: 'integer', required: true },
          { name: 'label', description: 'Display label', type: 'string' },
        ],
        async execute(ctx) {
          try {
            const msg = await service.addShopItem(
              ctx.guildId!,
              String(ctx.options['role'] ?? ''),
              String(ctx.options['label'] ?? ''),
              Number(ctx.options['price'] ?? 0)
            );
            await ctx.reply({ content: msg, ephemeral: true });
          } catch (error) {
            await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
          }
        },
      },
      {
        name: 'remove',
        description: 'Remove a shop item',
        options: [{ name: 'item', description: 'Item id (from /shop)', type: 'string', required: true }],
        async execute(ctx) {
          try {
            await ctx.reply({ content: await service.removeShopItem(ctx.guildId!, String(ctx.options['item'] ?? '')), ephemeral: true });
          } catch (error) {
            await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
          }
        },
      },
    ],
  };

  return [balance, give, daily, baltop, shop, buy, economyAdmin, shopAdmin];
}
