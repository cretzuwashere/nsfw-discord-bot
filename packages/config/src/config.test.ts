import { describe, expect, it } from 'vitest';
import { loadConfig, testEnv } from './index.js';

describe('loadConfig', () => {
  it('parses a minimal valid environment with defaults', () => {
    const config = loadConfig(testEnv());
    expect(config.nodeEnv).toBe('test');
    expect(config.logLevel).toBe('info');
    expect(config.admin.port).toBe(3000);
    expect(config.bot.healthPort).toBe(8081);
    expect(config.audio.maxQueueSize).toBe(50);
    expect(config.audio.maxPlaylistItems).toBe(100);
    expect(config.audio.mixDefaultItems).toBe(10);
    expect(config.audio.maxTrackDurationSeconds).toBe(3600);
    expect(config.discord.enabled).toBe(false);
  });

  it('enables discord only when token AND client id are set', () => {
    expect(loadConfig(testEnv({ DISCORD_TOKEN: 'x' })).discord.enabled).toBe(false);
    expect(loadConfig(testEnv({ DISCORD_CLIENT_ID: 'x' })).discord.enabled).toBe(false);
    expect(
      loadConfig(testEnv({ DISCORD_TOKEN: 'x', DISCORD_CLIENT_ID: 'y' })).discord.enabled
    ).toBe(true);
  });

  it('rejects missing DATABASE_URL', () => {
    const env = testEnv();
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrowError(/DATABASE_URL/);
  });

  it('rejects a short SESSION_SECRET', () => {
    expect(() => loadConfig(testEnv({ SESSION_SECRET: 'short' }))).toThrowError(
      /SESSION_SECRET/
    );
  });

  it('parses the audio domain allowlist as lowercase, trimmed, deduped', () => {
    const config = loadConfig(
      testEnv({ ALLOWED_AUDIO_DOMAINS: ' Example.com, cdn.example.com ,example.com ' })
    );
    expect(config.audio.allowedDomains).toEqual(['example.com', 'cdn.example.com']);
  });

  it('coerces numeric values and rejects out-of-range ports', () => {
    expect(loadConfig(testEnv({ ADMIN_PORT: '8080' })).admin.port).toBe(8080);
    expect(() => loadConfig(testEnv({ ADMIN_PORT: '99999' }))).toThrowError(/ADMIN_PORT/);
  });

  it('does not include secret values in error messages', () => {
    const secret = 'short';
    try {
      loadConfig(testEnv({ SESSION_SECRET: secret, INTERNAL_API_TOKEN: 'x' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
