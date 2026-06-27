import type {
  CommandContext,
  CommandDefinition,
  ComponentInteractionEvent,
  SubcommandDefinition,
} from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerManager } from '../engine/manager.js';
import { FakeVoiceCapability } from '../testing/fakes.js';
import {
  buildRadioCommand,
  buildRadioComponentHandler,
  type RadioCommandDeps,
} from './commands.js';
import { RadioRegistry } from './registry.js';
import type { RadioStation } from './stations.js';

const STATIONS: RadioStation[] = [
  { id: 'groove', name: 'Groove', category: 'Chill', streamUrl: 'https://h/groove', enabled: true, sort: 1 },
  { id: 'drone', name: 'Drone', category: 'Ambient', streamUrl: 'https://h/drone', enabled: true, sort: 1 },
];

const LIMITS = { maxQueueSize: 5, maxTrackDurationSeconds: 3600 };

function makeDeps(): RadioCommandDeps {
  return {
    manager: new PlayerManager(LIMITS, null, createSilentLogger()),
    registry: new RadioRegistry(STATIONS),
    resolveCtx: { allowedDomains: [], timeoutMs: 5000, logger: createSilentLogger() },
  };
}

function subcommand(command: CommandDefinition, name: string): SubcommandDefinition {
  const found = command.subcommands?.find((s) => s.name === name);
  if (!found) throw new Error(`subcommand ${name} not found`);
  return found;
}

function makeCtx(
  voice: FakeVoiceCapability | null,
  options: Record<string, string> = {}
) {
  const replies: Array<{ content: string; ephemeral: boolean }> = [];
  const richReplies: import('@botplatform/core').OutgoingMessage[] = [];
  const ctx: CommandContext & {
    replies: typeof replies;
    richReplies: typeof richReplies;
  } = {
    commandName: 'radio',
    subcommand: null,
    adapterKey: 'test',
    guildId: 'guild-1',
    channelId: 'text-1',
    user: { id: 'u1', displayName: 'Tester' },
    options,
    logger: createSilentLogger(),
    voice,
    replies,
    richReplies,
    defer: vi.fn(async () => {}),
    reply: vi.fn(async (payload) => {
      replies.push(
        typeof payload === 'string'
          ? { content: payload, ephemeral: false }
          : { content: payload.content, ephemeral: payload.ephemeral ?? false }
      );
    }),
    replyRich: vi.fn(async (message) => {
      richReplies.push(message);
    }),
  };
  return ctx;
}

function makeComponentEvent(
  values: string[],
  overrides: Partial<ComponentInteractionEvent> = {}
): ComponentInteractionEvent & { replies: string[]; updates: unknown[] } {
  const replies: string[] = [];
  const updates: unknown[] = [];
  return {
    type: 'component.interaction',
    adapterKey: 'test',
    guild: { id: null, externalId: 'guild-1', name: 'Guild' },
    channelId: 'text-1',
    customId: 'radio:select',
    values,
    user: { externalId: 'u1', username: 'tester', displayName: 'Tester' },
    userRoleIds: [],
    reply: async (content: string) => {
      replies.push(content);
    },
    update: async (message) => {
      updates.push(message);
    },
    replies,
    updates,
    ...overrides,
  };
}

let deps: RadioCommandDeps;
let command: CommandDefinition;
beforeEach(() => {
  deps = makeDeps();
  command = buildRadioCommand(deps);
});

describe('/radio command shape', () => {
  it('is a guild-only command with list/play/stop/nowplaying subcommands', () => {
    expect(command.name).toBe('radio');
    expect(command.guildOnly).toBe(true);
    expect(command.subcommands?.map((s) => s.name).sort()).toEqual(
      ['list', 'nowplaying', 'play', 'stop'].sort()
    );
  });
});

describe('/radio list', () => {
  it('renders an embed with a station select menu', async () => {
    const ctx = makeCtx(new FakeVoiceCapability());
    await subcommand(command, 'list').execute(ctx);
    const message = ctx.richReplies[0];
    expect(message?.embed?.title).toMatch(/Online Radio/i);
    expect(message?.selectMenu?.customId).toBe('radio:select');
    expect(message?.selectMenu?.options.map((o) => o.value).sort()).toEqual(['drone', 'groove']);
  });

  it('filters by category', async () => {
    const ctx = makeCtx(new FakeVoiceCapability(), { category: 'Chill' });
    await subcommand(command, 'list').execute(ctx);
    expect(ctx.richReplies[0]?.selectMenu?.options.map((o) => o.value)).toEqual(['groove']);
  });

  it('reports when a category has no stations', async () => {
    const ctx = makeCtx(new FakeVoiceCapability(), { category: 'Polka' });
    await subcommand(command, 'list').execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/No stations in/i);
  });
});

describe('/radio play', () => {
  it('joins voice and plays a station as a live track', async () => {
    const ctx = makeCtx(new FakeVoiceCapability(), { station: 'groove' });
    await subcommand(command, 'play').execute(ctx);
    const snapshot = deps.manager.get('guild-1')?.getSnapshot();
    expect(snapshot?.nowPlaying?.title).toBe('Groove');
    expect(snapshot?.nowPlaying?.durationSeconds).toBeUndefined(); // live
    expect(ctx.richReplies[0]?.embed?.title).toMatch(/Now Playing/i);
  });

  it('rejects an unknown station', async () => {
    const ctx = makeCtx(new FakeVoiceCapability(), { station: 'nope' });
    await subcommand(command, 'play').execute(ctx);
    expect(ctx.replies[0]).toMatchObject({ ephemeral: true });
    expect(ctx.replies[0]?.content).toMatch(/Unknown station/i);
  });

  it('asks the user to join a voice channel when none is available', async () => {
    const voice = new FakeVoiceCapability();
    voice.userChannel = null;
    const ctx = makeCtx(voice, { station: 'groove' });
    await subcommand(command, 'play').execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/join a voice channel/i);
  });
});

describe('/radio stop', () => {
  it('reports when nothing is playing', async () => {
    const ctx = makeCtx(new FakeVoiceCapability());
    await subcommand(command, 'stop').execute(ctx);
    expect(ctx.replies[0]).toMatchObject({ ephemeral: true });
  });

  it('stops an active radio', async () => {
    const playCtx = makeCtx(new FakeVoiceCapability(), { station: 'groove' });
    await subcommand(command, 'play').execute(playCtx);
    const ctx = makeCtx(new FakeVoiceCapability());
    await subcommand(command, 'stop').execute(ctx);
    expect(ctx.replies[0]?.content).toMatch(/stopped/i);
    expect(deps.manager.get('guild-1')?.isActive).toBe(false);
  });
});

describe('radio select-menu component handler', () => {
  it('ignores customIds it does not own', async () => {
    const handler = buildRadioComponentHandler(deps);
    const event = makeComponentEvent(['groove'], { customId: 'audio:pause' });
    await handler(event);
    expect(event.replies).toHaveLength(0);
    expect(event.updates).toHaveLength(0);
  });

  it('guides the user to /radio play when not connected', async () => {
    const handler = buildRadioComponentHandler(deps);
    const event = makeComponentEvent(['groove']);
    await handler(event);
    expect(event.replies[0]).toMatch(/radio play groove/);
  });

  it('plays the selected station on the active session and refreshes the panel', async () => {
    const voice = new FakeVoiceCapability();
    const session = await voice.join('chan-1');
    deps.manager.ensureSession('guild-1', session);

    const handler = buildRadioComponentHandler(deps);
    const event = makeComponentEvent(['drone']);
    await handler(event);

    expect(deps.manager.get('guild-1')?.getSnapshot().nowPlaying?.title).toBe('Drone');
    expect(event.updates).toHaveLength(1);
  });
});
