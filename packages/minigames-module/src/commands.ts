import type { CommandContext, CommandDefinition } from '@botplatform/core';
import { toSafeUserMessage } from '@botplatform/shared';
import type { GameKind, MinigamesService } from './service.js';

export interface MinigamesCommandDeps {
  service: MinigamesService;
}

export function buildMinigameCommands(deps: MinigamesCommandDeps): CommandDefinition[] {
  async function challengeCmd(ctx: CommandContext, game: GameKind): Promise<void> {
    if (!ctx.guildId || !ctx.channelId) {
      await ctx.reply({ content: 'Use this in a server channel.', ephemeral: true });
      return;
    }
    const opponent = ctx.options['opponent'] !== undefined ? String(ctx.options['opponent']) : '';
    if (!opponent) {
      await ctx.reply({ content: 'You need to pick an opponent.', ephemeral: true });
      return;
    }
    await ctx.defer();
    try {
      await deps.service.challenge(game, ctx.guildId, ctx.channelId, ctx.user.id, opponent);
      await ctx.reply({ content: 'Challenge sent! 🎮', ephemeral: true });
    } catch (error) {
      await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
    }
  }

  const ttt: CommandDefinition = {
    name: 'tictactoe',
    description: 'Challenge someone to Tic-Tac-Toe',
    guildOnly: true,
    options: [{ name: 'opponent', description: 'Who to play against', type: 'user', required: true }],
    async execute(ctx) {
      await challengeCmd(ctx, 'ttt');
    },
  };

  const c4: CommandDefinition = {
    name: 'connect4',
    description: 'Challenge someone to Connect Four',
    guildOnly: true,
    options: [{ name: 'opponent', description: 'Who to play against', type: 'user', required: true }],
    async execute(ctx) {
      await challengeCmd(ctx, 'c4');
    },
  };

  return [ttt, c4];
}
