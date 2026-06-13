import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.js';

describe('parseDuration', () => {
  it('parses bare numbers as minutes', () => {
    expect(parseDuration('30')).toBe(30 * 60);
    expect(parseDuration('1')).toBe(60);
  });

  it('parses unit suffixes', () => {
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('1d')).toBe(86400);
    expect(parseDuration('1w')).toBe(604800);
  });

  it('sums multiple components', () => {
    expect(parseDuration('1d 6h')).toBe(86400 + 6 * 3600);
    expect(parseDuration('1h30m')).toBe(3600 + 1800);
  });

  it('enforces a 60-second minimum', () => {
    expect(parseDuration('10s')).toBe(60);
    expect(parseDuration('0')).toBe(60);
  });

  it('caps at one year', () => {
    expect(parseDuration('1000d')).toBe(365 * 86400);
  });

  it('returns null for unparseable input', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
});
