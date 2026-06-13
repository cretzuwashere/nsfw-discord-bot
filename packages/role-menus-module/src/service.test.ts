import type {
  ComponentInteractionEvent,
  GuildService,
  GuildServiceProvider,
} from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleMenuRepo, RoleMenuWithOptions } from './repo.js';
import { createRoleMenuService } from './service.js';

function menu(overrides: Partial<RoleMenuWithOptions> = {}): RoleMenuWithOptions {
  return {
    id: 'm1',
    guildId: 'g-uuid',
    name: 'Colors',
    type: 'button',
    mode: 'multiple',
    channelId: null,
    messageId: null,
    style: 'embed',
    title: 'Pick',
    description: '',
    constraints: {},
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    options: [
      { id: 'o1', menuId: 'm1', roleId: 'r1', label: 'Red', description: '', emoji: null, position: 0 },
    ],
    ...overrides,
  } as RoleMenuWithOptions;
}

function makeHarness(menuRow: RoleMenuWithOptions | undefined, options: { ready?: boolean } = {}) {
  const replies: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const logged: Array<{ action: string; roleId: string }> = [];

  const service: GuildService = {
    guildExternalId: 'ext',
    addRole: vi.fn(async (_u: string, roleId: string) => void added.push(roleId)),
    removeRole: vi.fn(async (_u: string, roleId: string) => void removed.push(roleId)),
  } as unknown as GuildService;

  const provider: GuildServiceProvider = {
    isReady: () => options.ready ?? true,
    forGuild: () => (options.ready === false ? null : service),
  };

  const menus = {
    getWithOptions: vi.fn(async () => menuRow),
    logAssignment: vi.fn(async (e: { action: 'added' | 'removed'; roleId: string }) =>
      void logged.push({ action: e.action, roleId: e.roleId })
    ),
  } as unknown as RoleMenuRepo;

  const guilds = {
    upsertByExternalId: vi.fn(async () => ({ id: 'g-uuid', externalId: 'ext', name: 'G' })),
  } as unknown as Parameters<typeof createRoleMenuService>[0]['guilds'];

  const svc = createRoleMenuService({
    menus,
    guilds,
    guildServiceProvider: provider,
    audit: { record: async () => {} },
    logger: createSilentLogger(),
  });

  function event(customId: string, values: string[] = [], userRoleIds: string[] = []): ComponentInteractionEvent {
    return {
      type: 'component.interaction',
      adapterKey: 'discord',
      guild: { id: null, externalId: 'ext', name: 'G' },
      channelId: 'c1',
      customId,
      values,
      user: { externalId: 'u1', username: 'Ada', displayName: 'Ada' },
      userRoleIds,
      reply: async (content: string) => void replies.push(content),
    };
  }

  return { svc, replies, added, removed, logged, event };
}

beforeEach(() => vi.clearAllMocks());

describe('RoleMenuService.handleInteraction', () => {
  it('adds a role on button click and logs it', async () => {
    const h = makeHarness(menu());
    await h.svc.handleInteraction(h.event('rolemenu:m1:r1'));
    expect(h.added).toEqual(['r1']);
    expect(h.logged).toContainEqual({ action: 'added', roleId: 'r1' });
    expect(h.replies[0]).toMatch(/updated/i);
  });

  it('removes a held role on toggle', async () => {
    const h = makeHarness(menu());
    await h.svc.handleInteraction(h.event('rolemenu:m1:r1', [], ['r1']));
    expect(h.removed).toEqual(['r1']);
  });

  it('ignores non-rolemenu custom ids', async () => {
    const h = makeHarness(menu());
    await h.svc.handleInteraction(h.event('other:x'));
    expect(h.replies).toHaveLength(0);
  });

  it('refuses a disabled menu', async () => {
    const h = makeHarness(menu({ enabled: false }));
    await h.svc.handleInteraction(h.event('rolemenu:m1:r1'));
    expect(h.replies[0]).toMatch(/no longer active/i);
    expect(h.added).toEqual([]);
  });

  it('handles a missing menu gracefully', async () => {
    const h = makeHarness(undefined);
    await h.svc.handleInteraction(h.event('rolemenu:gone:r1'));
    expect(h.replies[0]).toMatch(/no longer active/i);
  });

  it('reports when the bot is offline', async () => {
    const h = makeHarness(menu(), { ready: false });
    await h.svc.handleInteraction(h.event('rolemenu:m1:r1'));
    expect(h.replies[0]).toMatch(/not available/i);
  });

  it('reports a permission failure when the role cannot be managed', async () => {
    const h = makeHarness(menu());
    // Re-wire addRole to throw.
    const provider = (h.svc as unknown as { __t?: never }) && h;
    void provider;
    // Use a fresh harness with a throwing service.
    const replies: string[] = [];
    const svc = createRoleMenuService({
      menus: { getWithOptions: async () => menu(), logAssignment: async () => {} } as unknown as RoleMenuRepo,
      guilds: { upsertByExternalId: async () => ({ id: 'g', externalId: 'ext', name: 'G' }) } as never,
      guildServiceProvider: {
        isReady: () => true,
        forGuild: () =>
          ({
            addRole: async () => {
              throw new Error('hierarchy');
            },
          }) as unknown as GuildService,
      },
      audit: { record: async () => {} },
      logger: createSilentLogger(),
    });
    await svc.handleInteraction({
      type: 'component.interaction',
      adapterKey: 'discord',
      guild: { id: null, externalId: 'ext', name: 'G' },
      channelId: 'c1',
      customId: 'rolemenu:m1:r1',
      values: [],
      user: { externalId: 'u1', username: 'Ada', displayName: 'Ada' },
      userRoleIds: [],
      reply: async (content: string) => void replies.push(content),
    });
    expect(replies[0]).toMatch(/permission|hierarchy/i);
  });
});
