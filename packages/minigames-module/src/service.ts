import type {
  ComponentInteractionEvent,
  GuildServiceProvider,
  MessageButton,
  OutgoingMessage,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import { applyTttMove, emptyTtt, isValidTttMove, renderTtt, tttDraw, tttWinner } from './ttt.js';
import { c4Draw, c4Winner, dropC4, emptyC4, renderC4 } from './connect4.js';
import type { MinigameRepo, MinigameRow } from './repo.js';

export type GameKind = 'ttt' | 'c4';

const PENDING_MAX_AGE_SEC = 300; // 5 min to accept
const ACTIVE_IDLE_SEC = 900; // 15 min idle
const MAX_ACTIVE_PER_USER = 3;

export interface MinigamesServiceDeps {
  repo: MinigameRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  logger: Logger;
  adapterKey: string;
}

function title(game: string): string {
  return game === 'ttt' ? '❌⭕ Tic-Tac-Toe' : '🔴🟡 Connect Four';
}
function renderBoard(game: string, board: number[]): string {
  return game === 'ttt' ? renderTtt(board) : renderC4(board);
}
function markEmoji(game: string, turn: string): string {
  if (game === 'ttt') return turn === 'X' ? '❌' : '⭕';
  return turn === 'X' ? '🔴' : '🟡';
}
function currentPlayerId(round: MinigameRow): string {
  return round.turn === 'X' ? round.playerX : round.playerO;
}
function moveButtons(round: MinigameRow): MessageButton[] {
  if (round.game === 'ttt') {
    return Array.from({ length: 9 }, (_, i) => ({
      customId: `mg:ttt:${round.id}:${i}`,
      label: String(i + 1),
      style: 'secondary' as const,
    }));
  }
  return Array.from({ length: 7 }, (_, i) => ({
    customId: `mg:c4:${round.id}:${i}`,
    label: String(i + 1),
    style: 'primary' as const,
  }));
}

function buildPending(round: MinigameRow): OutgoingMessage {
  return {
    embed: {
      title: `${title(round.game)} — Challenge`,
      description: `<@${round.playerX}> challenges <@${round.playerO}>!\n\n<@${round.playerO}>, do you accept?`,
      color: 0x5865f2,
    },
    buttons: [
      { customId: `mg:accept:${round.id}`, label: 'Accept', style: 'success', emoji: '✅' },
      { customId: `mg:decline:${round.id}`, label: 'Decline', style: 'danger', emoji: '✖️' },
    ],
    allowMentions: { everyone: false, roles: [], users: [round.playerO] },
  };
}

function buildBoard(round: MinigameRow): OutgoingMessage {
  const cur = currentPlayerId(round);
  return {
    embed: {
      title: title(round.game),
      description: `${renderBoard(round.game, round.board)}\n\n${markEmoji(round.game, round.turn)} <@${cur}>'s turn`,
      color: 0x5865f2,
    },
    buttons: moveButtons(round),
    allowMentions: { everyone: false, roles: [], users: [] },
  };
}

function buildResult(round: MinigameRow): OutgoingMessage {
  let outcome: string;
  if (round.winner === 'draw') outcome = '🤝 It’s a draw!';
  else if (round.winner === 'X') outcome = `🏆 <@${round.playerX}> wins!`;
  else if (round.winner === 'O') outcome = `🏆 <@${round.playerO}> wins!`;
  else outcome = 'Game ended.';
  return {
    embed: {
      title: `${title(round.game)} — Finished`,
      description: `${renderBoard(round.game, round.board)}\n\n${outcome}`,
      color: 0x57f287,
    },
    allowMentions: { everyone: false, roles: [], users: [] },
  };
}

export function createMinigamesService(deps: MinigamesServiceDeps) {
  async function challenge(
    game: GameKind,
    guildExternalId: string,
    channelId: string,
    challengerId: string,
    opponentId: string
  ): Promise<MinigameRow> {
    if (opponentId === challengerId) {
      throw new UserFacingError('NOT_FOUND', 'You cannot challenge yourself.');
    }
    const svc = deps.guildServiceProvider.forGuild(guildExternalId);
    if (!svc) throw new UserFacingError('ADAPTER_ERROR', 'The bot is not connected right now.');
    const guild = await deps.guilds.upsertByExternalId({ adapterKey: deps.adapterKey, externalId: guildExternalId });
    if ((await deps.repo.countActiveForUser(guild.id, challengerId)) >= MAX_ACTIVE_PER_USER) {
      throw new UserFacingError('NOT_FOUND', `You already have ${MAX_ACTIVE_PER_USER} games in progress.`);
    }
    const board = game === 'ttt' ? emptyTtt() : emptyC4();
    const round = await deps.repo.create({
      guildId: guild.id,
      channelId,
      game,
      playerX: challengerId,
      playerO: opponentId,
      board,
      turn: 'X',
      status: 'pending',
    });
    const sent = await svc.sendMessage(channelId, buildPending(round));
    await deps.repo.setMessageId(round.id, sent.messageId);
    return round;
  }

  async function handleInteraction(event: ComponentInteractionEvent): Promise<void> {
    if (!event.customId.startsWith('mg:')) return;
    const parts = event.customId.split(':');
    const sub = parts[1];
    const id = parts[2] ?? '';
    const round = await deps.repo.getById(id);
    if (!round) {
      await event.reply('That game no longer exists.');
      return;
    }
    const userId = event.user.externalId;

    if (sub === 'accept' || sub === 'decline') {
      if (round.status !== 'pending') {
        await event.reply('This challenge is no longer pending.');
        return;
      }
      if (userId !== round.playerO) {
        await event.reply('Only the challenged player can respond.');
        return;
      }
      if (sub === 'decline') {
        await deps.repo.updateState(id, { status: 'finished', winner: null });
        const msg: OutgoingMessage = {
          embed: { title: `${title(round.game)} — Declined`, description: `<@${round.playerO}> declined the challenge.`, color: 0x99aab5 },
          allowMentions: { everyone: false, roles: [], users: [] },
        };
        if (event.update) await event.update(msg);
        else await event.reply('Declined.');
        return;
      }
      await deps.repo.updateState(id, { status: 'active' });
      const active = { ...round, status: 'active' };
      if (event.update) await event.update(buildBoard(active));
      else await event.reply('Game on!');
      return;
    }

    if (sub === 'ttt' || sub === 'c4') {
      if (round.status !== 'active') {
        await event.reply('This game is over.');
        return;
      }
      if (userId !== currentPlayerId(round)) {
        await event.reply(
          userId === round.playerX || userId === round.playerO ? "It's not your turn." : "This isn't your game."
        );
        return;
      }
      const n = Number.parseInt(parts[3] ?? '', 10);
      const mark: 1 | 2 = round.turn === 'X' ? 1 : 2;
      let nextBoard: number[];
      if (round.game === 'ttt') {
        if (!isValidTttMove(round.board, n)) {
          await event.reply('That square is already taken.');
          return;
        }
        nextBoard = applyTttMove(round.board, n, mark);
      } else {
        const dropped = dropC4(round.board, n, mark);
        if (!dropped) {
          await event.reply('That column is full.');
          return;
        }
        nextBoard = dropped.board;
      }
      const winner = round.game === 'ttt' ? tttWinner(nextBoard) : c4Winner(nextBoard);
      const draw = round.game === 'ttt' ? tttDraw(nextBoard) : c4Draw(nextBoard);
      if (winner !== 0) {
        await deps.repo.updateState(id, { board: nextBoard, status: 'finished', winner: round.turn });
        const finished = { ...round, board: nextBoard, status: 'finished', winner: round.turn };
        if (event.update) await event.update(buildResult(finished));
        else await event.reply('You win!');
        return;
      }
      if (draw) {
        await deps.repo.updateState(id, { board: nextBoard, status: 'finished', winner: 'draw' });
        const finished = { ...round, board: nextBoard, status: 'finished', winner: 'draw' };
        if (event.update) await event.update(buildResult(finished));
        else await event.reply("It's a draw!");
        return;
      }
      const nextTurn = round.turn === 'X' ? 'O' : 'X';
      await deps.repo.updateState(id, { board: nextBoard, turn: nextTurn });
      const next = { ...round, board: nextBoard, turn: nextTurn };
      if (event.update) await event.update(buildBoard(next));
      else await event.reply('Move played.');
    }
  }

  async function expireStale(now: Date): Promise<number> {
    const pendingCutoff = new Date(now.getTime() - PENDING_MAX_AGE_SEC * 1000);
    const activeCutoff = new Date(now.getTime() - ACTIVE_IDLE_SEC * 1000);
    const rows = await deps.repo.listExpired(pendingCutoff, activeCutoff);
    let expired = 0;
    for (const round of rows) {
      await deps.repo.updateState(round.id, { status: 'expired' });
      expired++;
      if (!round.messageId) continue;
      const guild = await deps.guilds.getById(round.guildId).catch(() => undefined);
      const svc = guild ? deps.guildServiceProvider.forGuild(guild.externalId) : null;
      if (svc) {
        await svc
          .editMessage(round.channelId, round.messageId, {
            embed: { title: `${title(round.game)} — Expired`, description: 'This game timed out.', color: 0x99aab5 },
            allowMentions: { everyone: false, roles: [], users: [] },
          })
          .catch((error) => deps.logger.warn({ err: error }, 'minigame expire edit failed'));
      }
    }
    return expired;
  }

  return { challenge, handleInteraction, expireStale };
}

export type MinigamesService = ReturnType<typeof createMinigamesService>;
