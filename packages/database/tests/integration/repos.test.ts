import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAdminUsersRepo,
  createDatabase,
  createGuildsRepo,
  createModulesRepo,
  createSystemSettingsRepo,
  resolveTestDatabaseUrl,
  schema,
  type Database,
} from '../../src/index.js';

let database: Database;

const createdAdminIds: string[] = [];
const createdModuleKeys: string[] = [];
const createdGuildIds: string[] = [];
const createdSettingKeys: string[] = [];

beforeAll(() => {
  database = createDatabase(resolveTestDatabaseUrl());
});

afterAll(async () => {
  const { db } = database;
  if (createdAdminIds.length > 0) {
    await db.delete(schema.adminUsers).where(inArray(schema.adminUsers.id, createdAdminIds));
  }
  if (createdModuleKeys.length > 0) {
    await db.delete(schema.modules).where(inArray(schema.modules.key, createdModuleKeys));
  }
  if (createdGuildIds.length > 0) {
    // guild_settings rows cascade with the guild.
    await db.delete(schema.guilds).where(inArray(schema.guilds.id, createdGuildIds));
  }
  if (createdSettingKeys.length > 0) {
    await db
      .delete(schema.systemSettings)
      .where(inArray(schema.systemSettings.key, createdSettingKeys));
  }
  await database.close();
});

describe('admin users repo', () => {
  it('creates a user with lowercased email and finds it case-insensitively', async () => {
    const repo = createAdminUsersRepo(database.db);
    const email = `Admin.${randomUUID()}@Example.COM`;

    const created = await repo.create({ email, passwordHash: 'not-a-real-hash', role: 'admin' });
    createdAdminIds.push(created.id);

    expect(created.email).toBe(email.toLowerCase());
    expect(created.role).toBe('admin');

    const found = await repo.findByEmail(email.toUpperCase());
    expect(found?.id).toBe(created.id);
  });

  it('records logins and counts users', async () => {
    const repo = createAdminUsersRepo(database.db);
    const created = await repo.create({
      email: `count.${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
    });
    createdAdminIds.push(created.id);
    expect(created.lastLoginAt).toBeNull();

    await repo.recordLogin(created.id);
    const after = await repo.findById(created.id);
    expect(after?.lastLoginAt).toBeInstanceOf(Date);

    const count = await repo.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe('modules repo', () => {
  it('ensures, lists and toggles modules; missing modules default to enabled', async () => {
    const repo = createModulesRepo(database.db);
    const key = `test-module-${randomUUID()}`;
    createdModuleKeys.push(key);

    // A module never registered counts as enabled.
    await expect(repo.isEnabled(`missing-${randomUUID()}`)).resolves.toBe(true);

    await repo.ensure({ key, name: 'Test Module', description: 'integration test module' });
    const listed = await repo.list();
    expect(listed.some((row) => row.key === key)).toBe(true);
    await expect(repo.isEnabled(key)).resolves.toBe(true);

    const updated = await repo.setEnabled(key, false);
    expect(updated?.enabled).toBe(false);
    await expect(repo.isEnabled(key)).resolves.toBe(false);

    // Re-registering must not overwrite the operator's enabled choice.
    await repo.ensure({ key, name: 'Test Module v2' });
    await expect(repo.isEnabled(key)).resolves.toBe(false);
    const row = await repo.get(key);
    expect(row?.name).toBe('Test Module v2');
  });
});

describe('guilds repo', () => {
  it('upserts the same external id into one row', async () => {
    const repo = createGuildsRepo(database.db);
    const externalId = randomUUID();

    const first = await repo.upsertByExternalId({
      adapterKey: 'discord',
      externalId,
      name: 'First Name',
    });
    createdGuildIds.push(first.id);

    const second = await repo.upsertByExternalId({
      adapterKey: 'discord',
      externalId,
      name: 'Renamed Guild',
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Renamed Guild');
  });

  it('updateSettings inserts then updates without losing earlier fields', async () => {
    const repo = createGuildsRepo(database.db);
    const guild = await repo.upsertByExternalId({ adapterKey: 'discord', externalId: randomUUID() });
    createdGuildIds.push(guild.id);

    const inserted = await repo.updateSettings(guild.id, { maxQueueSize: 25 });
    expect(inserted.guildId).toBe(guild.id);
    expect(inserted.maxQueueSize).toBe(25);

    const updated = await repo.updateSettings(guild.id, { featureFlags: { beta: true } });
    expect(updated.featureFlags).toEqual({ beta: true });
    // Patch semantics: fields not in the second patch are preserved.
    expect(updated.maxQueueSize).toBe(25);

    const fetched = await repo.getById(guild.id);
    expect(fetched?.settings?.maxQueueSize).toBe(25);
    expect(fetched?.settings?.featureFlags).toEqual({ beta: true });
  });
});

describe('system settings repo', () => {
  it('roundtrips get/set/all', async () => {
    const repo = createSystemSettingsRepo(database.db);
    const key = `test.setting.${randomUUID()}`;
    createdSettingKeys.push(key);

    await expect(repo.get(key)).resolves.toBeUndefined();

    await repo.set(key, { hello: 'world', count: 3 });
    await expect(repo.get(key)).resolves.toEqual({ hello: 'world', count: 3 });

    await repo.set(key, { hello: 'again' });
    await expect(repo.get(key)).resolves.toEqual({ hello: 'again' });

    const all = await repo.all();
    const row = all.find((entry) => entry.key === key);
    expect(row?.value).toEqual({ hello: 'again' });
  });
});
