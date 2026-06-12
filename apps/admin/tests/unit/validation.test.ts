import { describe, expect, it } from 'vitest';
import { validateGuildSettingsInput } from '../../src/validation.js';

describe('validateGuildSettingsInput', () => {
  it('accepts a full valid payload', () => {
    const result = validateGuildSettingsInput({
      allowedAudioDomains: 'Example.com, cdn.example.com\nfiles.example.org',
      maxQueueSize: '25',
      maxTrackDurationSeconds: '600',
    });
    expect(result).toEqual({
      ok: true,
      values: {
        allowedAudioDomains: ['example.com', 'cdn.example.com', 'files.example.org'],
        maxQueueSize: 25,
        maxTrackDurationSeconds: 600,
      },
    });
  });

  it('treats blank numbers as inherit (null)', () => {
    const result = validateGuildSettingsInput({
      allowedAudioDomains: '',
      maxQueueSize: '',
      maxTrackDurationSeconds: '  ',
    });
    expect(result).toEqual({
      ok: true,
      values: { allowedAudioDomains: [], maxQueueSize: null, maxTrackDurationSeconds: null },
    });
  });

  it('deduplicates and lowercases domains', () => {
    const result = validateGuildSettingsInput({
      allowedAudioDomains: 'EXAMPLE.com\nexample.com',
    });
    expect(result.ok && result.values.allowedAudioDomains).toEqual(['example.com']);
  });

  it.each([
    'https://example.com',
    'example.com/path',
    'example.com:8080',
    'no-dots',
    '-leading.example.com',
  ])('rejects malformed domain entry %s', (entry) => {
    const result = validateGuildSettingsInput({ allowedAudioDomains: entry });
    expect(result.ok).toBe(false);
  });

  it.each([
    ['maxQueueSize', '0'],
    ['maxQueueSize', '1001'],
    ['maxQueueSize', '3.5'],
    ['maxQueueSize', 'abc'],
    ['maxTrackDurationSeconds', '0'],
    ['maxTrackDurationSeconds', '86401'],
  ])('rejects out-of-range %s = %s', (field, value) => {
    const result = validateGuildSettingsInput({ [field]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collects multiple errors at once', () => {
    const result = validateGuildSettingsInput({
      allowedAudioDomains: 'http://bad',
      maxQueueSize: '99999',
    });
    expect(!result.ok && result.errors.length).toBe(2);
  });
});
