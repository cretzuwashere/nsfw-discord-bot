import type { AuditEntry, GuildService, GuildServiceProvider } from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnouncementRepo, AnnouncementRow } from './repo.js';
import { buildOutgoing, createAnnouncementService } from './service.js';

function makeAnnouncement(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: 'a-1',
    guildId: 'g-uuid',
    title: 'Hello',
    body: 'World',
    format: 'plain',
    targetChannelId: 'chan-1',
    imageUrl: null,
    cardTemplateId: null,
    embedColor: null,
    footer: null,
    mentionMode: 'none',
    mentionRoleIds: [],
    buttons: [],
    status: 'scheduled',
    isTemplate: false,
    scheduledFor: new Date(),
    sentAt: null,
    sentMessageId: null,
    failureReason: null,
    createdBy: 'admin-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AnnouncementRow;
}

function makeHarness(options: { canSend?: boolean; ready?: boolean } = {}) {
  const auditEntries: AuditEntry[] = [];
  const sent: Array<{ channelId: string }> = [];
  const statusUpdates: Array<{ id: string; status: string }> = [];

  const guildService: GuildService = {
    guildExternalId: 'ext-guild',
    sendMessage: vi.fn(async (channelId) => {
      sent.push({ channelId });
      return { channelId, messageId: 'msg-1' };
    }),
    botHasPermission: vi.fn(async () => options.canSend ?? true),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    sendDirectMessage: vi.fn(),
    listRoles: vi.fn(),
    listChannels: vi.fn(),
    canManageRole: vi.fn(),
    addRole: vi.fn(),
    removeRole: vi.fn(),
    timeoutMember: vi.fn(),
    removeTimeout: vi.fn(),
    kickMember: vi.fn(),
    banMember: vi.fn(),
    unbanMember: vi.fn(),
    purgeMessages: vi.fn(),
    setSlowmode: vi.fn(),
    setChannelLocked: vi.fn(),
    getMemberRoleIds: vi.fn(),
    isGuildOwner: vi.fn(),
  } as unknown as GuildService;

  const guildServiceProvider: GuildServiceProvider = {
    isReady: () => options.ready ?? true,
    forGuild: () => (options.ready === false ? null : guildService),
  };

  const announcements = {
    getById: vi.fn(async () => makeAnnouncement()),
    setStatus: vi.fn(async (id: string, status: string) => {
      statusUpdates.push({ id, status });
    }),
    listDue: vi.fn(async () => [makeAnnouncement()]),
  } as unknown as AnnouncementRepo;

  const guilds = {
    getById: vi.fn(async () => ({ id: 'g-uuid', externalId: 'ext-guild', name: 'Guild' })),
  } as unknown as Parameters<typeof createAnnouncementService>[0]['guilds'];

  const service = createAnnouncementService({
    announcements,
    guilds,
    guildServiceProvider,
    audit: { record: async (e) => void auditEntries.push(e) },
    logger: createSilentLogger(),
  });

  return { service, sent, statusUpdates, auditEntries, guildService, announcements };
}

describe('buildOutgoing — mass-mention safety', () => {
  it('never allows @everyone for mode none', () => {
    const msg = buildOutgoing(makeAnnouncement({ mentionMode: 'none' }));
    expect(msg.allowMentions?.everyone).toBe(false);
    expect(msg.allowMentions?.roles).toEqual([]);
  });

  it('only allows the configured roles for role mode', () => {
    const msg = buildOutgoing(makeAnnouncement({ mentionMode: 'roles', mentionRoleIds: ['r1', 'r2'] }));
    expect(msg.allowMentions?.everyone).toBe(false);
    expect(msg.allowMentions?.roles).toEqual(['r1', 'r2']);
    expect(msg.content).toContain('<@&r1>');
  });

  it('allows everyone only for everyone/here modes', () => {
    expect(buildOutgoing(makeAnnouncement({ mentionMode: 'everyone' })).allowMentions?.everyone).toBe(true);
    expect(buildOutgoing(makeAnnouncement({ mentionMode: 'here' })).allowMentions?.everyone).toBe(true);
  });

  it('builds an embed for embed format', () => {
    const msg = buildOutgoing(makeAnnouncement({ format: 'embed', embedColor: '#5865F2' }));
    expect(msg.embed?.title).toBe('Hello');
    expect(msg.embed?.color).toBe(0x5865f2);
  });
});

describe('AnnouncementService.deliver', () => {
  let harness: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('sends and marks the announcement sent, with an audit entry', async () => {
    const result = await harness.service.deliverById('a-1');
    expect(result.ok).toBe(true);
    expect(harness.sent).toHaveLength(1);
    expect(harness.statusUpdates.at(-1)).toMatchObject({ status: 'sent' });
    expect(harness.auditEntries.some((e) => e.action === 'announcement.sent')).toBe(true);
  });

  it('fails (and records) when the bot lacks channel permission', async () => {
    const h = makeHarness({ canSend: false });
    const result = await h.service.deliverById('a-1');
    expect(result.ok).toBe(false);
    expect(h.sent).toHaveLength(0);
    expect(h.statusUpdates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('leaves the announcement scheduled when the bot is offline', async () => {
    const h = makeHarness({ ready: false });
    const result = await h.service.deliverById('a-1');
    expect(result.ok).toBe(false);
    // No status change to failed — it should retry next tick.
    expect(h.statusUpdates).toHaveLength(0);
  });

  it('deliverDue delivers all due announcements', async () => {
    const delivered = await harness.service.deliverDue(new Date());
    expect(delivered).toBe(1);
  });
});
