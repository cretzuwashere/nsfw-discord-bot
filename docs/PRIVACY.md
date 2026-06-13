# Data Handling & Privacy

This document describes exactly what personal data the bot platform stores, why it is
stored, how users and admins can delete it, and the safeguards built into the system. It
is written for self-hosting operators who need to answer privacy/compliance questions
(GDPR-style data subject requests, deletion, data minimization) about their deployment.

You — the operator running this Docker stack — are the data controller. This platform is
self-hosted: there is no Anthropic/vendor backend, no telemetry, and no third-party data
sharing. All personal data lives in **your** PostgreSQL database and **your** uploads
volume. The claims below are grounded in the source files cited inline.

Schema reference: `packages/database/src/schema.ts`
Audit sink: `packages/database/src/repositories/audit-logs.ts`

---

## 1. What personal data is stored

The platform deliberately stores very little personal data. There is no message-content
archive, no behavioral profiling, and no analytics. Personal data falls into the
categories below.

### 1.1 Platform user cache (`platform_users`)

Defined in `packages/database/src/schema.ts` (`platformUsers`). One row per person the bot
has seen through an adapter (Discord). Fields:

| Column | Contents |
| --- | --- |
| `adapter_key` | e.g. `discord` |
| `external_id` | the platform user id (Discord snowflake) |
| `username` | a **cache** of the user's display name at last sighting |
| `first_seen_at` / `last_seen_at` | timestamps |

This is the only place a username string is persisted. It is a convenience cache so the
admin panel and moderation history can show a name instead of a bare numeric id. It is
**not** an authentication record and holds no credentials. Most other modules reference
people only by `user_external_id` (the opaque platform id), never by name.

### 1.2 Birthdays — opt-in (`birthdays`)

Source: `packages/birthdays-module/src/index.ts`, `repo.ts`; table `birthdays` in the
schema.

Birthdays are **strictly opt-in**. No birthday is ever stored unless the user runs
`/birthday set` themselves. The command description and confirmation reply both state the
opt-in/removal contract (`index.ts`: "Set your birthday (opt-in; you can remove it any
time)" and "Your birthday is saved. Use `/birthday remove` to delete it any time.").

Stored fields (`birthdays` table):

| Column | Personal? | Notes |
| --- | --- | --- |
| `user_external_id` | yes | platform id only, no username |
| `month`, `day` | yes | required |
| `year` | yes — **optional** | nullable; see below |
| `timezone` | low | IANA zone string, defaults `UTC` |
| `visibility` | n/a | `public` / `members` / `private` |

**The birth year is optional and exists only to compute age.** The `/birthday set` option
is labeled "Year (optional — only used for age)" (`index.ts`). If omitted, the row's
`year` column is `NULL` and the system stores a month/day-only birthday. Age is computed
on the fly (`computeAge`) and only when a year is present; the daily announcement passes a
`birthday.age` placeholder *only* if `year` is set (`index.ts`: `age = birthday.year ? computeAge(...) : null`).
No year means no age is ever derived or shown.

`birthday_announcements` stores a dedup record (`guild_id`, `user_external_id`,
`announced_on` date) so a birthday is announced at most once per day. It contains a
platform id and a date string only.

`birthday_settings` is **per-guild configuration** (announcement channel, message, role,
hour), not personal data.

### 1.3 Reminders (`reminders`)

Source: `packages/reminders-module/src/index.ts`, `repo.ts`; table `reminders`.

A reminder is created only when a user runs `/reminder create` (or an admin creates one;
see `created_by_admin`). Stored fields include `user_external_id`, the free-text
`message`, `delivery_type` (`dm`/`channel`), optional `channel_id`, `timezone`, `due_at`,
optional `recurrence_seconds`, and `mention_role_ids`.

The `message` is user-authored free text and may contain whatever the user typed; it is
truncated to 1000 characters on creation (`index.ts`: `truncate(..., 1000)`). Active
reminders per user are capped at 25 (`MAX_PER_USER`). Reminders are the only place where
arbitrary user-supplied text is retained, and only until the reminder fires (one-offs are
deactivated after delivery) or the user removes it.

### 1.4 Moderation records (`warnings`, `moderation_actions`, `moderation_cases`, `automod_violations`)

These tables retain a record of moderation decisions and rule violations. They reference
the affected person by platform id and may contain a moderator-supplied `reason` string:

- `warnings` — `user_id` (FK to `platform_users`), `moderator_id`, `reason`, timestamps,
  optional `revoked_at`.
- `moderation_actions` — `user_id` (nullable, `set null` on user delete), `action_type`,
  `reason`, `metadata`, `expires_at`.
- `moderation_cases` — per-guild numbered cases: `target_user_external_id`,
  `moderator_external_id`, `reason`, `status`, `metadata`.
- `automod_violations` — `user_external_id`, `channel_id`, `rule_type`, `action_taken`,
  optional `detail`.

These are retained as a moderation audit trail. Automod logs the violation type and the
action taken; it does **not** persist the offending message body in the schema (only an
optional short `detail` string).

### 1.5 Platform audit log (`audit_logs`)

Source: `packages/database/src/repositories/audit-logs.ts`; table `audit_logs`.

Every privileged admin action and notable system event is recorded: `actor_type`
(`admin` / `system` / `adapter` / `platform_user`), `actor_id`, `action`, `module_key`,
`severity`, `guild_id`, `target_type`, `target_id`, a JSON `metadata` blob, and a
timestamp. Targets are frequently platform user ids (e.g. `birthday.deleted` records the
affected `userExternalId` as `target_id`). See section 5 for the redaction safeguards
applied to the metadata blob.

### 1.6 What is NOT stored

- **No bot/Discord tokens, passwords, or secrets** are stored in any module table. The
  only credential anywhere in the schema is the admin panel `password_hash` in
  `admin_users`, which is an argon2 hash, never a plaintext password.
- **No message content archive.** The bot does not log channel messages. Automod inspects
  messages in memory and persists only a violation record.
- **No analytics, tracking, or off-host transmission.**
- Audio `playback_history` / `queue_items` store a `requested_by` id and a URL/title but
  are explicitly volatile operational data, and error strings are sanitized
  ("Safe error summary only — never raw stack traces" — schema comment on
  `playback_history.error_message`).

---

## 2. Opt-in & consent model

- **Birthdays are opt-in by user action only.** There is no bulk import and no way for an
  admin to set another member's birthday through the bot. A user must run `/birthday set`.
- **Reminders are created by the requesting user** (or, transparently flagged via
  `created_by_admin`, by an admin).
- Replies to `/birthday set/view/remove` and all `/reminder` subcommands are **ephemeral**
  (`ephemeral: true` throughout `index.ts`), so a user's date or reminder text is shown
  only to that user, never broadcast to the channel.
- Birthday `visibility` (`public` / `members` / `private`) controls listing. `private`
  birthdays are excluded from `/birthday upcoming` and from the admin panel's upcoming
  list (`index.ts` filters `r.visibility !== 'private'`; `apps/admin/src/routes/birthdays.ts`
  applies the same filter).

---

## 3. User-initiated deletion (data subject self-service)

Users can delete their own data from Discord without involving an admin. These are
**hard deletes** (`DELETE`, not soft-flagging).

### Birthday

`/birthday remove` calls `repo.remove(guildId, userExternalId)`, which issues
`db.delete(...)` against the `birthdays` table (`packages/birthdays-module/src/repo.ts` —
"Privacy: hard-delete a user's birthday"). The row is permanently removed and the user is
told "Your birthday has been deleted."

### Reminder

`/reminder list` shows a user's reminders; `/reminder remove id:<first-8-chars>` hard-deletes
the matching reminder via `repo.remove(id, userExternalId)`
(`packages/reminders-module/src/repo.ts`). The delete is scoped to
`userExternalId`, so a user can only delete their **own** reminders — the id alone is not
sufficient to remove someone else's.

---

## 4. Admin-initiated deletion

### Delete a single stored birthday

The admin panel exposes a deletion endpoint for privacy/moderation requests:
`POST /birthdays/delete` (`apps/admin/src/routes/birthdays.ts`). It calls the same
`repo.remove(guildId, userExternalId)` hard-delete used by `/birthday remove`, then writes
an audit entry (`birthday.deleted`, `target_type: user`). The route is protected by
`requireAuth`, `requireMutatingRole`, and `csrfProtection`.

The birthdays page itself lives at `/birthdays` (view `apps/admin/views/birthdays.ejs`).

### Reminders

There is no dedicated admin reminders route in `apps/admin/src/routes`. Operator-side
deletion of a specific user's reminders is done directly against the database (see the
SQL snippets in section 6) or by the user via `/reminder remove`.

### Deleting an entire guild's data (cascade)

Every per-guild table in `packages/database/src/schema.ts` declares its `guild_id` foreign
key with `onDelete: 'cascade'` (and child tables cascade from their parents). The
`guilds` repository intentionally has no delete method
(`packages/database/src/repositories/guilds.ts`), so removing a guild is an operator
database action:

```sql
-- Removes the guild and, via ON DELETE CASCADE, every dependent row:
-- birthdays, birthday_settings, birthday_announcements, reminders,
-- warnings, moderation_actions, moderation_cases, automod_rules/violations,
-- role_menus(+options/logs), welcome_settings, announcements, scheduled_messages,
-- custom_commands, card_templates/assets, module_settings, guild_settings, …
DELETE FROM guilds WHERE id = '<guild-uuid>';
```

Because the cascade is enforced at the schema level, you cannot orphan a guild's personal
data: deleting the guild row removes all of it in one transaction.

**Note on what does *not* cascade from a guild delete:**

- `platform_users` is **not** guild-scoped (it has no `guild_id`), so the username cache
  survives a guild delete. Remove it separately if required (section 6).
- `audit_logs` is an append-only history keyed by string `guild_id` with **no** foreign
  key, so audit entries are deliberately retained when a guild is deleted (they are the
  record of what was done). Purge them separately if your retention policy requires it.
- `moderation_actions.user_id` and `automod_violations.rule_id` use `set null` rather than
  cascade, so deleting a *user* or *rule* nulls the reference but keeps the moderation
  record.

---

## 5. Audit metadata: secret redaction & data minimization

The audit sink defends against secrets ever landing in the audit trail
(`packages/database/src/repositories/audit-logs.ts`, `sanitizeMetadata`):

- The `metadata` object is round-tripped through `JSON.parse(JSON.stringify(...))` to drop
  non-serializable values (functions, class instances) and guarantee it is plain JSON.
- Any top-level key matching `/token|password|secret|authorization/i` is replaced with
  `"[REDACTED]"` before the row is written.
- If serialization fails entirely, the metadata is replaced with
  `{ note: 'metadata was not serializable' }` rather than throwing or storing raw data.
- The `action` string is truncated to 200 characters on insert.

This means even a buggy caller that accidentally passes a token-bearing object into an
audit event cannot persist that secret. Redaction is keyed by field name, so callers
should keep using conventional names (`token`, `password`, `secret`, `authorization`) for
sensitive fields to ensure they are caught.

---

## 6. Operator data-management snippets

Run these against PostgreSQL (in Docker, e.g.
`docker compose exec db psql -U <user> -d <database>`). Always confirm the target id first.

```sql
-- A user's birthday in one guild
DELETE FROM birthdays
WHERE guild_id = '<guild-uuid>' AND user_external_id = '<discord-user-id>';

-- All of a user's reminders (across guilds)
DELETE FROM reminders WHERE user_external_id = '<discord-user-id>';

-- A user's moderation history (warnings keyed by the platform_users uuid)
DELETE FROM warnings WHERE user_id = (
  SELECT id FROM platform_users WHERE external_id = '<discord-user-id>'
);
DELETE FROM moderation_cases WHERE target_user_external_id = '<discord-user-id>';
DELETE FROM automod_violations WHERE user_external_id = '<discord-user-id>';

-- The cached username row for a user
DELETE FROM platform_users WHERE external_id = '<discord-user-id>';

-- Trim the audit log to a retention window (audit rows have no FK cascade)
DELETE FROM audit_logs WHERE created_at < now() - interval '180 days';

-- Everything for one guild (cascades; see section 4)
DELETE FROM guilds WHERE id = '<guild-uuid>';
```

To assemble a full "what do you hold about me" export for a single user, query
`platform_users`, `birthdays`, `reminders`, `warnings`, `moderation_cases`,
`automod_violations`, and `audit_logs WHERE target_id = '<discord-user-id>'`.

---

## 7. Security context relevant to personal data

- **Admin panel** is login-protected: argon2 password hashing, encrypted session cookies,
  CSRF protection, and rate limiting. The deletion endpoints above require an
  authenticated session with a mutating role.
- **Admin actions are audited.** Birthday settings changes and birthday deletions emit
  `birthday.settings.updated` / `birthday.deleted` audit events with the acting admin id.
- **Privileged intents are gated.** `MessageContent` (needed for automod content rules) is
  only requested when `DISCORD_ENABLE_MESSAGE_CONTENT` is enabled
  (`packages/config/src/index.ts`). With it off, automod content scanning runs DEGRADED and
  the bot does not receive message bodies at all — minimizing what personal data the bot
  can even see.

---

## 8. Known limitations & compliance notes

- **Username cache staleness:** `platform_users.username` reflects the name at last
  sighting and is not actively refreshed everywhere; treat it as a hint, not a source of
  truth.
- **Audit log retention is unbounded by default.** There is no automatic pruning job;
  audit rows accumulate until you delete them (section 6). Set a retention policy that fits
  your jurisdiction.
- **Guild delete leaves audit + platform_users behind by design** (section 4). If a "right
  to erasure" request requires removing audit references too, delete them explicitly.
- **Reminder/case `reason`/`message` text is stored verbatim** (within length caps). It can
  contain whatever a user or moderator typed; review before exporting.
- **Backups are out of scope here.** A `DELETE` removes data from the live database but not
  from any PostgreSQL backups/snapshots you maintain. Align backup rotation with your
  retention obligations.
- The bot stores **no payment data, no email** (other than admin-panel login emails in
  `admin_users`), and **no message archives**.
