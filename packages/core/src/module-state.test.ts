import { createSilentLogger } from '@botplatform/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedModuleState } from './module-state.js';

describe('CachedModuleState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches lookups for the TTL window', async () => {
    const inner = { isEnabled: vi.fn(async () => true) };
    const state = new CachedModuleState(inner, createSilentLogger(), 10_000);

    await state.isEnabled('audio-player');
    await state.isEnabled('audio-player');
    expect(inner.isEnabled).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(11_000);
    await state.isEnabled('audio-player');
    expect(inner.isEnabled).toHaveBeenCalledTimes(2);
  });

  it('falls back to last known value when the lookup fails', async () => {
    const inner = { isEnabled: vi.fn(async () => false) };
    const state = new CachedModuleState(inner, createSilentLogger(), 1_000);

    expect(await state.isEnabled('moderation')).toBe(false);
    vi.advanceTimersByTime(2_000);
    inner.isEnabled.mockRejectedValueOnce(new Error('db down'));
    expect(await state.isEnabled('moderation')).toBe(false);
  });

  it('defaults to enabled when there is no cached value and lookup fails', async () => {
    const inner = { isEnabled: vi.fn(async (): Promise<boolean> => { throw new Error('db down'); }) };
    const state = new CachedModuleState(inner, createSilentLogger());
    expect(await state.isEnabled('audio-player')).toBe(true);
  });

  it('invalidate() forces a fresh lookup', async () => {
    const inner = { isEnabled: vi.fn(async () => true) };
    const state = new CachedModuleState(inner, createSilentLogger(), 60_000);
    await state.isEnabled('audio-player');
    state.invalidate('audio-player');
    await state.isEnabled('audio-player');
    expect(inner.isEnabled).toHaveBeenCalledTimes(2);
  });
});
