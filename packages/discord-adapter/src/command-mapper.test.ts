import type { CommandDefinition } from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { describe, expect, it, vi } from 'vitest';
import { normalizeReply } from './adapter.js';
import { commandsToDiscordJson } from './command-mapper.js';
import { registerSlashCommands } from './register-commands.js';

const noop = async () => {};

const SAMPLE: CommandDefinition[] = [
  {
    name: 'play',
    description: 'Play audio from a link',
    guildOnly: true,
    options: [
      { name: 'url', description: 'Link to an audio file', type: 'string', required: true },
      { name: 'volume', description: 'Playback volume', type: 'integer' },
      { name: 'shuffle', description: 'Shuffle mode', type: 'boolean' },
    ],
    execute: noop,
  },
  { name: 'ping', description: 'Health check', execute: noop },
];

describe('commandsToDiscordJson', () => {
  it('maps names, descriptions, option types and required flags', () => {
    const [play, ping] = commandsToDiscordJson(SAMPLE);
    expect(play).toMatchObject({
      name: 'play',
      description: 'Play audio from a link',
      contexts: [0],
      options: [
        { type: 3, name: 'url', required: true },
        { type: 4, name: 'volume', required: false },
        { type: 5, name: 'shuffle', required: false },
      ],
    });
    expect(ping).toEqual({ name: 'ping', description: 'Health check' });
  });

  it('truncates over-long descriptions to the 100-char Discord cap', () => {
    const [json] = commandsToDiscordJson([
      { name: 'x', description: 'y'.repeat(150), execute: noop },
    ]);
    expect(json?.description.length).toBeLessThanOrEqual(100);
  });
});

describe('registerSlashCommands', () => {
  it('puts the mapped body on the guild route when guildId is set', async () => {
    const put = vi.fn(async () => []);
    const count = await registerSlashCommands({
      token: 'secret-token',
      clientId: 'client-1',
      guildId: 'guild-1',
      commands: SAMPLE,
      logger: createSilentLogger(),
      rest: { put },
    });

    expect(count).toBe(2);
    expect(put).toHaveBeenCalledOnce();
    const [route, payload] = put.mock.calls[0] as unknown as [string, { body: unknown[] }];
    expect(route).toContain('client-1');
    expect(route).toContain('guild-1');
    expect(payload.body).toHaveLength(2);
  });

  it('uses the global route without a guildId', async () => {
    const put = vi.fn(async () => []);
    await registerSlashCommands({
      token: 'secret-token',
      clientId: 'client-1',
      commands: SAMPLE,
      logger: createSilentLogger(),
      rest: { put },
    });
    const [route] = put.mock.calls[0] as unknown as [string];
    expect(route).toContain('client-1');
    expect(route).not.toContain('guild');
  });
});

describe('normalizeReply', () => {
  it('treats bare strings as non-ephemeral', () => {
    expect(normalizeReply('hi')).toEqual({ content: 'hi', ephemeral: false });
  });
  it('preserves the ephemeral flag', () => {
    expect(normalizeReply({ content: 'hi', ephemeral: true })).toEqual({
      content: 'hi',
      ephemeral: true,
    });
    expect(normalizeReply({ content: 'hi' })).toEqual({ content: 'hi', ephemeral: false });
  });
});
