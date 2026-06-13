# Birthdays & Reminders

This document covers two member-facing modules that revolve around personal,
time-based data:

- **Birthdays** — opt-in birthday tracking with a timezone-aware daily
  announcement, optional temporary role, and an admin settings page.
- **Reminders** — personal "remind me later" reminders delivered by DM or in a
  channel, with optional recurrence.

Both modules store personal data about individual members, so privacy matters.
See [PRIVACY.md](./PRIVACY.md) for the platform-wide data-handling policy. Every
section below notes what is stored, who can see it, and how a member or admin
can delete it.

Source files:

- Birthdays: `packages/birthdays-module/src/index.ts`,
  `packages/birthdays-module/src/repo.ts`,
  `packages/birthdays-module/src/date-logic.ts`
- Reminders: `packages/reminders-module/src/index.ts`,
  `packages/reminders-module/src/repo.ts`,
  `packages/reminders-module/src/duration.ts`
- Registration: `apps/bot/src/main.ts`
- Admin (birthdays only): `apps/admin/src/routes/birthdays.ts`,
  `apps/admin/views/birthdays.ejs`
- Schema: `packages/database/src/schema.ts`

---

## Birthdays

### What it does

The birthdays module lets members **opt in** by saving their own birthday. A
scheduled job announces the day's birthdays in a configured channel at a
configured hour, optionally pinging the user and granting a temporary role.

Key design points (from `packages/birthdays-module/src/index.ts`):

- **Opt-in only.** The bot never reads or guesses a birthday. The only way a
  birthday gets stored is the member running `/birthday set`.
- **Month/day are required; year is optional.** The year is used *only* to
  compute age for the `{{birthday.age}}` placeholder. Members who do not want to
  reveal their age simply omit it.
- **Per-user timezone.** Each birthday stores its own IANA timezone so the day
  is matched correctly across the world. Invalid timezones fall back to `UTC`.
- **De-duplicated announcements.** A `(guild, user, date)` row in
  `birthday_announcements` guarantees a member is announced at most once per day,
  even though the job ticks every 5 minutes.

### Required permissions & intents

Declared in the module metadata (`packages/birthdays-module/src/index.ts`):

- **Discord permissions:** `SendMessages` (post the announcement),
  `ManageRoles` (grant the optional birthday role).
- **Gateway intents:** `Guilds`.

> Note: granting roles requires the bot's own role to sit **above** the birthday
> role in the server's role hierarchy, and to hold the `Manage Roles`
> permission. If the role grant fails it is swallowed (the announcement still
> goes out).

### Slash commands

Top-level command `/birthday` (guild-only). Subcommands:

| Subcommand | Options | Behavior |
| --- | --- | --- |
| `/birthday set` | `month` (integer, **required**, 1–12), `day` (integer, **required**, 1–31), `year` (integer, optional), `timezone` (string, optional, IANA e.g. `Europe/Bucharest`) | Stores/updates your birthday. Validates the month/day (Feb 29 is allowed). Invalid timezones fall back to `UTC`. Replies ephemerally. |
| `/birthday view` | — | Shows your saved birthday (`M/D[ year] (timezone)`), or a note that none is set. Ephemeral. |
| `/birthday remove` | — | Hard-deletes your birthday row. Ephemeral. |
| `/birthday upcoming` | — | Lists up to 15 stored birthdays in the server as `mention — M/D`, excluding rows whose visibility is `private`. Ephemeral. |

All replies are **ephemeral** (only the invoking member sees them).

### The daily announcement job

Job name `birthdays.announce` (registered in `apps/bot/src/main.ts`). It ticks
every 5 minutes; the per-hour, per-day gate handles deduplication:

1. Loads all guilds with `enabled = true` birthday settings.
2. For each guild, checks whether the **current UTC hour** equals the
   configured `announceHour`. If not, it skips (returns no date key).
3. Computes "today" (month/day) in UTC and finds matching birthdays.
4. For each match, atomically inserts a `birthday_announcements` row. If the row
   already existed (already announced today), it skips.
5. Sends the configured `message` to `announcementChannelId`, applying
   placeholders, and mentions only the birthday user.
6. If `roleEnabled` and `roleId` are set, adds the role to the member.
7. Records a `birthday.announced` audit event (system actor).

> Known limitation — announce-hour timezone. Although each birthday stores its
> own timezone, the announcement **gate** is evaluated against the configured
> hour **in UTC** (see `announcementDateKey('UTC', ...)` and `localMonthDay('UTC', ...)`
> in `index.ts`). In practice this means a server-wide announce hour in UTC, and
> the day boundary is UTC. Per-member-timezone *delivery timing* is not yet
> wired up even though the data is captured. Set `announceHour` accordingly.

### Placeholders available in the message

Resolved via `@botplatform/shared` `applyPlaceholders` /
`buildPlaceholderData`. The announcement populates:

- `{{user.mention}}` — pings the birthday member.
- `{{server.name}}`.
- `{{birthday.age}}` — only present when the member saved a `year`; otherwise the
  placeholder resolves to nothing.

The default message is `🎉 Happy birthday {{user.mention}}!`.

### Configuring it in the admin panel

Page: **`/birthdays`** (`apps/admin/src/routes/birthdays.ts`,
`apps/admin/views/birthdays.ejs`). Pick the server from the dropdown, then set:

| Field | Maps to | Notes |
| --- | --- | --- |
| Enable birthday announcements | `enabled` | Master on/off for the scheduler. |
| Announcement channel ID | `announcementChannelId` | Channel where birthdays post. Required for any announcement to fire. |
| Message | `message` | Supports `{{user.mention}}`, `{{birthday.age}}`, `{{server.name}}`. |
| Birthday card template | `cardTemplateId` | Optional dynamic-card template (from the cards module). |
| Announce hour (0–23, UTC) | `announceHour` | Clamped to 0–23; default 9. Evaluated in UTC. |
| Give a temporary birthday role | `roleEnabled` | Toggles the role grant. |
| Birthday role ID | `roleId` | The role to grant. |
| Role duration (hours) | `roleDurationHours` | Clamped to 1–168; default 24. |

The page also lists **stored birthdays** (excluding `private` visibility, up to
25) with a **Delete** button per member for moderation/privacy removal.

Admin mutations require auth, a mutating role, and a valid CSRF token
(`requireAuth`, `requireMutatingRole`, `csrfProtection`).

### Database tables

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `birthdays` | One row per member who opted in | `guild_id`, `user_external_id`, `month`, `day`, `year` (nullable), `timezone` (default `UTC`), `visibility` (`public`/`members`/`private`, default `members`). Unique on `(guild_id, user_external_id)`. |
| `birthday_settings` | One row per guild | `enabled`, `announcement_channel_id`, `message`, `card_template_id`, `role_enabled`, `role_id`, `role_duration_hours` (default 24), `announce_hour` (default 9). PK is `guild_id`. |
| `birthday_announcements` | De-dup ledger | `guild_id`, `user_external_id`, `announced_on` (`YYYY-MM-DD`). Unique on `(guild_id, user_external_id, announced_on)`. |

All three cascade-delete with their guild.

### Audit events

| Event | Actor | Emitted when |
| --- | --- | --- |
| `birthday.announced` | `system` | A birthday announcement is sent (per member, per day). |
| `birthday.settings.updated` | `admin` | An admin saves the settings form. |
| `birthday.deleted` | `admin` | An admin deletes a stored birthday from the panel. |

(The first is declared by the module; the latter two are emitted by the admin
route.)

### Privacy & security notes

- **Opt-in, member-controlled.** A member adds their own birthday and can delete
  it any time with `/birthday remove` — a true hard delete (`DELETE`, not a
  flag).
- **Age is optional.** Omitting the year means no age is ever computed or shown.
- **Visibility.** Rows marked `private` are excluded from `/birthday upcoming`
  and from the admin "stored birthdays" list. (The current `/birthday set` flow
  defaults new rows to `members` visibility.)
- **Admin deletion.** Admins can remove any stored birthday from `/birthdays`,
  which is audited as `birthday.deleted`.
- See [PRIVACY.md](./PRIVACY.md) for retention and data-subject details.

---

## Reminders

### What it does

The reminders module gives every member personal "remind me later" reminders.
Each reminder fires once at its due time (or repeats on an interval) and is
delivered either by **DM** or **in a channel**. There is no admin UI — reminders
are entirely user-driven.

Key design points (from `packages/reminders-module/src/index.ts`):

- **Human-friendly durations.** `30m`, `2h`, `1d 6h`, or a bare number (treated
  as minutes).
- **DM by default, channel on request.** Add `here: true` to post in the current
  channel instead of a DM.
- **Optional recurrence.** Provide `repeat` to re-arm the reminder on an interval
  after each delivery.
- **Per-user cap.** A member may hold at most **25** active reminders.

### Required permissions & intents

Declared in the module metadata (`packages/reminders-module/src/index.ts`):

- **Discord permissions:** `SendMessages`.
- **Gateway intents:** `Guilds`.

> DM delivery depends on the target member allowing DMs from server members. If
> a DM cannot be sent, the delivery silently fails for that tick (see limitations
> below).

### Slash commands

Top-level command `/reminder` (guild-only). Subcommands:

| Subcommand | Options | Behavior |
| --- | --- | --- |
| `/reminder create` | `message` (string, **required**), `when` (string, **required**, e.g. `30m`, `2h`, `1d 6h`), `here` (boolean, optional — post in this channel instead of DM), `repeat` (string, optional — interval like `1d`) | Parses `when`; rejects unparseable input. Enforces the 25-active cap. Stores the reminder (message truncated to 1000 chars). Replies ephemerally with `(here)`/`(DM)` and whether it repeats. |
| `/reminder list` | — | Lists your active reminders as `<id8> YYYY-MM-DD HH:MM — message` (message truncated to 60 chars; up to 50). Ephemeral. |
| `/reminder remove` | `id` (string, **required**, first 8 chars of the reminder id) | Removes the first active reminder whose id starts with the provided prefix, scoped to you. Ephemeral. |

All replies are **ephemeral**.

### Duration parsing

Implemented in `packages/reminders-module/src/duration.ts` (`parseDuration`):

- Accepts unit tokens: `s`/`sec`, `m`/`min`, `h`/`hr`, `d`, `w`. Multiple tokens
  combine, e.g. `1d 6h` = 30 hours.
- A bare integer (e.g. `90`) is interpreted as **minutes**.
- The result is clamped to a **minimum of 60 seconds** and a **maximum of 1
  year** (365 days).
- Unparseable input returns `null`, and `/reminder create` rejects it with a
  hint.

`repeat` is parsed the same way; a valid value becomes the recurrence interval.

### The delivery job

Job name `reminders.deliver-due` (registered in `apps/bot/src/main.ts`). It
ticks every **30 seconds**:

1. Loads active reminders whose `due_at <= now` (up to 50 per tick).
2. For each, builds the text `⏰ Reminder: <message>`.
3. **Channel delivery** (`delivery_type = 'channel'` with a `channel_id`): posts
   `<@user> ⏰ Reminder: …`, optionally prefixed with role mentions, allowing only
   the listed user/role mentions.
4. **DM delivery** (default): sends the text via direct message.
5. If the guild's bot service is unavailable (bot offline), the reminder is left
   active and retried next tick.
6. **Recurring** reminders (`recurrence_seconds > 0`) are rescheduled to
   `now + recurrence_seconds`; one-off reminders are deactivated (`active = false`).
7. On a successful send, records a `reminder.delivered` audit event.

> Note: rescheduling/deactivation happens whenever the bot service is online,
> even if the individual message send failed (e.g. closed DMs). The audit event
> is only recorded on a successful send.

### Database table

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `reminders` | One row per reminder | `id` (uuid), `guild_id` (nullable, cascade-delete), `user_external_id`, `delivery_type` (`dm`/`channel`, default `dm`), `channel_id`, `message`, `timezone` (default `UTC`), `due_at`, `recurrence_seconds` (null = one-off), `mention_role_ids` (jsonb array), `active` (default true), `created_by_admin` (default false). Indexed on `due_at` and `user_external_id`. |

> The schema includes `timezone`, `mention_role_ids`, and `created_by_admin`
> columns for forward compatibility; the current `/reminder create` flow does not
> set `mention_role_ids` (so channel reminders post without extra role pings) and
> always creates user-authored reminders.

### Audit events

| Event | Actor | Emitted when |
| --- | --- | --- |
| `reminder.delivered` | `system` | A reminder message was successfully sent. |

### Privacy & security notes

- **Member-scoped.** `/reminder list` and `/reminder remove` only ever show or
  touch the invoking member's own reminders (`remove` is filtered by
  `user_external_id`).
- **Hard delete.** `/reminder remove` deletes the row outright.
- **No admin reminder UI.** There is no admin page for reminders; they are fully
  user-driven.
- **Message content is stored** (truncated to 1000 chars) until the reminder is
  delivered (one-off) or removed. Recurring reminders persist their message until
  removed. See [PRIVACY.md](./PRIVACY.md).

---

## Operating both modules (Docker)

Everything runs in Docker. Useful commands:

```bash
# Apply database migrations (creates birthdays, birthday_settings,
# birthday_announcements, reminders, ...)
docker compose exec app pnpm --filter @botplatform/database migrate

# Tail the bot logs to watch the schedulers fire
docker compose logs -f app

# Restart after changing settings/intents
docker compose restart app
```

Both modules and their scheduler jobs are wired up in `apps/bot/src/main.ts`
(`createBirthdaysModule` / `createRemindersModule`, registered with
`kernel.scheduler.register(...)`). Neither requires a privileged intent on its
own — birthday role grants need only `Manage Roles` permission, not the
`GuildMembers` privileged intent.
