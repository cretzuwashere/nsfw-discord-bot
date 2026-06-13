import type { CommandContext, CommandDefinition } from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAudioCommands } from './commands.js';
import { PlayerManager } from './engine/manager.js';
import type { AudioResolver } from './resolver/resolver.js';
import { fakeTrack, FakeVoiceCapability } from './testing/fakes.js';

const LIMITS = { maxQueueSize: 3, maxTrackDurationSeconds: 3600 };

interface Harness {
  commands: Map<string, CommandDefinition>;
  manager: PlayerManager;
  voice: FakeVoiceCapability;
  resolve: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const manager = new PlayerManager(LIMITS, null, createSilentLogger());
  const resolve = vi.fn(async (rawUrl: string) => fakeTrack(rawUrl.split('/').pop() ?? 'track'));
  const resolver = { resolve } as unknown as AudioResolver;
  const list = buildAudioCommands({
    manager,
    resolver,
    resolveCtx: { allowedDomains: [], timeoutMs: 5000, logger: createSilentLogger() },
  });
  return {
    commands: new Map(list.map((command) => [command.name, command])),
    manager,
    voice: new FakeVoiceCapability(),
    resolve,
  };
}

function makeCtx(
  harness: Harness,
  commandName: string,
  options: Record<string, string> = {},
  overrides: Partial<CommandContext> = {}
) {
  const replies: Array<{ content: string; ephemeral: boolean }> = [];
  const ctx: CommandContext & { replies: typeof replies; deferred: () => boolean } = {
    commandName,
    subcommand: null,
    adapterKey: 'test',
    guildId: 'guild-1',
    channelId: 'text-1',
    user: { id: 'user-1', displayName: 'Tester' },
    options,
    logger: createSilentLogger(),
    voice: harness.voice,
    replies,
    deferred: () => deferCalls > 0,
    defer: vi.fn(async () => {
      deferCalls++;
    }),
    reply: vi.fn(async (payload) => {
      replies.push(
        typeof payload === 'string'
          ? { content: payload, ephemeral: false }
          : { content: payload.content, ephemeral: payload.ephemeral ?? false }
      );
    }),
    ...overrides,
  };
  let deferCalls = 0;
  return ctx;
}

function execOf(harness: Harness, name: string): NonNullable<CommandDefinition['execute']> {
  const command = harness.commands.get(name);
  if (!command?.execute) throw new Error(`command ${name} not registered or has no execute`);
  return command.execute;
}

async function run(harness: Harness, name: string, options: Record<string, string> = {}) {
  const ctx = makeCtx(harness, name, options);
  await execOf(harness, name)(ctx);
  return ctx;
}

let harness: Harness;
beforeEach(() => {
  harness = makeHarness();
});

describe('command registration', () => {
  it('exposes all nine audio commands, all guild-only', () => {
    const names = [...harness.commands.keys()].sort();
    expect(names).toEqual(
      ['join', 'leave', 'nowplaying', 'pause', 'play', 'queue', 'resume', 'skip', 'stop'].sort()
    );
    for (const command of harness.commands.values()) {
      expect(command.guildOnly).toBe(true);
    }
  });
});

describe('/join', () => {
  it('throws VOICE_UNAVAILABLE when the adapter has no voice support', async () => {
    const ctx = makeCtx(harness, 'join', {}, { voice: null });
    const error = await execOf(harness, 'join')(ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('VOICE_UNAVAILABLE');
  });

  it('tells the user to join a voice channel first', async () => {
    harness.voice.userChannel = null;
    const ctx = await run(harness, 'join');
    expect(ctx.replies[0]).toMatchObject({
      content: expect.stringMatching(/join a voice channel first/i),
      ephemeral: true,
    });
  });

  it('joins the channel of the invoking user', async () => {
    const ctx = await run(harness, 'join');
    expect(harness.voice.joinCalls).toEqual(['chan-1']);
    expect(ctx.replies[0]?.content).toMatch(/Joined #general/);
  });

  it('answers with a friendly status when already in the same channel', async () => {
    await run(harness, 'join');
    const ctx = await run(harness, 'join');
    expect(harness.voice.joinCalls).toHaveLength(1); // no second join
    expect(ctx.replies[0]?.content).toMatch(/already in #general/i);
  });
});

describe('/leave', () => {
  it('reports when not connected', async () => {
    const ctx = await run(harness, 'leave');
    expect(ctx.replies[0]?.content).toMatch(/not in a voice channel/i);
  });

  it('stops playback safely and disconnects', async () => {
    await run(harness, 'join');
    await run(harness, 'play', { url: 'https://example.com/song.mp3' });
    const session = harness.voice.activeSession!;

    const ctx = await run(harness, 'leave');
    expect(ctx.replies[0]?.content).toMatch(/left the voice channel/i);
    expect(session.destroyed).toBe(true);
    expect(harness.manager.get('guild-1')).toBeUndefined();
  });
});

describe('/play', () => {
  it('defers before doing network work', async () => {
    const ctx = await run(harness, 'play', { url: 'https://example.com/a.mp3' });
    expect(ctx.defer).toHaveBeenCalled();
  });

  it('requires the user to be in a voice channel when the bot is not connected', async () => {
    harness.voice.userChannel = null;
    const ctx = await run(harness, 'play', { url: 'https://example.com/a.mp3' });
    expect(ctx.replies[0]).toMatchObject({
      content: expect.stringMatching(/join a voice channel/i),
      ephemeral: true,
    });
    expect(harness.resolve).not.toHaveBeenCalled();
  });

  it('propagates safe resolution errors without crashing', async () => {
    harness.resolve.mockRejectedValue(
      new UserFacingError('URL_INVALID', 'That is not a valid link.')
    );
    const ctx = makeCtx(harness, 'play', { url: 'not-a-url' });
    const error = await execOf(harness, 'play')(ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).safeMessage).toBe('That is not a valid link.');
  });

  it('plays immediately when idle, then queues, then rejects when full', async () => {
    const first = await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    expect(first.replies[0]?.content).toMatch(/Now playing: \*\*one\.mp3\*\*/);

    const second = await run(harness, 'play', { url: 'https://example.com/two.mp3' });
    expect(second.replies[0]?.content).toMatch(/Queued \(#1\): \*\*two\.mp3\*\*/);

    await run(harness, 'play', { url: 'https://example.com/three.mp3' });
    await run(harness, 'play', { url: 'https://example.com/four.mp3' });

    const ctx = makeCtx(harness, 'play', { url: 'https://example.com/five.mp3' });
    const error = await execOf(harness, 'play')(ctx).catch((e) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as UserFacingError).code).toBe('QUEUE_FULL');
  });

  it('tags the track with the requesting user', async () => {
    await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    const snapshot = harness.manager.get('guild-1')!.getSnapshot();
    expect(snapshot.nowPlaying?.requestedBy).toBe('Tester');
  });
});

describe('/queue', () => {
  it('handles the empty queue gracefully', async () => {
    const ctx = await run(harness, 'queue');
    expect(ctx.replies[0]?.content).toMatch(/queue is empty/i);
  });

  it('shows now playing and upcoming items', async () => {
    await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    await run(harness, 'play', { url: 'https://example.com/two.mp3' });
    const ctx = await run(harness, 'queue');
    const text = ctx.replies[0]?.content ?? '';
    expect(text).toMatch(/Now playing: \*\*one\.mp3\*\*/);
    expect(text).toMatch(/1\. two\.mp3/);
  });
});

describe('/skip', () => {
  it('reports when nothing is playing', async () => {
    const ctx = await run(harness, 'skip');
    expect(ctx.replies[0]?.content).toMatch(/nothing is playing/i);
  });

  it('skips to the next track', async () => {
    await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    await run(harness, 'play', { url: 'https://example.com/two.mp3' });
    const ctx = await run(harness, 'skip');
    expect(ctx.replies[0]?.content).toMatch(/Skipped\. Now playing: \*\*two\.mp3\*\*/);
  });

  it('stops cleanly when the queue is empty', async () => {
    await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    const ctx = await run(harness, 'skip');
    expect(ctx.replies[0]?.content).toMatch(/queue is empty — stopping/i);
  });
});

describe('/pause, /resume', () => {
  it('handles all pause edge cases', async () => {
    expect((await run(harness, 'pause')).replies[0]?.content).toMatch(/nothing is playing/i);

    await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    expect((await run(harness, 'pause')).replies[0]?.content).toBe('Paused.');
    expect((await run(harness, 'pause')).replies[0]?.content).toBe('Already paused.');

    expect((await run(harness, 'resume')).replies[0]?.content).toBe('Resumed.');
    expect((await run(harness, 'resume')).replies[0]?.content).toMatch(/nothing is paused/i);
  });
});

describe('/stop', () => {
  it('reports when nothing is playing', async () => {
    const ctx = await run(harness, 'stop');
    expect(ctx.replies[0]?.content).toMatch(/nothing is playing/i);
  });

  it('stops and clears but keeps the connection', async () => {
    await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    await run(harness, 'play', { url: 'https://example.com/two.mp3' });
    const ctx = await run(harness, 'stop');
    expect(ctx.replies[0]?.content).toMatch(/stopped playback and cleared the queue/i);
    expect(harness.voice.activeSession?.destroyed).toBe(false);
    expect(harness.manager.get('guild-1')?.getSnapshot().queue).toHaveLength(0);
  });
});

describe('/nowplaying', () => {
  it('handles the idle state', async () => {
    const ctx = await run(harness, 'nowplaying');
    expect(ctx.replies[0]?.content).toMatch(/nothing is playing right now/i);
  });

  it('shows title, status, source and requester', async () => {
    await run(harness, 'play', { url: 'https://example.com/one.mp3' });
    const ctx = await run(harness, 'nowplaying');
    const text = ctx.replies[0]?.content ?? '';
    expect(text).toMatch(/\*\*one\.mp3\*\*/);
    expect(text).toMatch(/Status: playing/);
    expect(text).toMatch(/direct-http/);
    expect(text).toMatch(/Requested by: Tester/);

    await run(harness, 'pause');
    const paused = await run(harness, 'nowplaying');
    expect(paused.replies[0]?.content).toMatch(/Status: paused/);
  });
});
