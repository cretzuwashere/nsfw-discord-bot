import { describe, expect, it } from 'vitest';
import { hexColorToInt, validateAnnouncement } from './validation.js';

describe('validateAnnouncement', () => {
  const base = { title: 'Hi', body: 'Body', format: 'plain', targetChannelId: 'chan-1' };

  it('accepts a minimal valid announcement', () => {
    const result = validateAnnouncement(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mentionMode).toBe('none');
      expect(result.warnings).toEqual([]);
    }
  });

  it('requires a target channel and some content', () => {
    expect(validateAnnouncement({ title: 'x', body: 'y' }).ok).toBe(false);
    const noContent = validateAnnouncement({ targetChannelId: 'c' });
    expect(noContent.ok).toBe(false);
  });

  it('BLOCKS @everyone without explicit confirmation', () => {
    const result = validateAnnouncement({ ...base, mentionMode: 'everyone' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/confirmation/i);
  });

  it('allows @everyone with confirmation and warns', () => {
    const result = validateAnnouncement({ ...base, mentionMode: 'everyone', confirmMassMention: 'on' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings[0]).toMatch(/@everyone/);
  });

  it('BLOCKS @here without confirmation too', () => {
    expect(validateAnnouncement({ ...base, mentionMode: 'here' }).ok).toBe(false);
  });

  it('requires roles for role mention mode', () => {
    expect(validateAnnouncement({ ...base, mentionMode: 'roles', mentionRoleIds: [] }).ok).toBe(false);
    const ok = validateAnnouncement({ ...base, mentionMode: 'roles', mentionRoleIds: ['r1'] });
    expect(ok.ok).toBe(true);
  });

  it('parses comma-separated role ids', () => {
    const result = validateAnnouncement({ ...base, mentionMode: 'roles', mentionRoleIds: 'r1, r2 ,r3' });
    expect(result.ok && result.value.mentionRoleIds).toEqual(['r1', 'r2', 'r3']);
  });

  it('validates the embed color', () => {
    expect(validateAnnouncement({ ...base, embedColor: 'nope' }).ok).toBe(false);
    const ok = validateAnnouncement({ ...base, embedColor: '5865F2' });
    expect(ok.ok && ok.value.embedColor).toBe('#5865F2');
  });

  it('rejects non-http image URLs', () => {
    expect(validateAnnouncement({ ...base, imageUrl: 'file:///etc/passwd' }).ok).toBe(false);
    expect(validateAnnouncement({ ...base, imageUrl: 'not a url' }).ok).toBe(false);
    const ok = validateAnnouncement({ ...base, imageUrl: 'https://cdn.example.com/x.png' });
    expect(ok.ok).toBe(true);
  });
});

describe('hexColorToInt', () => {
  it('converts hex to integer', () => {
    expect(hexColorToInt('#5865F2')).toBe(0x5865f2);
    expect(hexColorToInt('5865F2')).toBe(0x5865f2);
  });
  it('returns undefined for invalid/empty input', () => {
    expect(hexColorToInt(null)).toBeUndefined();
    expect(hexColorToInt('xyz')).toBeUndefined();
  });
});
