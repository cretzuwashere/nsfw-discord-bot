import { createSilentLogger } from '@botplatform/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scheduler } from './scheduler.js';

describe('Scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs registered jobs on their interval', async () => {
    const scheduler = new Scheduler(createSilentLogger());
    const run = vi.fn(async () => {});
    scheduler.register({ name: 'tick', intervalMs: 1000, run });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(3500);
    expect(run).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('rejects duplicate job names', () => {
    const scheduler = new Scheduler(createSilentLogger());
    scheduler.register({ name: 'dup', intervalMs: 1000, run: async () => {} });
    expect(() => scheduler.register({ name: 'dup', intervalMs: 1000, run: async () => {} })).toThrow(
      /twice/
    );
  });

  it('keeps ticking when a job throws', async () => {
    const scheduler = new Scheduler(createSilentLogger());
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    scheduler.register({ name: 'flaky', intervalMs: 1000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(run).toHaveBeenCalledTimes(2); // second tick still fired
    scheduler.stop();
  });

  it('runNow executes a single job immediately', async () => {
    const scheduler = new Scheduler(createSilentLogger());
    const run = vi.fn(async () => {});
    scheduler.register({ name: 'manual', intervalMs: 60_000, run });
    await scheduler.runNow('manual');
    expect(run).toHaveBeenCalledOnce();
  });

  it('stop() halts further ticks', async () => {
    const scheduler = new Scheduler(createSilentLogger());
    const run = vi.fn(async () => {});
    scheduler.register({ name: 'tick', intervalMs: 1000, run });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1500);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
