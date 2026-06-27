import { describe, expect, it } from 'vitest';
import { clampDuration, clampWinners, drawWinners, parseDuration } from './logic.js';

const rng = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

describe('parseDuration', () => {
  it('parses single units', () => {
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('10m')).toBe(600);
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('1d')).toBe(86400);
    expect(parseDuration('1w')).toBe(604800);
  });
  it('parses combos', () => {
    expect(parseDuration('1d 6h')).toBe(86400 + 6 * 3600);
    expect(parseDuration('1h30m')).toBe(3600 + 1800);
  });
  it('rejects junk', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});

describe('clampWinners / clampDuration', () => {
  it('clamps winners 1..20', () => {
    expect(clampWinners(0)).toBe(1);
    expect(clampWinners(50)).toBe(20);
    expect(clampWinners(3)).toBe(3);
    expect(clampWinners(NaN)).toBe(1);
  });
  it('clamps duration to min/max', () => {
    expect(clampDuration(1)).toBe(10);
    expect(clampDuration(99 * 24 * 3600)).toBe(30 * 24 * 3600);
  });
});

describe('drawWinners', () => {
  it('returns the requested count without duplicates', () => {
    const winners = drawWinners(['a', 'b', 'c', 'd'], 2, rng([0, 0]));
    expect(winners).toHaveLength(2);
    expect(new Set(winners).size).toBe(2);
  });
  it('returns all entrants when count exceeds entrants', () => {
    const winners = drawWinners(['a', 'b'], 5, rng([0.5, 0.5]));
    expect(new Set(winners)).toEqual(new Set(['a', 'b']));
  });
  it('returns empty for no entrants', () => {
    expect(drawWinners([], 3, rng([0]))).toEqual([]);
  });
  it('is deterministic given rng', () => {
    const a = drawWinners(['a', 'b', 'c'], 2, rng([0.99, 0.0]));
    const b = drawWinners(['a', 'b', 'c'], 2, rng([0.99, 0.0]));
    expect(a).toEqual(b);
  });
});
