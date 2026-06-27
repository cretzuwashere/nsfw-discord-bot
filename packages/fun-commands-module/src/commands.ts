import type { CommandContext, CommandDefinition } from '@botplatform/core';
import { truncate } from '@botplatform/shared';
import {
  choose,
  createCooldownStore,
  eightBall,
  flip,
  hitCooldown,
  parseChoices,
  parseDice,
  parseRpsMove,
  pick,
  rollDice,
  RPS_EMOJI,
  RPS_MOVES,
  rpsOutcome,
  type Rng,
} from './logic.js';

export interface FunCommandsDeps {
  /** Injectable RNG (deterministic in tests). Defaults to Math.random. */
  rng?: Rng;
  /** Per-user per-command cooldown window in ms. Default 3000. */
  cooldownMs?: number;
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
}

function fmtModifier(mod: number): string {
  if (mod === 0) return '';
  return mod > 0 ? `+${mod}` : `${mod}`;
}

export function buildFunCommands(deps: FunCommandsDeps = {}): CommandDefinition[] {
  const rng = deps.rng ?? Math.random;
  const cooldownMs = deps.cooldownMs ?? 3000;
  const now = deps.now ?? (() => Date.now());
  const cooldown = createCooldownStore();

  /** Returns true when the caller may proceed; replies + returns false if rate-limited. */
  async function allow(ctx: CommandContext, name: string): Promise<boolean> {
    const r = hitCooldown(cooldown, `${ctx.user.id}:${name}`, cooldownMs, now());
    if (!r.ok) {
      await ctx.reply({
        content: `Slow down — try again in ${Math.ceil(r.retryAfterMs / 1000)}s.`,
        ephemeral: true,
      });
      return false;
    }
    return true;
  }

  const eightballCmd: CommandDefinition = {
    name: '8ball',
    description: 'Ask the magic 8-ball a yes/no question',
    options: [{ name: 'question', description: 'Your question', type: 'string', required: true }],
    async execute(ctx) {
      if (!(await allow(ctx, '8ball'))) return;
      const q = truncate(String(ctx.options['question'] ?? '').trim(), 200);
      await ctx.reply(`🎱 **Q:** ${q || '(no question)'}\n**A:** ${eightBall(rng)}`);
    },
  };

  const rollCmd: CommandDefinition = {
    name: 'roll',
    description: 'Roll dice, e.g. 1d20 or 2d6+3 (default 1d6)',
    options: [{ name: 'dice', description: 'Dice notation like 1d20 or 2d6+3', type: 'string' }],
    async execute(ctx) {
      if (!(await allow(ctx, 'roll'))) return;
      const input = ctx.options['dice'] === undefined ? undefined : String(ctx.options['dice']);
      const spec = parseDice(input);
      if (!spec) {
        await ctx.reply({
          content: 'I could not read that. Try `1d20`, `2d6+3` or `d100`.',
          ephemeral: true,
        });
        return;
      }
      const res = rollDice(spec, rng);
      const label = `${res.spec.count}d${res.spec.sides}${fmtModifier(res.spec.modifier)}`;
      const detail = res.rolls.length <= 20 ? ` _(${res.rolls.join(', ')})_` : '';
      const note = res.clamped ? '\n*(clamped to safe limits)*' : '';
      await ctx.reply(`🎲 \`${label}\` → **${res.total}**${detail}${note}`);
    },
  };

  const flipCmd: CommandDefinition = {
    name: 'flip',
    description: 'Flip a coin',
    async execute(ctx) {
      if (!(await allow(ctx, 'flip'))) return;
      await ctx.reply(`🪙 **${flip(rng)}**`);
    },
  };

  const chooseCmd: CommandDefinition = {
    name: 'choose',
    description: 'Let the bot pick one of your options',
    options: [
      {
        name: 'options',
        description: 'Options separated by commas, e.g. pizza, sushi, tacos',
        type: 'string',
        required: true,
      },
    ],
    async execute(ctx) {
      if (!(await allow(ctx, 'choose'))) return;
      const opts = parseChoices(String(ctx.options['options'] ?? ''));
      if (opts.length < 2) {
        await ctx.reply({
          content: 'Give me at least two options separated by commas.',
          ephemeral: true,
        });
        return;
      }
      await ctx.reply(`🤔 I choose: **${truncate(choose(opts, rng), 200)}**`);
    },
  };

  const rpsCmd: CommandDefinition = {
    name: 'rps',
    description: 'Play rock-paper-scissors against the bot',
    options: [
      { name: 'move', description: 'rock, paper or scissors', type: 'string', required: true },
    ],
    async execute(ctx) {
      if (!(await allow(ctx, 'rps'))) return;
      const move = parseRpsMove(String(ctx.options['move'] ?? ''));
      if (!move) {
        await ctx.reply({ content: 'Choose `rock`, `paper` or `scissors`.', ephemeral: true });
        return;
      }
      const botMove = pick(RPS_MOVES, rng);
      const outcome = rpsOutcome(move, botMove);
      const verdict =
        outcome === 'win' ? 'You win! 🎉' : outcome === 'lose' ? 'You lose! 😈' : "It's a draw! 🤝";
      await ctx.reply(
        `You: ${RPS_EMOJI[move]} ${move}\nMe: ${RPS_EMOJI[botMove]} ${botMove}\n**${verdict}**`
      );
    },
  };

  return [eightballCmd, rollCmd, flipCmd, chooseCmd, rpsCmd];
}
