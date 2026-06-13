import { loadConfig, testEnv } from '@botplatform/config';
import { createSilentLogger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { describe, expect, it } from 'vitest';
import { createModerationModule } from './index.js';

describe('createModerationModule', () => {
  it('exposes the module contract with no commands in v1', () => {
    const handle = createModerationModule({
      config: loadConfig(testEnv()),
      logger: createSilentLogger(),
      db: null,
    });

    expect(handle.module.key).toBe(MODULE_KEYS.moderation);
    expect(handle.module.name).toBe('Moderation');
    expect(handle.module.commands).toHaveLength(0);
  });

  it('returns null services without a database (test convenience)', () => {
    const handle = createModerationModule({
      config: loadConfig(testEnv()),
      logger: createSilentLogger(),
      db: null,
    });

    expect(handle.services).toBeNull();
  });

  it('onLoad completes against the module context', async () => {
    const handle = createModerationModule({
      config: loadConfig(testEnv()),
      logger: createSilentLogger(),
      db: null,
    });

    await expect(
      Promise.resolve(
        handle.module.onLoad?.({
          logger: createSilentLogger(),
          config: loadConfig(testEnv()),
          audit: { record: async () => {} },
        })
      )
    ).resolves.toBeUndefined();
  });
});
