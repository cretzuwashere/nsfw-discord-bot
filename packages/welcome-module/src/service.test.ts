import type {
  AuditEntry,
  GuildService,
  GuildServiceProvider,
  MemberJoinEvent,
  MemberLeaveEvent,
} from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WelcomeRepo, WelcomeSettingsRow } from './repo.js';
import { createWelcomeService } from './service.js';

function settings(overrides: Partial<WelcomeSettingsRow> = {}): WelcomeSettingsRow {
  return {
    guildId: 'g-uuid',
    welcomeEnabled: true,
    leaveEnabled: true,
    welcomeChannelId: 'chan-welcome',
    leaveChannelId: 'chan-leave',
    welcomeMessage: 'Welcome {{user.mention}} to {{server.name}}!',
    leaveMessage: '{{user.username}} left.',
    welcomeCardTemplateId: null,
    dmEnabled: false,
    dmMessage: '',
    autoRoleIds: [],
    rulesChannelId: null,
    delaySeconds: 0,
    logChannelId: null,
    updatedAt: new Date(),
    ...overrides,
  } as WelcomeSettingsRow;
}

function joinEvent(): MemberJoinEvent {
  return {
    type: 'member.join',
    adapterKey: 'discord',
    guild: { id: null, externalId: 'ext-guild', name: 'Guild' },
    user: { externalId: 'u-1', username: 'Ada', displayName: 'Ada L' },
    memberCount: 42,
  };
}

function makeHarness(settingsRow: WelcomeSettingsRow | undefined, options: { ready?: boolean } = {}) {
  const sent: Array<{ channelId: string; content?: string }> = [];
  const roles: Array<{ userId: string; roleId: string }> = [];
  const dms: string[] = [];
  const auditEntries: AuditEntry[] = [];
  const failingRoles = new Set<string>();

  const service: GuildService = {
    guildExternalId: 'ext-guild',
    sendMessage: vi.fn(async (channelId: string, msg) => {
      sent.push({ channelId, content: msg.content });
      return { channelId, messageId: 'm-1' };
    }),
    addRole: vi.fn(async (userId: string, roleId: string) => {
      if (failingRoles.has(roleId)) throw new Error(`cannot manage role ${roleId}`);
      roles.push({ userId, roleId });
    }),
    sendDirectMessage: vi.fn(async (_userId: string, msg) => {
      dms.push(msg.content ?? '');
    }),
  } as unknown as GuildService;

  const provider: GuildServiceProvider = {
    isReady: () => options.ready ?? true,
    forGuild: () => (options.ready === false ? null : service),
  };

  const welcome = { get: vi.fn(async () => settingsRow) } as unknown as WelcomeRepo;
  const guilds = {
    upsertByExternalId: vi.fn(async () => ({ id: 'g-uuid', externalId: 'ext-guild', name: 'Guild' })),
  } as unknown as Parameters<typeof createWelcomeService>[0]['guilds'];

  const renderCard = vi.fn(async () => Buffer.from('PNG'));

  const svc = createWelcomeService({
    welcome,
    guilds,
    guildServiceProvider: provider,
    audit: { record: async (e) => void auditEntries.push(e) },
    logger: createSilentLogger(),
    renderCard,
  });

  return { svc, sent, roles, dms, auditEntries, renderCard, failRole: (roleId: string) => failingRoles.add(roleId) };
}

beforeEach(() => vi.useRealTimers());

describe('WelcomeService.handleJoin', () => {
  it('sends a welcome message with placeholders resolved', async () => {
    const h = makeHarness(settings());
    await h.svc.handleJoin(joinEvent());
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.content).toBe('Welcome <@u-1> to Guild!');
    expect(h.auditEntries.some((e) => e.action === 'welcome.sent')).toBe(true);
  });

  it('does nothing when welcome is disabled', async () => {
    const h = makeHarness(settings({ welcomeEnabled: false }));
    await h.svc.handleJoin(joinEvent());
    expect(h.sent).toHaveLength(0);
  });

  it('assigns auto-roles', async () => {
    const h = makeHarness(settings({ autoRoleIds: ['r1', 'r2'] }));
    await h.svc.handleJoin(joinEvent());
    expect(h.roles).toEqual([
      { userId: 'u-1', roleId: 'r1' },
      { userId: 'u-1', roleId: 'r2' },
    ]);
  });

  it('assigns auto-roles even when the welcome message is disabled', async () => {
    const h = makeHarness(settings({ welcomeEnabled: false, autoRoleIds: ['r-member'] }));
    await h.svc.handleJoin(joinEvent());
    expect(h.roles).toEqual([{ userId: 'u-1', roleId: 'r-member' }]);
    expect(h.sent).toHaveLength(0); // no welcome message sent
    expect(h.auditEntries.some((e) => e.action === 'welcome.autorole')).toBe(true);
  });

  it('assigns auto-roles immediately, before the welcome delay elapses', async () => {
    vi.useFakeTimers();
    const h = makeHarness(settings({ delaySeconds: 30, autoRoleIds: ['r-member'] }));
    await h.svc.handleJoin(joinEvent());
    expect(h.roles).toEqual([{ userId: 'u-1', roleId: 'r-member' }]); // assigned now
    expect(h.sent).toHaveLength(0); // message still pending
    await vi.advanceTimersByTimeAsync(30_100);
    expect(h.sent).toHaveLength(1);
    vi.useRealTimers();
  });

  it('keeps assigning the remaining roles when one fails', async () => {
    const h = makeHarness(settings({ welcomeEnabled: false, autoRoleIds: ['bad', 'good'] }));
    h.failRole('bad');
    await h.svc.handleJoin(joinEvent());
    expect(h.roles).toEqual([{ userId: 'u-1', roleId: 'good' }]);
    expect(h.auditEntries.some((e) => e.action === 'welcome.autorole')).toBe(true);
  });

  it('records no autorole audit when every role fails to assign', async () => {
    const h = makeHarness(settings({ welcomeEnabled: false, autoRoleIds: ['bad'] }));
    h.failRole('bad');
    await h.svc.handleJoin(joinEvent());
    expect(h.roles).toHaveLength(0);
    expect(h.auditEntries.some((e) => e.action === 'welcome.autorole')).toBe(false);
  });

  it('assigns auto-roles exactly once across a rapid duplicate join', async () => {
    const h = makeHarness(settings({ autoRoleIds: ['r1'] }));
    await h.svc.handleJoin(joinEvent());
    await h.svc.handleJoin(joinEvent());
    expect(h.roles).toEqual([{ userId: 'u-1', roleId: 'r1' }]); // not assigned twice
    expect(h.sent).toHaveLength(1);
  });

  it('sends a DM when enabled', async () => {
    const h = makeHarness(settings({ dmEnabled: true, dmMessage: 'Hi {{user.username}}' }));
    await h.svc.handleJoin(joinEvent());
    expect(h.dms).toEqual(['Hi Ada']);
  });

  it('attaches a rendered card when a template is configured', async () => {
    const h = makeHarness(settings({ welcomeCardTemplateId: 'tmpl-1' }));
    await h.svc.handleJoin(joinEvent());
    expect(h.renderCard).toHaveBeenCalledWith('tmpl-1', expect.objectContaining({ 'user.mention': '<@u-1>' }));
  });

  it('deduplicates rapid duplicate join events', async () => {
    const h = makeHarness(settings());
    await h.svc.handleJoin(joinEvent());
    await h.svc.handleJoin(joinEvent());
    expect(h.sent).toHaveLength(1);
  });

  it('does nothing when the bot is offline', async () => {
    const h = makeHarness(settings(), { ready: false });
    await h.svc.handleJoin(joinEvent());
    expect(h.sent).toHaveLength(0);
  });

  it('honors a delay before sending', async () => {
    vi.useFakeTimers();
    const h = makeHarness(settings({ delaySeconds: 5 }));
    await h.svc.handleJoin(joinEvent());
    expect(h.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5100);
    expect(h.sent).toHaveLength(1);
  });
});

describe('WelcomeService.handleLeave', () => {
  it('sends a leave message when enabled', async () => {
    const h = makeHarness(settings());
    const event: MemberLeaveEvent = {
      type: 'member.leave',
      adapterKey: 'discord',
      guild: { id: null, externalId: 'ext-guild', name: 'Guild' },
      user: { externalId: 'u-1', username: 'Ada', displayName: 'Ada L' },
      memberCount: 41,
    };
    await h.svc.handleLeave(event);
    expect(h.sent[0]?.content).toBe('Ada left.');
  });
});
