import type {
  CommandContext,
  CommandDefinition,
  GuildService,
  GuildServiceProvider,
} from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModerationCasesRepo } from './cases-repo.js';
import { buildModerationCommands } from './commands.js';

function makeHarness(options: { isOwner?: boolean; failKick?: boolean } = {}) {
  const created: Array<{ actionType: string; target: string }> = [];

  const service: GuildService = {
    guildExternalId: 'ext',
    isGuildOwner: vi.fn(async () => options.isOwner ?? false),
    kickMember: vi.fn(async () => {
      if (options.failKick) {
        const { UserFacingError } = await import('@botplatform/shared');
        throw new UserFacingError('PERMISSION_DENIED', 'cannot kick');
      }
    }),
    sendDirectMessage: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => ({ channelId: 'c', messageId: 'm' })),
    timeoutMember: vi.fn(async () => {}),
    purgeMessages: vi.fn(async () => 5),
  } as unknown as GuildService;

  const provider: GuildServiceProvider = { isReady: () => true, forGuild: () => service };

  const cases = {
    create: vi.fn(async (input: { actionType: string; targetUserExternalId: string }) => {
      created.push({ actionType: input.actionType, target: input.targetUserExternalId });
      return { caseNumber: created.length, ...input };
    }),
    getSettings: vi.fn(async () => undefined),
    listByUser: vi.fn(async () => []),
  } as unknown as ModerationCasesRepo;

  const guilds = {
    upsertByExternalId: vi.fn(async () => ({ id: 'g-uuid', externalId: 'ext', name: 'G' })),
  } as unknown as Parameters<typeof buildModerationCommands>[0]['guilds'];

  const warnings = { warnUser: vi.fn(async () => ({})) } as unknown as Parameters<
    typeof buildModerationCommands
  >[0]['warnings'];

  const commands = buildModerationCommands({
    cases,
    guilds,
    warnings,
    guildServiceProvider: provider,
    audit: { record: async () => {} },
  });
  const byName = new Map(commands.map((c) => [c.name, c]));
  return { commands, byName, created, service, warnings };
}

function ctx(options: Record<string, string | number>, overrides: Partial<CommandContext> = {}): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    commandName: 'x',
    subcommand: null,
    adapterKey: 'discord',
    guildId: 'ext',
    channelId: 'chan',
    user: { id: 'mod-1', displayName: 'Mod' },
    options,
    logger: createSilentLogger(),
    voice: null,
    replies,
    defer: async () => {},
    reply: async (p) => void replies.push(typeof p === 'string' ? p : p.content),
    ...overrides,
  } as CommandContext & { replies: string[] };
}

function run(cmd: CommandDefinition | undefined, c: CommandContext) {
  if (!cmd?.execute) throw new Error('no command');
  return cmd.execute(c);
}

let h: ReturnType<typeof makeHarness>;
beforeEach(() => {
  h = makeHarness();
});

describe('moderation commands', () => {
  it('registers permission-gated commands', () => {
    expect([...h.byName.keys()].sort()).toEqual(
      ['ban', 'clearwarnings', 'kick', 'lock', 'purge', 'slowmode', 'timeout', 'unban', 'unlock', 'untimeout', 'warn', 'warnings'].sort()
    );
    expect(h.byName.get('ban')?.defaultMemberPermissions).toContain('BanMembers');
    expect(h.byName.get('kick')?.guildOnly).toBe(true);
  });

  it('warn records a case and a warning', async () => {
    const c = ctx({ user: 'target-1', reason: 'spam' });
    await run(h.byName.get('warn'), c);
    expect(h.warnings.warnUser).toHaveBeenCalled();
    expect(h.created).toContainEqual({ actionType: 'warn', target: 'target-1' });
  });

  it('kick creates a case on success', async () => {
    const c = ctx({ user: 'target-1', reason: 'rude' });
    await run(h.byName.get('kick'), c);
    expect(h.service.kickMember).toHaveBeenCalledWith('target-1', 'rude');
    expect(h.created).toContainEqual({ actionType: 'kick', target: 'target-1' });
    expect(c.replies[0]).toMatch(/Case #\d+: kick applied/);
  });

  it('refuses to kick the server owner', async () => {
    const owner = makeHarness({ isOwner: true });
    const c = ctx({ user: 'owner-1', reason: 'x' });
    await run(owner.byName.get('kick'), c);
    expect(owner.service.kickMember).not.toHaveBeenCalled();
    expect(owner.created).toHaveLength(0);
    expect(c.replies[0]).toMatch(/server owner/i);
  });

  it('reports a safe message when the action fails, with no case', async () => {
    const failing = makeHarness({ failKick: true });
    const c = ctx({ user: 'target-1', reason: 'x' });
    await run(failing.byName.get('kick'), c);
    expect(failing.created).toHaveLength(0);
    expect(c.replies[0]).toBe('cannot kick'); // safeMessage from PlatformError? no — generic
  });

  it('purge deletes messages and reports the count', async () => {
    const c = ctx({ amount: 10 });
    await run(h.byName.get('purge'), c);
    expect(h.service.purgeMessages).toHaveBeenCalledWith('chan', 10);
    expect(c.replies[0]).toMatch(/Deleted 5/);
  });
});
