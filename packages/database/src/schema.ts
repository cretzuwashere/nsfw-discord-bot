import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const adminRole = pgEnum('admin_role', ['owner', 'admin', 'viewer']);

export const actorType = pgEnum('actor_type', ['admin', 'system', 'adapter', 'platform_user']);

export const moderationActionType = pgEnum('moderation_action_type', [
  'warn',
  'mute',
  'unmute',
  'kick',
  'ban',
  'unban',
  'purge',
  'role_assign',
  'other',
]);

export const playbackStatus = pgEnum('playback_status', [
  'playing',
  'completed',
  'skipped',
  'failed',
  'stopped',
]);

// ---------------------------------------------------------------------------
// Admin / auth
// ---------------------------------------------------------------------------

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: adminRole('role').notNull().default('admin'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('admin_users_email_idx').on(table.email)]
);

// ---------------------------------------------------------------------------
// Platform modules
// ---------------------------------------------------------------------------

export const modules = pgTable('modules', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  version: text('version').notNull().default('0.1.0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const moduleSettings = pgTable(
  'module_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    moduleKey: text('module_key')
      .notNull()
      .references(() => modules.key, { onDelete: 'cascade' }),
    /** Null = global default settings for the module. */
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('module_settings_module_guild_idx').on(table.moduleKey, table.guildId)]
);

// ---------------------------------------------------------------------------
// Guilds (servers/communities, adapter-agnostic)
// ---------------------------------------------------------------------------

export const guilds = pgTable(
  'guilds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adapterKey: text('adapter_key').notNull().default('discord'),
    externalId: text('external_id').notNull(),
    name: text('name').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('guilds_adapter_external_idx').on(table.adapterKey, table.externalId)]
);

export const guildSettings = pgTable('guild_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  /** Lowercased domain allowlist; empty = inherit global config. */
  allowedAudioDomains: jsonb('allowed_audio_domains')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Null = inherit global config value. */
  maxQueueSize: integer('max_queue_size'),
  maxTrackDurationSeconds: integer('max_track_duration_seconds'),
  featureFlags: jsonb('feature_flags')
    .$type<Record<string, boolean>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Platform users (people seen through adapters — NOT admin users)
// ---------------------------------------------------------------------------

export const platformUsers = pgTable(
  'platform_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adapterKey: text('adapter_key').notNull().default('discord'),
    externalId: text('external_id').notNull(),
    username: text('username').notNull().default(''),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('platform_users_adapter_external_idx').on(table.adapterKey, table.externalId),
  ]
);

// ---------------------------------------------------------------------------
// Moderation foundation
// ---------------------------------------------------------------------------

export const warnings = pgTable(
  'warnings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    /** External id of the moderator (platform user or admin). */
    moderatorId: text('moderator_id').notNull().default(''),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('warnings_guild_idx').on(table.guildId)]
);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => platformUsers.id, { onDelete: 'set null' }),
    moderatorId: text('moderator_id').notNull().default(''),
    actionType: moderationActionType('action_type').notNull(),
    reason: text('reason').notNull().default(''),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_actions_guild_idx').on(table.guildId),
    index('moderation_actions_created_idx').on(table.createdAt),
  ]
);

export const moderationRules = pgTable(
  'moderation_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Null = applies to all guilds. */
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    /** e.g. 'forbidden_words', 'link_filter', 'spam_protection', 'raid_protection'. */
    ruleType: text('rule_type').notNull(),
    name: text('name').notNull(),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('moderation_rules_guild_idx').on(table.guildId)]
);

/** Maps adapter roles to platform permission keys (foundation for RBAC). */
export const permissionMappings = pgTable(
  'permission_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    /** External role id on the platform (e.g. Discord role snowflake). */
    externalRoleId: text('external_role_id').notNull(),
    /** Platform permission key, e.g. 'moderation.warn', 'audio.control'. */
    permission: text('permission').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('permission_mappings_unique_idx').on(
      table.guildId,
      table.externalRoleId,
      table.permission
    ),
  ]
);

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    guildId: text('guild_id'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_created_idx').on(table.createdAt),
    index('audit_logs_action_idx').on(table.action),
  ]
);

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------

export const playbackHistory = pgTable(
  'playback_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** External guild id (e.g. Discord snowflake) — playback data is volatile. */
    guildExternalId: text('guild_external_id').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    provider: text('provider').notNull().default(''),
    requestedBy: text('requested_by').notNull().default(''),
    status: playbackStatus('status').notNull(),
    /** Safe error summary only — never raw stack traces. */
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('playback_history_guild_idx').on(table.guildExternalId),
    index('playback_history_started_idx').on(table.startedAt),
  ]
);

export const queueItems = pgTable(
  'queue_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildExternalId: text('guild_external_id').notNull(),
    position: integer('position').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    provider: text('provider').notNull().default(''),
    requestedBy: text('requested_by').notNull().default(''),
    durationSeconds: integer('duration_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('queue_items_guild_idx').on(table.guildExternalId)]
);

// ---------------------------------------------------------------------------
// System settings
// ---------------------------------------------------------------------------

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value')
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
