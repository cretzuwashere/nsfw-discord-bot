import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createGuildsRepo,
  createModerationRepo,
  resolveTestDatabaseUrl,
  schema,
  type Database,
} from '../../src/index.js';

let database: Database;
let guildId: string;

const createdPlatformUserIds: string[] = [];

beforeAll(async () => {
  database = createDatabase(resolveTestDatabaseUrl());
  const guild = await createGuildsRepo(database.db).upsertByExternalId({
    adapterKey: 'discord',
    externalId: `moderation-test-${randomUUID()}`,
    name: 'Moderation Test Guild',
  });
  guildId = guild.id;
});

afterAll(async () => {
  // Warnings, actions and guild-scoped rules cascade with the guild.
  await database.db.delete(schema.guilds).where(eq(schema.guilds.id, guildId));
  if (createdPlatformUserIds.length > 0) {
    await database.db
      .delete(schema.platformUsers)
      .where(inArray(schema.platformUsers.id, createdPlatformUserIds));
  }
  await database.close();
});

describe('platform users', () => {
  it('deduplicates upserts by adapter + external id', async () => {
    const repo = createModerationRepo(database.db);
    const externalId = randomUUID();

    const first = await repo.upsertPlatformUser({
      adapterKey: 'discord',
      externalId,
      username: 'original-name',
    });
    createdPlatformUserIds.push(first.id);

    const second = await repo.upsertPlatformUser({
      adapterKey: 'discord',
      externalId,
      username: 'renamed-user',
    });

    expect(second.id).toBe(first.id);
    expect(second.username).toBe('renamed-user');
  });
});

describe('warnings', () => {
  it('adds, lists and revokes warnings', async () => {
    const repo = createModerationRepo(database.db);
    const user = await repo.upsertPlatformUser({ adapterKey: 'discord', externalId: randomUUID() });
    createdPlatformUserIds.push(user.id);

    const warning = await repo.addWarning({
      guildId,
      userId: user.id,
      moderatorId: 'mod-123',
      reason: 'spamming links',
    });
    expect(warning.revokedAt).toBeNull();

    const listed = await repo.listWarnings(200);
    expect(listed.some((row) => row.id === warning.id)).toBe(true);

    await repo.revokeWarning(warning.id);
    const rows = await database.db
      .select()
      .from(schema.warnings)
      .where(eq(schema.warnings.id, warning.id));
    expect(rows[0]?.revokedAt).toBeInstanceOf(Date);
  });
});

describe('moderation actions', () => {
  it('records and lists actions', async () => {
    const repo = createModerationRepo(database.db);
    const user = await repo.upsertPlatformUser({ adapterKey: 'discord', externalId: randomUUID() });
    createdPlatformUserIds.push(user.id);

    const action = await repo.addAction({
      guildId,
      userId: user.id,
      moderatorId: 'mod-456',
      actionType: 'mute',
      reason: 'cooling off',
      metadata: { durationMinutes: 10 },
    });
    expect(action.actionType).toBe('mute');
    expect(action.metadata).toEqual({ durationMinutes: 10 });

    const listed = await repo.listActions(200);
    expect(listed.some((row) => row.id === action.id)).toBe(true);
  });

  it('records actions without a target user', async () => {
    const repo = createModerationRepo(database.db);
    const action = await repo.addAction({
      guildId,
      moderatorId: 'mod-789',
      actionType: 'purge',
      reason: 'channel cleanup',
    });
    expect(action.userId).toBeNull();
  });
});

describe('moderation rules', () => {
  it('creates, updates, toggles and lists rules', async () => {
    const repo = createModerationRepo(database.db);

    const created = await repo.upsertRule({
      guildId,
      ruleType: 'forbidden_words',
      name: 'No bad words',
      config: { words: ['foo'] },
    });
    expect(created.enabled).toBe(false);
    expect(created.guildId).toBe(guildId);

    const updated = await repo.upsertRule({
      id: created.id,
      ruleType: 'forbidden_words',
      name: 'No bad words v2',
      config: { words: ['foo', 'bar'] },
      enabled: true,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('No bad words v2');
    expect(updated.config).toEqual({ words: ['foo', 'bar'] });
    expect(updated.enabled).toBe(true);

    await repo.setRuleEnabled(created.id, false);
    const listed = await repo.listRules();
    const row = listed.find((rule) => rule.id === created.id);
    expect(row).toBeDefined();
    expect(row?.enabled).toBe(false);
  });
});
