import type {
  ComponentInteractionEvent,
  GuildServiceProvider,
  OutgoingMessage,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import { ANSWER_LETTERS, getQuestion, TRIVIA_BANK, type TriviaQuestion } from './bank.js';
import { isAutoDue, isRoundExpired, pickQuestionIndex, type Rng } from './logic.js';
import type { TriviaAutoConfig, TriviaRepo, TriviaRoundRow } from './repo.js';

const ROUND_TIMEOUT_SEC = 45;

export interface TriviaServiceDeps {
  repo: TriviaRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  logger: Logger;
  adapterKey: string;
  rng?: Rng;
}

function buildQuestion(round: TriviaRoundRow, q: TriviaQuestion): OutgoingMessage {
  const opts = q.options.map((o, i) => `**${ANSWER_LETTERS[i]}.** ${o}`).join('\n');
  return {
    embed: {
      title: `🧠 Trivia — ${q.category}`,
      description: `${q.question}\n\n${opts}`,
      color: 0xfee75c,
      footer: 'First correct answer wins! (45s)',
    },
    buttons: q.options.map((_, i) => ({
      customId: `trivia:ans:${round.id}:${i}`,
      label: ANSWER_LETTERS[i]!,
      style: 'primary',
    })),
    allowMentions: { everyone: false, roles: [], users: [] },
  };
}

function buildResult(q: TriviaQuestion, winner: string | null): OutgoingMessage {
  const reveal = `✅ **${ANSWER_LETTERS[q.correct]}.** ${q.options[q.correct]}`;
  const outcome = winner ? `🏆 Winner: <@${winner}>` : '⏳ Time’s up — nobody got it!';
  return {
    embed: {
      title: `🧠 Trivia — ${q.category}`,
      description: `${q.question}\n\n${reveal}\n\n${outcome}`,
      color: winner ? 0x57f287 : 0x99aab5,
    },
    allowMentions: { everyone: false, roles: [], users: winner ? [winner] : [] },
  };
}

export function createTriviaService(deps: TriviaServiceDeps) {
  const rng = deps.rng ?? Math.random;

  async function startCore(guildId: string, guildExternalId: string, channelId: string): Promise<TriviaRoundRow> {
    const existing = await deps.repo.getOpenRoundInChannel(guildId, channelId);
    if (existing) throw new UserFacingError('NOT_FOUND', 'A trivia round is already running in this channel.');
    const svc = deps.guildServiceProvider.forGuild(guildExternalId);
    if (!svc) throw new UserFacingError('ADAPTER_ERROR', 'The bot is not connected right now — try again shortly.');

    const settings = await deps.repo.ensureSettings(guildId);
    const { index, recent } = pickQuestionIndex(TRIVIA_BANK.length, settings.recent ?? [], rng);
    await deps.repo.setRecent(guildId, recent);
    const q = getQuestion(index);
    const round = await deps.repo.createRound({
      guildId,
      channelId,
      questionIndex: index,
      correctIndex: q.correct,
    });
    const sent = await svc.sendMessage(channelId, buildQuestion(round, q));
    await deps.repo.setMessageId(round.id, sent.messageId);
    return round;
  }

  return {
    async start(guildExternalId: string, channelId: string): Promise<TriviaRoundRow> {
      const guild = await deps.guilds.upsertByExternalId({ adapterKey: deps.adapterKey, externalId: guildExternalId });
      return startCore(guild.id, guildExternalId, channelId);
    },

    async handleAnswer(event: ComponentInteractionEvent): Promise<void> {
      if (!event.customId.startsWith('trivia:ans:')) return;
      const parts = event.customId.split(':');
      const roundId = parts[2] ?? '';
      const choice = Number.parseInt(parts[3] ?? '', 10);
      const round = await deps.repo.getRound(roundId);
      if (!round || round.status !== 'open') {
        await event.reply('This trivia round is already over.');
        return;
      }
      const q = getQuestion(round.questionIndex);
      const correct = choice === round.correctIndex;
      const inserted = await deps.repo.recordAnswer(roundId, event.user.externalId, correct);
      if (!inserted) {
        await event.reply('You already answered this round!');
        return;
      }
      if (!correct) {
        await event.reply('❌ Wrong answer — better luck next time!');
        return;
      }
      const claimed = await deps.repo.resolveIfOpen(roundId, event.user.externalId);
      if (!claimed) {
        await event.reply('Correct — but someone beat you to it! ⚡');
        return;
      }
      await deps.repo.incrementScore(round.guildId, event.user.externalId);
      if (event.update) await event.update(buildResult(q, event.user.externalId));
      else await event.reply('🏆 Correct — you win!');
    },

    /** Scheduler: reveal answers for rounds that timed out with no winner. */
    async resolveExpired(now: Date): Promise<number> {
      const cutoff = new Date(now.getTime() - ROUND_TIMEOUT_SEC * 1000);
      const expired = await deps.repo.listOpenExpired(cutoff);
      let resolved = 0;
      for (const round of expired) {
        if (!isRoundExpired(round.startedAt, now, ROUND_TIMEOUT_SEC)) continue;
        const claimed = await deps.repo.resolveIfOpen(round.id, null);
        if (!claimed) continue;
        resolved++;
        if (!round.messageId) continue;
        const guild = await deps.guilds.getById(round.guildId).catch(() => undefined);
        const svc = guild ? deps.guildServiceProvider.forGuild(guild.externalId) : null;
        if (svc) {
          await svc
            .editMessage(round.channelId, round.messageId, buildResult(getQuestion(round.questionIndex), null))
            .catch((error) => deps.logger.warn({ err: error }, 'trivia reveal edit failed'));
        }
      }
      return resolved;
    },

    /** Scheduler: start auto-trivia rounds where due. */
    async runAutoTrivia(now: Date): Promise<number> {
      const rows = await deps.repo.listAutoEnabled();
      let started = 0;
      for (const s of rows) {
        if (!isAutoDue(s, now)) continue;
        const channelId = s.autoChannelId!;
        const open = await deps.repo.getOpenRoundInChannel(s.guildId, channelId);
        if (open) continue;
        const guild = await deps.guilds.getById(s.guildId).catch(() => undefined);
        if (!guild) continue;
        try {
          await startCore(s.guildId, guild.externalId, channelId);
          await deps.repo.markAuto(s.guildId, now);
          started++;
        } catch (error) {
          deps.logger.warn({ err: error, guildId: s.guildId }, 'auto-trivia start failed');
          await deps.repo.markAuto(s.guildId, now);
        }
      }
      return started;
    },

    async leaderboard(guildExternalId: string): Promise<OutgoingMessage> {
      const guild = await deps.guilds.upsertByExternalId({ adapterKey: deps.adapterKey, externalId: guildExternalId });
      const top = await deps.repo.topScores(guild.id, 10);
      const medals = ['🥇', '🥈', '🥉'];
      const body =
        top.length === 0
          ? '_No trivia wins yet. Start a round with /trivia!_'
          : top.map((t, i) => `${medals[i] ?? `**${i + 1}.**`} <@${t.userExternalId}> — ${t.wins} win(s)`).join('\n');
      return {
        embed: { title: '🧠 Trivia Leaderboard', description: body, color: 0xfee75c },
        allowMentions: { everyone: false, roles: [], users: [] },
      };
    },

    async setConfig(guildExternalId: string, cfg: TriviaAutoConfig): Promise<void> {
      const guild = await deps.guilds.upsertByExternalId({ adapterKey: deps.adapterKey, externalId: guildExternalId });
      await deps.repo.setConfig(guild.id, cfg);
    },
  };
}

export type TriviaService = ReturnType<typeof createTriviaService>;
