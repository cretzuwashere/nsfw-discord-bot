import { describe, expect, it } from 'vitest';
import {
  choose,
  createCooldownStore,
  eightBall,
  EIGHTBALL_ANSWERS,
  flip,
  hitCooldown,
  parseChoices,
  parseDice,
  parseRpsMove,
  rollDice,
  rpsOutcome,
  type Rng,
} from './logic.js';

/** Deterministic rng cycling through the given values. */
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('parseDice', () => {
  it('defaults empty input to 1d6', () => {
    expect(parseDice('')).toEqual({ count: 1, sides: 6, modifier: 0 });
    expect(parseDice(undefined)).toEqual({ count: 1, sides: 6, modifier: 0 });
  });
  it('parses NdM, dM and modifiers', () => {
    expect(parseDice('2d6')).toEqual({ count: 2, sides: 6, modifier: 0 });
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('3d8+5')).toEqual({ count: 3, sides: 8, modifier: 5 });
    expect(parseDice('1d4 - 2')).toEqual({ count: 1, sides: 4, modifier: -2 });
  });
  it('rejects garbage', () => {
    expect(parseDice('hello')).toBeNull();
    expect(parseDice('6')).toBeNull();
    expect(parseDice('d')).toBeNull();
  });
});

describe('rollDice', () => {
  it('rolls within range and sums with modifier', () => {
    const res = rollDice({ count: 2, sides: 6, modifier: 3 }, seq([0, 0.99]));
    expect(res.rolls).toEqual([1, 6]);
    expect(res.total).toBe(1 + 6 + 3);
    expect(res.clamped).toBe(false);
  });
  it('clamps oversized requests', () => {
    const res = rollDice({ count: 99999, sides: 99999, modifier: 0 }, seq([0]));
    expect(res.spec.count).toBe(100);
    expect(res.spec.sides).toBe(1000);
    expect(res.clamped).toBe(true);
    expect(res.rolls).toHaveLength(100);
  });
  it('clamps zero/negative dice up to the minimum', () => {
    const res = rollDice({ count: 0, sides: 1, modifier: 0 }, seq([0.5]));
    expect(res.spec.count).toBe(1);
    expect(res.spec.sides).toBe(2);
    expect(res.clamped).toBe(true);
  });
});

describe('parseChoices / choose', () => {
  it('splits on commas and pipes, trims, drops empties, caps at 20', () => {
    expect(parseChoices('a, b | c ,, ')).toEqual(['a', 'b', 'c']);
    expect(parseChoices(Array.from({ length: 30 }, (_, i) => `x${i}`).join(','))).toHaveLength(20);
  });
  it('chooses deterministically with rng', () => {
    expect(choose(['a', 'b', 'c'], seq([0.5]))).toBe('b');
  });
});

describe('rps', () => {
  it('parses moves and shortcuts', () => {
    expect(parseRpsMove('Rock')).toBe('rock');
    expect(parseRpsMove('p')).toBe('paper');
    expect(parseRpsMove('SCISSORS')).toBe('scissors');
    expect(parseRpsMove('lizard')).toBeNull();
  });
  it('computes outcomes from the player perspective', () => {
    expect(rpsOutcome('rock', 'scissors')).toBe('win');
    expect(rpsOutcome('rock', 'paper')).toBe('lose');
    expect(rpsOutcome('paper', 'paper')).toBe('draw');
    expect(rpsOutcome('scissors', 'paper')).toBe('win');
  });
});

describe('eightBall / flip', () => {
  it('returns a known answer', () => {
    expect(EIGHTBALL_ANSWERS).toContain(eightBall(seq([0])));
  });
  it('flips both faces', () => {
    expect(flip(seq([0]))).toBe('Heads');
    expect(flip(seq([0.99]))).toBe('Tails');
  });
});

describe('hitCooldown', () => {
  it('blocks within the window and allows after it', () => {
    const store = createCooldownStore();
    expect(hitCooldown(store, 'u:cmd', 3000, 1000).ok).toBe(true);
    const blocked = hitCooldown(store, 'u:cmd', 3000, 2000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(2000);
    expect(hitCooldown(store, 'u:cmd', 3000, 4001).ok).toBe(true);
  });
  it('tracks keys independently', () => {
    const store = createCooldownStore();
    expect(hitCooldown(store, 'a', 1000, 0).ok).toBe(true);
    expect(hitCooldown(store, 'b', 1000, 0).ok).toBe(true);
  });
});
