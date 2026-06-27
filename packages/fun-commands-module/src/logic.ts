/**
 * Pure logic for the fun-commands module. No Discord, no IO — everything here is
 * deterministic given an injected `rng`, so it is fully unit-testable.
 */

export type Rng = () => number;
const defaultRng: Rng = Math.random;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Pick a random element. Caller guarantees a non-empty array. */
export function pick<T>(arr: readonly T[], rng: Rng = defaultRng): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// --------------------------------------------------------------------------
// Magic 8-ball
// --------------------------------------------------------------------------

export const EIGHTBALL_ANSWERS = [
  'It is certain.',
  'Without a doubt.',
  'Yes — definitely.',
  'You may rely on it.',
  'Most likely.',
  'Outlook good.',
  'Signs point to yes.',
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  "Don't count on it.",
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.',
] as const;

export function eightBall(rng: Rng = defaultRng): string {
  return pick(EIGHTBALL_ANSWERS, rng);
}

// --------------------------------------------------------------------------
// Coin flip
// --------------------------------------------------------------------------

export function flip(rng: Rng = defaultRng): 'Heads' | 'Tails' {
  return rng() < 0.5 ? 'Heads' : 'Tails';
}

// --------------------------------------------------------------------------
// Dice
// --------------------------------------------------------------------------

export interface DiceSpec {
  count: number;
  sides: number;
  modifier: number;
}

export interface DiceResult {
  spec: DiceSpec;
  rolls: number[];
  total: number;
  /** True when the requested values were clamped to safe limits. */
  clamped: boolean;
}

export const DICE_LIMITS = { maxCount: 100, minSides: 2, maxSides: 1000, maxModifier: 100000 };

const DICE_RE = /^\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i;

/** Parse `NdM`, `NdM+K`, `dM`, or empty (→ default 1d6). Returns null if invalid. */
export function parseDice(input: string | undefined): DiceSpec | null {
  const raw = (input ?? '').trim();
  if (raw === '') return { count: 1, sides: 6, modifier: 0 };
  const m = DICE_RE.exec(raw);
  if (!m) return null;
  const count = m[1] === '' ? 1 : Number.parseInt(m[1]!, 10);
  const sides = Number.parseInt(m[2]!, 10);
  const modifier = m[3] ? Number.parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
  if (!Number.isFinite(count) || !Number.isFinite(sides)) return null;
  return { count, sides, modifier };
}

export function rollDice(spec: DiceSpec, rng: Rng = defaultRng): DiceResult {
  const count = clamp(spec.count, 1, DICE_LIMITS.maxCount);
  const sides = clamp(spec.sides, DICE_LIMITS.minSides, DICE_LIMITS.maxSides);
  const modifier = clamp(spec.modifier, -DICE_LIMITS.maxModifier, DICE_LIMITS.maxModifier);
  const clamped = count !== spec.count || sides !== spec.sides || modifier !== spec.modifier;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(rng() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return { spec: { count, sides, modifier }, rolls, total, clamped };
}

// --------------------------------------------------------------------------
// Chooser
// --------------------------------------------------------------------------

export const MAX_CHOICES = 20;

export function parseChoices(input: string): string[] {
  return input
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_CHOICES);
}

export function choose(options: string[], rng: Rng = defaultRng): string {
  return pick(options, rng);
}

// --------------------------------------------------------------------------
// Rock-paper-scissors
// --------------------------------------------------------------------------

export type RpsMove = 'rock' | 'paper' | 'scissors';
export const RPS_MOVES: readonly RpsMove[] = ['rock', 'paper', 'scissors'];
export const RPS_EMOJI: Record<RpsMove, string> = { rock: '🪨', paper: '📄', scissors: '✂️' };

export function parseRpsMove(input: string | undefined): RpsMove | null {
  const v = (input ?? '').trim().toLowerCase();
  if (v === 'r' || v === 'rock') return 'rock';
  if (v === 'p' || v === 'paper') return 'paper';
  if (v === 's' || v === 'scissors') return 'scissors';
  return null;
}

export function rpsOutcome(user: RpsMove, bot: RpsMove): 'win' | 'lose' | 'draw' {
  if (user === bot) return 'draw';
  const beats: Record<RpsMove, RpsMove> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  return beats[user] === bot ? 'win' : 'lose';
}

// --------------------------------------------------------------------------
// In-memory per-user cooldown (anti-spam)
// --------------------------------------------------------------------------

export interface CooldownStore {
  last: Map<string, number>;
}

export function createCooldownStore(): CooldownStore {
  return { last: new Map<string, number>() };
}

/**
 * Records a hit. Returns ok=false (with remaining ms) when the key is still on
 * cooldown. Mutates the store.
 */
export function hitCooldown(
  store: CooldownStore,
  key: string,
  windowMs: number,
  nowMs: number
): { ok: boolean; retryAfterMs: number } {
  const prev = store.last.get(key);
  if (prev !== undefined && nowMs - prev < windowMs) {
    return { ok: false, retryAfterMs: windowMs - (nowMs - prev) };
  }
  store.last.set(key, nowMs);
  return { ok: true, retryAfterMs: 0 };
}
