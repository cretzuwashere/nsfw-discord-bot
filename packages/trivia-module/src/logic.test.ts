import { describe, expect, it } from 'vitest';
import { ANSWER_LETTERS, getQuestion, TRIVIA_BANK } from './bank.js';
import { clampInterval, isAutoDue, isRoundExpired, pickQuestionIndex } from './logic.js';

const rng = (v: number) => () => v;

describe('bank', () => {
  it('every question has 4 options and an in-range correct index', () => {
    for (const q of TRIVIA_BANK) {
      expect(q.options).toHaveLength(4);
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThanOrEqual(3);
    }
    expect(TRIVIA_BANK.length).toBeGreaterThanOrEqual(20);
    expect(ANSWER_LETTERS).toHaveLength(4);
  });
  it('getQuestion is in range and stable', () => {
    expect(getQuestion(0)).toBe(TRIVIA_BANK[0]);
    expect(getQuestion(99999)).toBe(TRIVIA_BANK[0]);
  });
});

describe('pickQuestionIndex', () => {
  it('avoids recent', () => {
    const { index } = pickQuestionIndex(3, [0, 1], rng(0));
    expect(index).toBe(2);
  });
  it('caps recent ring', () => {
    let recent: number[] = [];
    for (let i = 0; i < 50; i++) recent = pickQuestionIndex(40, recent, rng(0.0)).recent;
    expect(recent.length).toBeLessThanOrEqual(20);
  });
});

describe('isRoundExpired', () => {
  it('expires after the timeout', () => {
    const start = new Date('2026-06-27T00:00:00Z');
    expect(isRoundExpired(start, new Date('2026-06-27T00:00:30Z'), 45)).toBe(false);
    expect(isRoundExpired(start, new Date('2026-06-27T00:01:00Z'), 45)).toBe(true);
  });
});

describe('isAutoDue', () => {
  const now = new Date('2026-06-27T12:00:00Z');
  it('is due when never run', () => {
    expect(isAutoDue({ autoEnabled: true, autoChannelId: 'c', autoIntervalMin: 60, lastAutoAt: null }, now)).toBe(true);
  });
  it('respects the interval', () => {
    expect(
      isAutoDue({ autoEnabled: true, autoChannelId: 'c', autoIntervalMin: 60, lastAutoAt: new Date('2026-06-27T11:30:00Z') }, now)
    ).toBe(false);
    expect(
      isAutoDue({ autoEnabled: true, autoChannelId: 'c', autoIntervalMin: 60, lastAutoAt: new Date('2026-06-27T11:00:00Z') }, now)
    ).toBe(true);
  });
  it('off when disabled / no channel', () => {
    expect(isAutoDue({ autoEnabled: false, autoChannelId: 'c', autoIntervalMin: 60, lastAutoAt: null }, now)).toBe(false);
    expect(isAutoDue({ autoEnabled: true, autoChannelId: null, autoIntervalMin: 60, lastAutoAt: null }, now)).toBe(false);
  });
});

describe('clampInterval', () => {
  it('clamps to 5..10080 minutes', () => {
    expect(clampInterval(1)).toBe(5);
    expect(clampInterval(99999)).toBe(10080);
    expect(clampInterval(360)).toBe(360);
  });
});
