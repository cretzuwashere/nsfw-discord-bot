import { createSilentLogger } from '@botplatform/logger';
import { UserFacingError, GENERIC_USER_ERROR } from '@botplatform/shared';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from './contracts/commands.js';
import type { BotModule } from './contracts/module.js';
import type { AuditEntry } from './contracts/ports.js';
import { ModuleRegistry } from './registry.js';

function makeModule(overrides: Partial<BotModule> & { execute?: CommandContext['reply'] } = {}) {
  const execute = vi.fn(async (_ctx: CommandContext) => {});
  const module: BotModule = {
    key: 'test-module',
    name: 'Test Module',
    description: 'test',
    commands: [{ name: 'ping', description: 'ping', execute }],
    ...overrides,
  };
  return { module, execute };
}

function makeCtx(commandName = 'ping'): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    commandName,
    adapterKey: 'test',
    guildId: 'guild-1',
    channelId: 'chan-1',
    user: { id: 'user-1', displayName: 'Tester' },
    options: {},
    logger: createSilentLogger(),
    voice: null,
    replies,
    defer: vi.fn(async () => {}),
    reply: vi.fn(async (payload) => {
      replies.push(typeof payload === 'string' ? payload : payload.content);
    }),
  };
}

function makeDeps(enabled = true) {
  const auditEntries: AuditEntry[] = [];
  return {
    logger: createSilentLogger(),
    moduleState: { isEnabled: vi.fn(async () => enabled) },
    audit: {
      record: vi.fn(async (entry: AuditEntry) => {
        auditEntries.push(entry);
      }),
    },
    auditEntries,
  };
}

describe('ModuleRegistry', () => {
  it('rejects duplicate module keys and duplicate command names', () => {
    const registry = new ModuleRegistry();
    const { module } = makeModule();
    registry.register(module);
    expect(() => registry.register(module)).toThrowError(/registered twice/);

    const { module: other } = makeModule({ key: 'other-module' });
    expect(() => registry.register(other)).toThrowError(/conflicts/);
  });

  it('executes a command and writes an audit entry', async () => {
    const registry = new ModuleRegistry();
    const { module, execute } = makeModule();
    registry.register(module);
    const deps = makeDeps();
    const dispatch = registry.createDispatcher(deps);

    const ctx = makeCtx();
    await dispatch(ctx);

    expect(execute).toHaveBeenCalledOnce();
    expect(deps.auditEntries).toHaveLength(1);
    expect(deps.auditEntries[0]?.action).toBe('test-module.command.ping');
  });

  it('refuses to run commands of a disabled module', async () => {
    const registry = new ModuleRegistry();
    const { module, execute } = makeModule();
    registry.register(module);
    const dispatch = registry.createDispatcher(makeDeps(false));

    const ctx = makeCtx();
    await dispatch(ctx);

    expect(execute).not.toHaveBeenCalled();
    expect(ctx.replies[0]).toMatch(/disabled/);
  });

  it('replies politely to unknown commands', async () => {
    const registry = new ModuleRegistry();
    const dispatch = registry.createDispatcher(makeDeps());
    const ctx = makeCtx('nope');
    await dispatch(ctx);
    expect(ctx.replies[0]).toMatch(/Unknown command/);
  });

  it('blocks guild-only commands outside guilds', async () => {
    const registry = new ModuleRegistry();
    const execute = vi.fn(async () => {});
    registry.register({
      key: 'm',
      name: 'M',
      description: '',
      commands: [{ name: 'ping', description: '', guildOnly: true, execute }],
    });
    const dispatch = registry.createDispatcher(makeDeps());
    const ctx = { ...makeCtx(), guildId: null };
    await dispatch(ctx);
    expect(execute).not.toHaveBeenCalled();
  });

  it('shows safe messages for UserFacingError and a generic one otherwise', async () => {
    const registry = new ModuleRegistry();
    registry.register({
      key: 'm',
      name: 'M',
      description: '',
      commands: [
        {
          name: 'friendly',
          description: '',
          execute: async () => {
            throw new UserFacingError('URL_INVALID', 'That link is not valid.');
          },
        },
        {
          name: 'internal',
          description: '',
          execute: async () => {
            throw new Error('database password is hunter2');
          },
        },
      ],
    });
    const dispatch = registry.createDispatcher(makeDeps());

    const friendlyCtx = makeCtx('friendly');
    await dispatch(friendlyCtx);
    expect(friendlyCtx.replies[0]).toBe('That link is not valid.');

    const internalCtx = makeCtx('internal');
    await dispatch(internalCtx);
    expect(internalCtx.replies[0]).toBe(GENERIC_USER_ERROR);
    expect(internalCtx.replies[0]).not.toContain('hunter2');
  });

  it('survives a reply failure without throwing', async () => {
    const registry = new ModuleRegistry();
    const { module } = makeModule({ key: 'm2' });
    const registry2 = new ModuleRegistry();
    registry2.register(module);
    const dispatch = registry2.createDispatcher(makeDeps(false));
    const ctx = makeCtx();
    (ctx.reply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    await expect(dispatch(ctx)).resolves.toBeUndefined();
    void registry;
  });
});
