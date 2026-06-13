import { describe, expect, it } from 'vitest';
import { isSpam, matchesRule, type MessageInfo } from './matcher.js';

function msg(overrides: Partial<MessageInfo> = {}): MessageInfo {
  return { content: '', mentionCount: 0, hasAttachments: false, ...overrides };
}

describe('matchesRule — banned_words', () => {
  it('detects a banned word case-insensitively', () => {
    expect(matchesRule('banned_words', { words: ['Spam'] }, msg({ content: 'this is SPAM!' })).violated).toBe(true);
    expect(matchesRule('banned_words', { words: ['spam'] }, msg({ content: 'clean' })).violated).toBe(false);
  });
});

describe('matchesRule — mention_spam', () => {
  it('triggers above the threshold', () => {
    expect(matchesRule('mention_spam', { mentionThreshold: 3 }, msg({ mentionCount: 4 })).violated).toBe(true);
    expect(matchesRule('mention_spam', { mentionThreshold: 3 }, msg({ mentionCount: 3 })).violated).toBe(false);
  });
});

describe('matchesRule — caps', () => {
  it('triggers on excessive uppercase over the minimum length', () => {
    expect(matchesRule('caps', { capsMinLength: 5, capsRatio: 0.7 }, msg({ content: 'THIS IS LOUD' })).violated).toBe(true);
    expect(matchesRule('caps', { capsMinLength: 5, capsRatio: 0.7 }, msg({ content: 'this is quiet' })).violated).toBe(false);
  });
  it('ignores short messages', () => {
    expect(matchesRule('caps', { capsMinLength: 20 }, msg({ content: 'HI' })).violated).toBe(false);
  });
});

describe('matchesRule — invite_links', () => {
  it('detects discord invites', () => {
    expect(matchesRule('invite_links', {}, msg({ content: 'join discord.gg/abcd' })).violated).toBe(true);
    expect(matchesRule('invite_links', {}, msg({ content: 'https://discord.com/invite/xyz' })).violated).toBe(true);
    expect(matchesRule('invite_links', {}, msg({ content: 'no link here' })).violated).toBe(false);
  });
});

describe('matchesRule — suspicious_links', () => {
  it('triggers on links outside the allowlist', () => {
    const cfg = { allowedDomains: ['example.com'] };
    expect(matchesRule('suspicious_links', cfg, msg({ content: 'see https://evil.test/x' })).violated).toBe(true);
    expect(matchesRule('suspicious_links', cfg, msg({ content: 'see https://cdn.example.com/x' })).violated).toBe(false);
    expect(matchesRule('suspicious_links', cfg, msg({ content: 'no links' })).violated).toBe(false);
  });
});

describe('matchesRule — attachments & new_account', () => {
  it('flags attachments when configured', () => {
    expect(matchesRule('attachments', {}, msg({ hasAttachments: true })).violated).toBe(true);
  });
  it('flags young accounts only when age is known', () => {
    expect(matchesRule('new_account', { minAccountAgeDays: 7 }, msg({ accountAgeDays: 2 })).violated).toBe(true);
    expect(matchesRule('new_account', { minAccountAgeDays: 7 }, msg({ accountAgeDays: 30 })).violated).toBe(false);
    expect(matchesRule('new_account', { minAccountAgeDays: 7 }, msg()).violated).toBe(false);
  });
});

describe('stateful rules return no direct match', () => {
  it('spam/repeated/raid are handled by the service', () => {
    expect(matchesRule('spam', {}, msg({ content: 'x' })).violated).toBe(false);
    expect(isSpam(6, 5)).toBe(true);
    expect(isSpam(5, 5)).toBe(false);
  });
});
