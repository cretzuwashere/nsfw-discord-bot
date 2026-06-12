import type { Logger } from '@botplatform/logger';
import type { ModuleStatePort } from './contracts/ports.js';

/**
 * TTL cache around a ModuleStatePort so command dispatch doesn't hit the
 * database on every invocation. On lookup failure the last known value is
 * used (default: enabled) — a database hiccup must not silence the bot.
 */
export class CachedModuleState implements ModuleStatePort {
  private readonly cache = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(
    private readonly inner: ModuleStatePort,
    private readonly logger: Logger,
    private readonly ttlMs = 10_000
  ) {}

  async isEnabled(moduleKey: string): Promise<boolean> {
    const cached = this.cache.get(moduleKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    try {
      const value = await this.inner.isEnabled(moduleKey);
      this.cache.set(moduleKey, { value, expiresAt: now + this.ttlMs });
      return value;
    } catch (error) {
      this.logger.warn({ err: error, moduleKey }, 'module state lookup failed; using fallback');
      return cached?.value ?? true;
    }
  }

  invalidate(moduleKey?: string): void {
    if (moduleKey) this.cache.delete(moduleKey);
    else this.cache.clear();
  }
}
