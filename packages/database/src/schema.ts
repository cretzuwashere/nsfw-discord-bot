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

export const auditSeverity = pgEnum('audit_severity', ['info', 'notice', 'warning', 'critical']);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    /** Module the event belongs to (e.g. 'announcements'); null = platform-level. */
    moduleKey: text('module_key'),
    severity: auditSeverity('severity').notNull().default('info'),
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
    index('audit_logs_module_idx').on(table.moduleKey),
    index('audit_logs_severity_idx').on(table.severity),
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

// ===========================================================================
// Community management modules
// ===========================================================================

export const announcementStatus = pgEnum('announcement_status', [
  'draft',
  'scheduled',
  'sent',
  'failed',
  'canceled',
]);

export const scheduleType = pgEnum('schedule_type', [
  'once',
  'interval',
  'daily',
  'weekly',
  'monthly',
  'cron',
]);

export const roleMenuType = pgEnum('role_menu_type', ['reaction', 'button', 'select']);

export const roleMenuMode = pgEnum('role_menu_mode', [
  'multiple',
  'single',
  'toggle',
  'add_only',
  'remove_only',
  'unique', // replace role from group
]);

export const moderationCaseStatus = pgEnum('moderation_case_status', [
  'open',
  'resolved',
  'expired',
  'revoked',
]);

export const automodRuleType = pgEnum('automod_rule_type', [
  'banned_words',
  'spam',
  'repeated_messages',
  'mention_spam',
  'caps',
  'invite_links',
  'suspicious_links',
  'attachments',
  'new_account',
  'raid',
]);

export const automodAction = pgEnum('automod_action', [
  'log_only',
  'delete',
  'warn',
  'timeout',
  'mute',
  'kick',
  'ban',
]);

export const customCommandResponseType = pgEnum('custom_command_response_type', [
  'text',
  'embed',
  'random',
  'link',
]);

// --- Announcements ---------------------------------------------------------

/** Drafts, scheduled and sent announcements (lifecycle in `status`). */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    /** 'plain' | 'embed'. */
    format: text('format').notNull().default('plain'),
    targetChannelId: text('target_channel_id'),
    imageUrl: text('image_url'),
    cardTemplateId: uuid('card_template_id'),
    embedColor: text('embed_color'),
    footer: text('footer'),
    /** 'none' | 'here' | 'everyone' | 'roles'. */
    mentionMode: text('mention_mode').notNull().default('none'),
    mentionRoleIds: jsonb('mention_role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    buttons: jsonb('buttons').notNull().default(sql`'[]'::jsonb`),
    status: announcementStatus('status').notNull().default('draft'),
    /** True for reusable templates (not delivered). */
    isTemplate: boolean('is_template').notNull().default(false),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentMessageId: text('sent_message_id'),
    failureReason: text('failure_reason'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('announcements_guild_idx').on(table.guildId),
    index('announcements_status_idx').on(table.status),
    index('announcements_scheduled_idx').on(table.scheduledFor),
  ]
);

// --- Dynamic cards ---------------------------------------------------------

/** Reusable image templates (welcome cards, birthday cards, banners …). */
export const cardTemplates = pgTable(
  'card_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Null = global template available to all guilds. */
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** 'welcome' | 'birthday' | 'announcement' | 'role_unlock' | 'event' | 'generic'. */
    kind: text('kind').notNull().default('generic'),
    width: integer('width').notNull().default(1000),
    height: integer('height').notNull().default(420),
    /** Layout spec: background, text layers, avatar placement, fonts. Sanitized. */
    layout: jsonb('layout').notNull().default(sql`'{}'::jsonb`),
    backgroundAssetId: uuid('background_asset_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('card_templates_guild_idx').on(table.guildId)]
);

/** Uploaded background images and other card assets (stored on disk volume). */
export const cardAssets = pgTable(
  'card_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    /** Relative path within the uploads volume — never an absolute host path. */
    storagePath: text('storage_path').notNull(),
    originalName: text('original_name').notNull().default(''),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('card_assets_guild_idx').on(table.guildId)]
);

// --- Welcome / leave -------------------------------------------------------

export const welcomeSettings = pgTable('welcome_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  welcomeEnabled: boolean('welcome_enabled').notNull().default(false),
  leaveEnabled: boolean('leave_enabled').notNull().default(false),
  welcomeChannelId: text('welcome_channel_id'),
  leaveChannelId: text('leave_channel_id'),
  welcomeMessage: text('welcome_message').notNull().default('Welcome {{user.mention}} to {{server.name}}!'),
  leaveMessage: text('leave_message').notNull().default('{{user.username}} has left the server.'),
  welcomeCardTemplateId: uuid('welcome_card_template_id'),
  dmEnabled: boolean('dm_enabled').notNull().default(false),
  dmMessage: text('dm_message').notNull().default(''),
  autoRoleIds: jsonb('auto_role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  rulesChannelId: text('rules_channel_id'),
  delaySeconds: integer('delay_seconds').notNull().default(0),
  logChannelId: text('log_channel_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Self-assignable roles -------------------------------------------------

export const roleMenus = pgTable(
  'role_menus',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: roleMenuType('type').notNull().default('button'),
    mode: roleMenuMode('mode').notNull().default('multiple'),
    channelId: text('channel_id'),
    messageId: text('message_id'),
    /** 'plain' | 'embed' | 'card'. */
    style: text('style').notNull().default('embed'),
    title: text('title').notNull().default('Select your roles'),
    description: text('description').notNull().default(''),
    /** Mode constraints: maxSelections, requiredRoleId, blockedRoleId, tempDurationSeconds. */
    constraints: jsonb('constraints').notNull().default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('role_menus_guild_idx').on(table.guildId),
    index('role_menus_message_idx').on(table.messageId),
  ]
);

export const roleMenuOptions = pgTable(
  'role_menu_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => roleMenus.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    label: text('label').notNull().default(''),
    description: text('description').notNull().default(''),
    emoji: text('emoji'),
    position: integer('position').notNull().default(0),
  },
  (table) => [index('role_menu_options_menu_idx').on(table.menuId)]
);

export const roleAssignmentLogs = pgTable(
  'role_assignment_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    menuId: uuid('menu_id').references(() => roleMenus.id, { onDelete: 'set null' }),
    userExternalId: text('user_external_id').notNull(),
    roleId: text('role_id').notNull(),
    /** 'added' | 'removed'. */
    action: text('action').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('role_assignment_logs_guild_idx').on(table.guildId)]
);

// --- Birthdays & reminders -------------------------------------------------

/** Opt-in only. Year optional (month/day-only birthdays supported). */
export const birthdays = pgTable(
  'birthdays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    month: integer('month').notNull(),
    day: integer('day').notNull(),
    year: integer('year'),
    timezone: text('timezone').notNull().default('UTC'),
    /** 'public' | 'members' | 'private'. */
    visibility: text('visibility').notNull().default('members'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('birthdays_guild_user_idx').on(table.guildId, table.userExternalId),
    index('birthdays_month_day_idx').on(table.month, table.day),
  ]
);

export const birthdaySettings = pgTable('birthday_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  announcementChannelId: text('announcement_channel_id'),
  message: text('message').notNull().default('🎉 Happy birthday {{user.mention}}!'),
  cardTemplateId: uuid('card_template_id'),
  roleEnabled: boolean('role_enabled').notNull().default(false),
  roleId: text('role_id'),
  roleDurationHours: integer('role_duration_hours').notNull().default(24),
  announceHour: integer('announce_hour').notNull().default(9),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const birthdayAnnouncements = pgTable(
  'birthday_announcements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    announcedOn: text('announced_on').notNull(), // YYYY-MM-DD in the guild's processing
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('birthday_announcements_unique_idx').on(
      table.guildId,
      table.userExternalId,
      table.announcedOn
    ),
  ]
);

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    /** 'dm' | 'channel'. */
    deliveryType: text('delivery_type').notNull().default('dm'),
    channelId: text('channel_id'),
    message: text('message').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** Null = one-off; otherwise interval in seconds for recurrence. */
    recurrenceSeconds: integer('recurrence_seconds'),
    mentionRoleIds: jsonb('mention_role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    createdByAdmin: boolean('created_by_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('reminders_due_idx').on(table.dueAt),
    index('reminders_user_idx').on(table.userExternalId),
  ]
);

// --- Scheduled messages ----------------------------------------------------

export const scheduledMessages = pgTable(
  'scheduled_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default(''),
    channelId: text('channel_id').notNull(),
    content: text('content').notNull().default(''),
    /** 'plain' | 'embed'. */
    format: text('format').notNull().default('plain'),
    embedConfig: jsonb('embed_config').notNull().default(sql`'{}'::jsonb`),
    mentionMode: text('mention_mode').notNull().default('none'),
    mentionRoleIds: jsonb('mention_role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    scheduleType: scheduleType('schedule_type').notNull().default('once'),
    /** cron expr / interval seconds / time-of-day, depending on scheduleType. */
    scheduleConfig: jsonb('schedule_config').notNull().default(sql`'{}'::jsonb`),
    timezone: text('timezone').notNull().default('UTC'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    paused: boolean('paused').notNull().default(false),
    lastFailureReason: text('last_failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('scheduled_messages_guild_idx').on(table.guildId),
    index('scheduled_messages_next_run_idx').on(table.nextRunAt),
  ]
);

export const scheduledMessageRuns = pgTable(
  'scheduled_message_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scheduledMessageId: uuid('scheduled_message_id')
      .notNull()
      .references(() => scheduledMessages.id, { onDelete: 'cascade' }),
    /** 'sent' | 'failed' | 'skipped'. */
    status: text('status').notNull(),
    detail: text('detail'),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scheduled_message_runs_msg_idx').on(table.scheduledMessageId)]
);

// --- Moderation cases ------------------------------------------------------

/** A numbered moderation case per guild (case_number is per-guild sequential). */
export const moderationCases = pgTable(
  'moderation_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    caseNumber: integer('case_number').notNull(),
    actionType: moderationActionType('action_type').notNull(),
    targetUserExternalId: text('target_user_external_id').notNull(),
    moderatorExternalId: text('moderator_external_id').notNull().default(''),
    reason: text('reason').notNull().default(''),
    status: moderationCaseStatus('status').notNull().default('open'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('moderation_cases_guild_number_idx').on(table.guildId, table.caseNumber),
    index('moderation_cases_target_idx').on(table.guildId, table.targetUserExternalId),
    index('moderation_cases_created_idx').on(table.createdAt),
  ]
);

export const moderationSettings = pgTable('moderation_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  logChannelId: text('log_channel_id'),
  /** 'timeout' (native) | 'role'. */
  muteStrategy: text('mute_strategy').notNull().default('timeout'),
  muteRoleId: text('mute_role_id'),
  dmOnAction: boolean('dm_on_action').notNull().default(true),
  /** Per-command enablement + required permission overrides. */
  commandConfig: jsonb('command_config').notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Auto-moderation -------------------------------------------------------

export const automodRules = pgTable(
  'automod_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ruleType: automodRuleType('rule_type').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** type-specific: word list, thresholds, timeframe seconds, link allowlist… */
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    action: automodAction('action').notNull().default('log_only'),
    severity: integer('severity').notNull().default(1),
    ignoredChannelIds: jsonb('ignored_channel_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    ignoredRoleIds: jsonb('ignored_role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Escalate after N violations within the timeframe. */
    escalationThreshold: integer('escalation_threshold'),
    escalationAction: automodAction('escalation_action'),
    responseMessage: text('response_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('automod_rules_guild_idx').on(table.guildId)]
);

export const automodViolations = pgTable(
  'automod_violations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id').references(() => automodRules.id, { onDelete: 'set null' }),
    userExternalId: text('user_external_id').notNull(),
    channelId: text('channel_id'),
    ruleType: automodRuleType('rule_type').notNull(),
    actionTaken: automodAction('action_taken').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('automod_violations_guild_idx').on(table.guildId),
    index('automod_violations_user_idx').on(table.guildId, table.userExternalId),
  ]
);

// --- Custom commands -------------------------------------------------------

export const customCommands = pgTable(
  'custom_commands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    /** Invocation name without prefix (slash) — unique per guild. */
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    responseType: customCommandResponseType('response_type').notNull().default('text'),
    /** text/embed/link config or a list of responses for 'random'. */
    response: jsonb('response').notNull().default(sql`'{}'::jsonb`),
    allowedRoleIds: jsonb('allowed_role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    allowedChannelIds: jsonb('allowed_channel_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
    useCount: integer('use_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('custom_commands_guild_name_idx').on(table.guildId, table.name)]
);

// --- Speaker queue (raise hand) --------------------------------------------

/** One queue per (guild, voice channel). Holds the persistent panel refs. */
export const speakerQueues = pgTable(
  'speaker_queues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    /** Discord voice channel snowflake the queue is scoped to. */
    voiceChannelId: text('voice_channel_id').notNull(),
    /** Cached channel name for rendering the panel without an extra fetch. */
    voiceChannelName: text('voice_channel_name').notNull().default(''),
    /** Persistent control-panel message location (null until /speaker-panel). */
    panelChannelId: text('panel_channel_id'),
    panelMessageId: text('panel_message_id'),
    /** Where "next to speak" announcements post (defaults to the panel channel). */
    announceChannelId: text('announce_channel_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('speaker_queues_guild_channel_idx').on(table.guildId, table.voiceChannelId)]
);

/** One raised hand. status: 'waiting' | 'active' | 'done'. */
export const speakerQueueEntries = pgTable(
  'speaker_queue_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => speakerQueues.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    displayName: text('display_name').notNull().default(''),
    /** 'waiting' | 'active' | 'done'. */
    status: text('status').notNull().default('waiting'),
    /** Higher = closer to the front; moderator /promote-speaker raises it. */
    priority: integer('priority').notNull().default(0),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('speaker_queue_entries_queue_idx').on(table.queueId),
    // A user holds at most ONE live (non-done) entry per queue (dedupe).
    uniqueIndex('speaker_queue_entries_active_user_idx')
      .on(table.queueId, table.userExternalId)
      .where(sql`status <> 'done'`),
  ]
);

// --- Engagement prompts (QOTD / WYR / party games) -------------------------

/** One row per guild: daily QOTD config + recent-prompt ring buffers. */
export const promptSettings = pgTable('prompt_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  /** Channel the daily Question of the Day posts to (null = daily off). */
  qotdChannelId: text('qotd_channel_id'),
  qotdEnabled: boolean('qotd_enabled').notNull().default(false),
  /** UTC hour (0-23) the daily QOTD posts at. */
  qotdHourUtc: integer('qotd_hour_utc').notNull().default(12),
  /** 'YYYY-MM-DD' (UTC) of the last daily post, for once-per-day dedup. */
  lastQotdDate: text('last_qotd_date'),
  /** category -> recently-used prompt indices (ring buffer, avoids repeats). */
  recent: jsonb('recent')
    .$type<Record<string, number[]>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Giveaways -------------------------------------------------------------

/** A giveaway. status: 'active' | 'ended' | 'canceled'. */
export const giveaways = pgTable(
  'giveaways',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    /** Set after the giveaway message is posted. */
    messageId: text('message_id'),
    prize: text('prize').notNull(),
    winnersCount: integer('winners_count').notNull().default(1),
    hostExternalId: text('host_external_id').notNull(),
    status: text('status').notNull().default('active'),
    /** Drawn winner external ids (filled at draw / reroll). */
    winners: jsonb('winners').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('giveaways_guild_idx').on(table.guildId),
    index('giveaways_due_idx').on(table.status, table.endsAt),
  ]
);

/** One entry per user per giveaway (unique). */
export const giveawayEntries = pgTable(
  'giveaway_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    giveawayId: uuid('giveaway_id')
      .notNull()
      .references(() => giveaways.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('giveaway_entries_unique_idx').on(table.giveawayId, table.userExternalId),
  ]
);

// --- Server stats (message-activity counts, no content) --------------------

/** Per-user per-day message counts (UTC date as 'YYYY-MM-DD' text). */
export const activityUserDaily = pgTable(
  'activity_user_daily',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    date: text('date').notNull(),
    messages: integer('messages').notNull().default(0),
  },
  (table) => [
    uniqueIndex('activity_user_daily_unique_idx').on(table.guildId, table.userExternalId, table.date),
    index('activity_user_daily_guild_date_idx').on(table.guildId, table.date),
  ]
);

/** Per-channel per-day message counts. */
export const activityChannelDaily = pgTable(
  'activity_channel_daily',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    date: text('date').notNull(),
    messages: integer('messages').notNull().default(0),
  },
  (table) => [
    uniqueIndex('activity_channel_daily_unique_idx').on(table.guildId, table.channelId, table.date),
    index('activity_channel_daily_guild_date_idx').on(table.guildId, table.date),
  ]
);

/** Per-guild weekly-recap configuration. */
export const serverStatsSettings = pgTable('serverstats_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  recapChannelId: text('recap_channel_id'),
  recapEnabled: boolean('recap_enabled').notNull().default(false),
  /** Day of week 0=Sun..6=Sat. */
  recapDow: integer('recap_dow').notNull().default(1),
  recapHourUtc: integer('recap_hour_utc').notNull().default(12),
  lastRecapDate: text('last_recap_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Trivia ----------------------------------------------------------------

/** A trivia round in a channel. status: 'open' | 'resolved'. */
export const triviaRounds = pgTable(
  'trivia_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    /** Index into the bundled question bank. */
    questionIndex: integer('question_index').notNull(),
    correctIndex: integer('correct_index').notNull(),
    status: text('status').notNull().default('open'),
    winnerExternalId: text('winner_external_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trivia_rounds_guild_status_idx').on(table.guildId, table.status),
    index('trivia_rounds_channel_idx').on(table.channelId, table.status),
  ]
);

/** One answer per user per round (unique) — prevents re-answering. */
export const triviaAnswers = pgTable(
  'trivia_answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => triviaRounds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    correct: boolean('correct').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('trivia_answers_round_user_idx').on(table.roundId, table.userExternalId)]
);

/** Per-guild win totals. */
export const triviaScores = pgTable(
  'trivia_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    wins: integer('wins').notNull().default(0),
  },
  (table) => [uniqueIndex('trivia_scores_guild_user_idx').on(table.guildId, table.userExternalId)]
);

/** Per-guild auto-trivia config + recent-question ring. */
export const triviaSettings = pgTable('trivia_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  autoChannelId: text('auto_channel_id'),
  autoEnabled: boolean('auto_enabled').notNull().default(false),
  autoIntervalMin: integer('auto_interval_min').notNull().default(360),
  lastAutoAt: timestamp('last_auto_at', { withTimezone: true }),
  recent: jsonb('recent').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Mini-games (PvP: tic-tac-toe, connect four) ---------------------------

/** A two-player board game session. game: 'ttt'|'c4'; status: 'pending'|'active'|'finished'|'expired'. */
export const minigameSessions = pgTable(
  'minigame_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    messageId: text('message_id'),
    game: text('game').notNull(),
    /** Challenger (plays first, mark X / 1). */
    playerX: text('player_x').notNull(),
    /** Challenged player (mark O / 2). */
    playerO: text('player_o').notNull(),
    /** Flat board: 0 empty, 1 X, 2 O. */
    board: jsonb('board').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    /** Whose turn: 'X' | 'O'. */
    turn: text('turn').notNull().default('X'),
    status: text('status').notNull().default('pending'),
    /** 'X' | 'O' | 'draw' | null. */
    winner: text('winner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('minigame_sessions_status_idx').on(table.status),
    index('minigame_sessions_guild_idx').on(table.guildId),
  ]
);

// --- Economy (virtual currency, no real money) -----------------------------

/** Per-member currency account (+ daily-claim state). */
export const economyAccounts = pgTable(
  'economy_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    balance: integer('balance').notNull().default(0),
    /** 'YYYY-MM-DD' (UTC) of the last /daily claim. */
    lastDailyDate: text('last_daily_date'),
    streak: integer('streak').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('economy_accounts_guild_user_idx').on(table.guildId, table.userExternalId),
    index('economy_accounts_guild_balance_idx').on(table.guildId, table.balance),
  ]
);

/** Append-only ledger of every balance change (audit + anti-abuse). */
export const economyTransactions = pgTable(
  'economy_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('economy_transactions_guild_user_idx').on(table.guildId, table.userExternalId)]
);

/** Per-guild currency cosmetics + daily/streak tuning. */
export const economySettings = pgTable('economy_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  currencyName: text('currency_name').notNull().default('coins'),
  currencyEmoji: text('currency_emoji').notNull().default('🪙'),
  startingBalance: integer('starting_balance').notNull().default(0),
  dailyAmount: integer('daily_amount').notNull().default(100),
  dailyStreakBonus: integer('daily_streak_bonus').notNull().default(10),
  dailyStreakCap: integer('daily_streak_cap').notNull().default(30),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A purchasable shop item (role/perk). */
export const shopItems = pgTable(
  'shop_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('role'),
    roleId: text('role_id').notNull(),
    label: text('label').notNull().default(''),
    price: integer('price').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('shop_items_guild_idx').on(table.guildId)]
);

/** Record of a completed purchase. */
export const shopPurchases = pgTable(
  'shop_purchases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    itemId: uuid('item_id').references(() => shopItems.id, { onDelete: 'set null' }),
    pricePaid: integer('price_paid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('shop_purchases_guild_user_idx').on(table.guildId, table.userExternalId)]
);

// --- Levels (count-based XP + leaderboards) --------------------------------

/** Per-member XP/level state (XP earned from message activity, not content). */
export const levelMembers = pgTable(
  'level_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userExternalId: text('user_external_id').notNull(),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(0),
    messages: integer('messages').notNull().default(0),
    lastAwardAt: timestamp('last_award_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('level_members_guild_user_idx').on(table.guildId, table.userExternalId),
    index('level_members_guild_xp_idx').on(table.guildId, table.xp),
  ]
);

/** Level → reward role mapping (granted on reaching the level). */
export const levelRewards = pgTable(
  'level_rewards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    roleId: text('role_id').notNull(),
  },
  (table) => [uniqueIndex('level_rewards_guild_level_idx').on(table.guildId, table.level)]
);

/** Per-guild leveling configuration. */
export const levelSettings = pgTable('level_settings', {
  guildId: uuid('guild_id')
    .primaryKey()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  /** Null = announce in the channel where the level-up happened. */
  announceChannelId: text('announce_channel_id'),
  levelUpMessage: text('level_up_message').notNull().default('🎉 {user} reached level **{level}**!'),
  noXpChannelIds: jsonb('no_xp_channel_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  xpMin: integer('xp_min').notNull().default(15),
  xpMax: integer('xp_max').notNull().default(25),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(60),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
