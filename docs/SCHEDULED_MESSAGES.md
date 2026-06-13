# Scheduled Messages

Post one-off and recurring messages to a Discord channel on a schedule. Messages
are authored in the admin panel and delivered by a background scheduler tick —
there are **no slash commands** for this module.

- Module package: `packages/scheduled-messages-module/src/index.ts`
- Schedule math (timezone-aware): `packages/scheduled-messages-module/src/next-run.ts`
- Data access: `packages/scheduled-messages-module/src/repo.ts`
- Admin routes: `apps/admin/src/routes/scheduled-messages.ts`
- Admin views: `apps/admin/views/scheduled-messages.ejs`, `apps/admin/views/scheduled-message-edit.ejs`
- Registered in: `apps/bot/src/main.ts` (`createScheduledMessagesModule`, scheduler job `scheduled-messages.deliver-due`)

## What it does

An admin creates a scheduled message tied to a server and channel, with content,
an optional mention prefix, and a schedule. A background job (`schedulerJob`) runs
every **30 seconds** (`TICK_MS = 30_000`), finds messages whose `nextRunAt` is due
and which are not paused, sends them, records the run, and computes the next run.

For one-off (`once`) schedules with no future run, the message is automatically
paused after delivery (`paused: next === null ? true : row.paused`).

If the bot is offline for a guild at delivery time, the message is skipped without
advancing `nextRunAt`, so it is retried on the next tick (see `deliver()` in
`index.ts`).

## Required Discord permissions and intents

Declared in the module metadata (`packages/scheduled-messages-module/src/index.ts`):

- **Permissions:** `SendMessages` (the bot must be able to post in the target channel).
- **Gateway intents:** `Guilds` only. This module reads no message content and
  listens to no gateway events, so it needs no privileged intents.

The bot still needs to be a member of the server and have access to the target
channel. Mention prefixes (`@everyone` / `@here` / role pings) additionally require
the **Mention Everyone** permission in Discord for those mentions to resolve.

## Schedule types

The schedule type is a Postgres enum `schedule_type`
(`packages/database/src/schema.ts`) with these values:

| Type | Behavior | Config fields (`schedule_config`) |
| --- | --- | --- |
| `once` | Fire a single time, then auto-pause. | `at` — ISO datetime |
| `interval` | Repeat every N seconds. | `intervalSeconds` (min 60) |
| `daily` | Every day at a time. | `hour` (0–23, default 9), `minute` (0–59, default 0) |
| `weekly` | Once a week on a weekday at a time. | `weekday` (0=Sun … 6=Sat, default 1=Mon), `hour`, `minute` |
| `monthly` | Once a month on a day at a time. | `day` (1–28, default 1), `hour`, `minute` |
| `cron` | Standard 5-field cron expression. | `expression` (e.g. `0 9 * * 1`) |

Next-run computation (`computeNextRun` in `next-run.ts`) is pure and timezone-aware,
using **luxon** for calendar schedules and **cron-parser** for cron expressions.

### Timezone support

Each message stores an IANA `timezone` (e.g. `Europe/Bucharest`), defaulting to
`UTC`. Times for `once`/`daily`/`weekly`/`monthly` and cron expressions are
evaluated in that zone. If the configured zone is invalid, it falls back to `UTC`
(`isValidZone` check in `next-run.ts`).

Notes on edge handling:

- `monthly` day is capped at **28** to avoid skipping short months.
- Out-of-range or non-integer `hour`/`minute`/`weekday`/`day` values are clamped to
  the valid range or fall back to the defaults above.
- `once` with a time in the past, and `cron` with an unparseable expression, produce
  no next run. On save the admin route rejects this with
  *"That schedule has no upcoming run — check the date/time."*

## Mention controls

`mention_mode` is one of `none`, `here`, `everyone`, `roles`. When set, a prefix is
prepended to the content at send time (`deliver()` in `index.ts`):

- `everyone` → `@everyone` prefix
- `here` → `@here` prefix
- `roles` → pings each ID in `mention_role_ids` as `<@&id>`

The outgoing message's `allowMentions` is set to match so only the intended pings
resolve. Role IDs are entered comma- or newline-separated in the editor and are
filtered to numeric IDs only (`parseIds` in the route).

## Safety limits

Enforced in `apps/admin/src/routes/scheduled-messages.ts` and `next-run.ts`:

- **Minimum interval: 60 seconds** (`MIN_INTERVAL_SECONDS`). Interval values below 60
  are rejected on save and clamped up to 60.
- **Maximum 50 scheduled messages per guild** (`MAX_PER_GUILD = 50`). Creating a new
  message past this limit is rejected; editing existing messages is unaffected.
- The delivery query (`listDue`) also processes at most **50** due messages per tick.

## Configuring it in the admin panel

Admin pages (login-protected; mutating actions require a non-viewer role, CSRF
token, and are audited):

- **List:** `/scheduled-messages` — table of messages for the selected server with
  next-run time and Active/Paused status, plus inline Pause/Resume and Delete buttons.
  Use `?guild=<guildId>` to switch servers.
- **Create:** `/scheduled-messages/new`
- **Edit / run history:** `/scheduled-messages/:id` — the edit form plus a
  *Recent runs* table (last 10 runs).

The editor (`scheduled-message-edit.ejs`) collects: server, name, channel ID,
message content, mention mode + role IDs, schedule type, IANA timezone, and the
type-specific schedule fields. On save it validates required fields (server,
channel ID, content), builds the schedule config, computes `nextRunAt`, and creates
or updates the row.

### Lifecycle actions

POST endpoints (all behind auth + mutating-role + CSRF):

- `POST /scheduled-messages/:id/save` — create or update.
- `POST /scheduled-messages/:id/pause` — set `paused = true`.
- `POST /scheduled-messages/:id/resume` — set `paused = false`.
- `POST /scheduled-messages/:id/delete` — delete the message (run history is removed
  via cascade).

## Database tables

Defined in `packages/database/src/schema.ts`; migration
`packages/database/migrations/0001_sturdy_timeslip.sql`.

### `scheduled_messages`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `guild_id` | FK → `guilds.id`, `ON DELETE CASCADE` |
| `name` | display name (default `''`) |
| `channel_id` | target channel (Discord snowflake) |
| `content` | message body (default `''`) |
| `format` | `'plain'` \| `'embed'` (default `plain`; module currently sends plain) |
| `embed_config` | JSONB (reserved) |
| `mention_mode` | `none` \| `here` \| `everyone` \| `roles` |
| `mention_role_ids` | JSONB string array |
| `schedule_type` | enum: `once`/`interval`/`daily`/`weekly`/`monthly`/`cron` |
| `schedule_config` | JSONB; shape depends on `schedule_type` |
| `timezone` | IANA zone (default `UTC`) |
| `next_run_at` | next due timestamp (indexed) |
| `last_run_at` | last delivery timestamp |
| `paused` | boolean (default false) |
| `last_failure_reason` | set to `Delivery failed.` on send error |
| `created_at` / `updated_at` | timestamps |

Indexes: `scheduled_messages_guild_idx` (guild), `scheduled_messages_next_run_idx`
(next-run scan).

### `scheduled_message_runs`

One row per delivery attempt, written by `recordRun`.

| Column | Notes |
| --- | --- |
| `id` | bigserial primary key |
| `scheduled_message_id` | FK → `scheduled_messages.id`, `ON DELETE CASCADE` |
| `status` | `'sent'` \| `'failed'` \| `'skipped'` |
| `detail` | optional note (e.g. `delivery error` on failure) |
| `ran_at` | run timestamp (indexed via `scheduled_message_runs_msg_idx`) |

The edit page shows the most recent runs; `listRuns` returns up to 20 by default
(capped at 100).

## Audit events

- `scheduled-message.created` — admin created a message (actor: admin).
- `scheduled-message.updated` — admin edited a message (actor: admin).
- `scheduled-message.sent` — a message was delivered by the scheduler (actor: system).

The module metadata advertises `scheduled-message.sent`; create/update events are
recorded by the admin route. Pause/resume/delete are not separately audited as
distinct event names. All audit records target `targetType: scheduled_message`.

## Security and privacy notes

- Admin pages are login-protected; create/edit/pause/resume/delete require a
  non-viewer role plus a valid CSRF token, and admin mutations are written to the
  audit log.
- `@everyone`/`@here`/role pings are powerful — limit who has mutating admin access,
  and ensure the bot has the **Mention Everyone** permission only where intended.
- Mention role IDs are validated to be numeric snowflakes; `allowMentions` restricts
  pings to exactly the configured targets, preventing accidental mass pings from
  message body text.
- No message content from users is ingested; this module only sends, so it needs no
  `MessageContent` intent.

## Known limitations

- **No slash commands** — management is admin-panel only.
- **Plain text only today.** The schema reserves `format = 'embed'` and
  `embed_config`, but the admin form and `deliver()` currently send plain content
  (`format: 'plain'`).
- **Placeholder substitution is not applied.** Content is sent verbatim; the
  `{{...}}` placeholders used elsewhere on the platform are not interpolated here.
- **Delivery cadence is bounded by the 30s tick.** A message becomes eligible only
  on the next tick after `next_run_at`, so timing can lag by up to ~30 seconds. The
  per-tick batch is capped at 50 due messages.
- **Bot-offline behavior:** if the bot can't serve a guild at send time, the run is
  skipped and retried next tick; once back online it sends on the following tick.

## Docker commands

Everything runs in Docker. Migrations create both tables:

```bash
docker compose exec app pnpm db:migrate
```

Tail scheduler activity (delivery successes/failures are logged by the module):

```bash
docker compose logs -f app
```
