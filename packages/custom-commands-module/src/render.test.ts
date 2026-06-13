import { describe, expect, it } from 'vitest';
import type { CustomCommandRow } from './repo.js';
import { isValidCommandName, renderCustomResponse } from './render.js';

function cmd(responseType: CustomCommandRow['responseType'], response: unknown): CustomCommandRow {
  return { responseType, response } as unknown as CustomCommandRow;
}

const DATA = { 'user.username': 'Ada', 'server.name': 'Guild' };

describe('renderCustomResponse', () => {
  it('renders a text response with placeholders', () => {
    const msg = renderCustomResponse(cmd('text', { text: 'Hi {{user.username}}!' }), DATA);
    expect(msg.content).toBe('Hi Ada!');
    expect(msg.allowMentions?.everyone).toBe(false);
  });

  it('renders an embed response', () => {
    const msg = renderCustomResponse(cmd('embed', { title: '{{server.name}}', description: 'Welcome', color: 0x123456 }), DATA);
    expect(msg.embed?.title).toBe('Guild');
    expect(msg.embed?.color).toBe(0x123456);
  });

  it('renders a deterministic random choice', () => {
    const c = cmd('random', { choices: ['a {{user.username}}', 'b', 'c'] });
    expect(renderCustomResponse(c, DATA, 0).content).toBe('a Ada');
    expect(renderCustomResponse(c, DATA, 1).content).toBe('b');
    expect(renderCustomResponse(c, DATA, 4).content).toBe('b'); // wraps (4 % 3 = 1)
  });

  it('renders a link button', () => {
    const msg = renderCustomResponse(cmd('link', { text: 'Click', url: 'https://example.com', label: 'Go' }), DATA);
    expect(msg.buttons?.[0]).toMatchObject({ url: 'https://example.com', style: 'link', label: 'Go' });
  });

  it('never allows mentions', () => {
    const msg = renderCustomResponse(cmd('text', { text: '@everyone {{user.username}}' }), DATA);
    expect(msg.allowMentions).toEqual({ everyone: false, roles: [], users: [] });
  });
});

describe('isValidCommandName', () => {
  it('accepts lowercase slugs', () => {
    expect(isValidCommandName('rules')).toBe(true);
    expect(isValidCommandName('my-cmd_2')).toBe(true);
  });
  it('rejects invalid names', () => {
    expect(isValidCommandName('Has Space')).toBe(false);
    expect(isValidCommandName('UPPER')).toBe(false);
    expect(isValidCommandName('')).toBe(false);
    expect(isValidCommandName('a'.repeat(33))).toBe(false);
  });
});
