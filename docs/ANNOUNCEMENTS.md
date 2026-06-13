# Announcements

Create, schedule, and send server announcements from the admin panel — with built-in protection against accidental mass pings. The admin panel is the primary interface for authoring; a small set of in-Discord slash commands lets server staff list, preview, send, and cancel.

- **Module package:** `packages/announcements-module/src/`
- **Admin routes:** `apps/admin/src/routes/announcements.ts`
- **Admin views:** `apps/admin/views/announcements.ejs`, `apps/admin/views/announcement-edit.ejs`
- **Registered in:** `apps/bot/src/main.ts` (`createAnnouncementsModule` + `schedulerJob`)
- **Module key:** `announcements`

---

## What it does

An announcement is a stored message (plain text or rich embed) targeted at a specific channel. Each announcement moves through a lifecycle tracked by its `status`:

```
draft ──schedule──► scheduled ──delivered──► sent
  │                     │
  │                     └──► failed   (delivery error; left for retry/inspection)
  └──cancel──► canceled
```

The admin panel **does not connect to Discord**. When you "Send now" or schedule an announcement, the admin app only writes a row with `status = scheduled` and a `scheduledFor` timestamp. The **bot worker's scheduler job** (`announcements.deliver-due`) is what actually posts the message to Discord — it polls every **30 seconds** (`DELIVERY_TICK_MS = 30_000` in `packages/announcements-module/src/index.ts`). So even "immediate" delivery happens within roughly 30 seconds.

Templates (`isTemplate = true`) are reusable drafts that are **never delivered**. They are excluded from the due-delivery query and are skipped by the delivery service.

---

## Required Discord permissions and intents

Declared in the module metadata (`packages/announcements-module/src/index.ts`):

| Type | Value |
| --- | --- |
| Bot permissions | `SendMessages`, `EmbedLinks` |
| Gateway intents | `Guilds` |

To mention `@everyone` / `@here` / roles, the bot also needs the **Mention Everyone** permission in the target channel (in addition to the in-app confirmation described below). Before delivering, the service checks `botHasPermission('SendMessages', targetChannelId)`; if the bot lacks it, the announcement is marked `failed` with reason *"Missing permission to post in the target channel."*

No privileged intents are required for this module.

---

## Admin workflow

All admin pages are login-protected. Mutating actions additionally require a mutating role and pass CSRF protection (`requireAuth`, `requireMutatingRole`, `csrfProtection`).

### Page paths

| Route | Method | Purpose |
| --- | --- | --- |
| `/announcements` | GET | List announcements for the selected guild (`?guild=<id>`); includes templates. Flash messages via `?msg=`. |
| `/announcements/new` | GET | Empty editor for a new announcement. |
| `/announcements/:id` | GET | Editor for an existing announcement. |
| `/announcements/:id/save` | POST | Create (`:id = new`) or update a draft. |
| `/announcements/:id/schedule` | POST | Schedule for a future time, or send now. |
| `/announcements/:id/cancel` | POST | Cancel a draft/scheduled announcement. |
| `/announcements/:id/duplicate` | POST | Copy an announcement into a new draft. |
| `/announcements/:id/delete` | POST | Permanently delete the row. |

### Draft / edit

The editor (`announcement-edit.ejs`) submits to `/announcements/:id/save`. Fields are validated server-side by `validateAnnouncement` (`packages/announcements-module/src/validation.ts`):

| Field | Notes |
| --- | --- |
| `title` | Max **256** chars. |
| `body` | Max **4000** chars. A title **or** a body is required. |
| `format` | `plain` or `embed` (anything else falls back to `plain`). |
| `targetChannelId` | **Required** — the channel the announcement posts to. |
| `mentionMode` | `none` / `here` / `everyone` / `roles`. |
| `mentionRoleIds` | Required (≥1) when `mentionMode = roles`. Accepts an array or a comma-separated string. |
| `embedColor` | Optional 6-digit hex (`#rrggbb` or `rrggbb`). |
| `footer` | Optional (embed footer). |
| `imageUrl` | Optional; must be a valid `http(s)` URL. |
| `isTemplate` | `on` marks the row as a reusable template. |

If validation fails the editor re-renders with a `400` and an `errors` list; the user's input is preserved.

On a successful save the guild is resolved from the submitted `guildId`, the existing row, or the first known guild. New rows are created with `status = draft` and `createdBy = <adminId>`.

### Schedule / send now

`/announcements/:id/schedule` reads two inputs:

- `scheduledFor` — an ISO/parseable datetime string for a future send.
- `sendNow` — when `on` (or when `scheduledFor` is empty), the announcement is scheduled for **`new Date()`**, i.e. the next scheduler tick (~30s).

Templates cannot be scheduled — the route redirects with *"Templates cannot be sent"*. Invalid dates are rejected (the page reloads without scheduling). On success the row is set to `status = scheduled` with the chosen `scheduledFor`, and the list shows *"Queued for immediate delivery"* or *"Scheduled"*.

### Duplicate

`/announcements/:id/duplicate` clones every content field (title, body, format, channel, mention settings, color, footer, image) into a **new draft** (`status = draft`, `isTemplate = false`) owned by the current admin, then opens it in the editor. Use this to turn a template into a sendable draft, or to reuse a past announcement.

### Cancel

`/announcements/:id/cancel` sets `status = canceled`. (The route does not block canceling an already-sent row from the admin panel; the slash command does — see below.)

### Delete

`/announcements/:id/delete` permanently removes the row via `announcements.delete(id)`. There is no soft-delete; use cancel if you only want to stop delivery.

---

## Mass-mention safety (accidental-ping guard)

This is the module's core safety feature, enforced in `validateAnnouncement`:

- Choosing `mentionMode = everyone` or `here` is **rejected** unless the form also submits `confirmMassMention` as `on` / `true`. The error reads: *"Mentioning @everyone pings many members — re-submit with the confirmation checkbox ticked."* In practice the admin must tick the confirmation checkbox and re-submit.
- When confirmed, a warning is surfaced: *"This announcement will ping @everyone/@here."*

A second layer lives at send time in `buildOutgoing` (`packages/announcements-module/src/service.ts`). The outgoing message sets an **allowed-mentions allowlist** so Discord only resolves pings the mode explicitly permits:

```
everyone: mentionMode === 'everyone' || 'here'
roles:    mentionMode === 'roles' ? mentionRoleIds : []
users:    []          // user pings are never resolved
```

So even if `@everyone` text appears in the body, it will not ping unless the mode allows it. Role mode emits `<@&id>` mention prefixes and allowlists exactly those role IDs.

---

## Slash commands

Command group `/announcement` (guild-only). The admin panel is the primary authoring UI; these commands are for quick in-Discord management. Source: `packages/announcements-module/src/commands.ts`. Responses are ephemeral.

| Subcommand | Options | Behavior |
| --- | --- | --- |
| `/announcement list` | — | Lists up to 10 recent announcements: short id, `[status]`, and a truncated title/body. |
| `/announcement preview` | `id` (string, required) | Shows status, title, and body (truncated) for the matching announcement. |
| `/announcement send` | `id` (string, required) | Delivers the announcement **immediately** via the delivery service (defers, then replies with the result message). |
| `/announcement cancel` | `id` (string, required) | Sets a draft/scheduled announcement to `canceled`. Refuses if it was already `sent`. |

**Id matching:** the `id` option accepts the full UUID or a prefix (the list view shows the first 8 chars). Lookup requires at least **4 characters** and matches by exact id or prefix; otherwise it returns *"No announcement matches that id."* Templates are included in the lookup set.

> Note: `/announcement send` invokes the delivery service directly and so bypasses the admin panel's mass-mention confirmation. The allowed-mentions allowlist in `buildOutgoing` still governs which pings actually resolve, based on the stored `mentionMode`.

---

## Database

Single table: **`announcements`** (`packages/database/src/schema.ts`). Migrations live in `packages/database/migrations/`.

Key columns:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid (PK) | Random UUID. |
| `guild_id` | uuid (FK → `guilds.id`, cascade) | Owning guild. |
| `title` | text | Default `''`. |
| `body` | text | Default `''`. |
| `format` | text | `plain` \| `embed`. |
| `target_channel_id` | text | Destination channel (nullable). |
| `image_url` | text | Optional image. |
| `card_template_id` | uuid | Reserved for card-rendered announcements. |
| `embed_color` | text | Hex string. |
| `footer` | text | Embed footer. |
| `mention_mode` | text | `none` \| `here` \| `everyone` \| `roles`. |
| `mention_role_ids` | jsonb (`string[]`) | Role IDs for `roles` mode. |
| `buttons` | jsonb | Reserved for component buttons. |
| `status` | enum `announcement_status` | `draft` \| `scheduled` \| `sent` \| `failed` \| `canceled`. |
| `is_template` | boolean | Templates are never delivered. |
| `scheduled_for` | timestamptz | When the scheduler should deliver. |
| `sent_at` | timestamptz | Set on successful delivery. |
| `sent_message_id` | text | The posted Discord message id. |
| `failure_reason` | text | Safe summary when `status = failed`. |
| `created_by` | text | Admin id (null = system). |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `announcements_guild_idx`, `announcements_status_idx`, `announcements_scheduled_idx`.

The scheduler's due-query selects rows where `status = 'scheduled'` AND `is_template = false` AND `scheduled_for <= now`, limited to 50 per tick (`listDue`).

---

## Audit events

Announcement actions are written to the audit log (`audit_logs` table, `moduleKey = 'announcements'`):

| Action | Actor | Where emitted | Notes |
| --- | --- | --- | --- |
| `announcement.created` | admin | `save` (new row) | |
| `announcement.updated` | admin | `save` (existing row) | |
| `announcement.scheduled` | admin | `schedule` | Metadata: `scheduledFor`, `sendNow`. |
| `announcement.canceled` | admin | `cancel` route | |
| `announcement.duplicate` | — | — | The duplicate route does not emit an audit event. |
| `announcement.deleted` | admin | `delete` route | |
| `announcement.sent` | admin or system | delivery service | Metadata: `channelId`, `mentionMode`. Actor is the creator, else `system`. |
| `announcement.failed` | system | delivery service (`fail`) | Severity `warning`; metadata `reason`. |

The module metadata advertises `announcement.sent`, `announcement.failed`, and `announcement.created`; the full set above is what the routes and service actually emit.

---

## Delivery & failure behavior

The delivery service (`createAnnouncementService`) handles each announcement defensively (`packages/announcements-module/src/service.ts`):

- **Templates** are skipped (*"Templates are not delivered."*).
- **No target channel** → marked `failed`.
- **Guild gone** → marked `failed` (*"Guild not found."*).
- **Bot offline / not connected** → **left scheduled** so the next 30s tick retries (no failure recorded).
- **Missing send permission** → marked `failed`.
- **Send throws** → logged at `warn`, marked `failed` with reason *"Delivery failed."*
- **Success** → `status = sent`, `sent_at` and `sent_message_id` recorded, `announcement.sent` audited.

Raw errors never reach end users — user-facing messages are deliberately generic.

---

## Privacy & security notes

- Mass mentions require explicit confirmation **and** are gated by a send-time allowed-mentions allowlist; user pings are never resolved.
- Admin write routes enforce auth, a mutating role, and CSRF.
- `imageUrl` is restricted to `http(s)` URLs.
- `failure_reason` stores safe summaries only — no stack traces.
- Admin actions are audited with the acting admin's id.

---

## Known limitations

- "Immediate" delivery is bounded by the 30-second scheduler tick, not truly instant.
- The admin `cancel` route does not block canceling an already-sent announcement (only the `/announcement cancel` slash command does); canceling does not unsend a posted message.
- The duplicate route does not write an audit event.
- `card_template_id` and `buttons` columns exist in the schema but are not wired into the current authoring/delivery path.
- Recurring announcements are not supported — each row is a one-shot send (use the **scheduled-messages** module for recurring posts).
- The due-delivery query processes up to 50 announcements per tick.

---

## Docker commands

Everything runs in Docker; the bot worker (`app`) is what runs the scheduler that delivers announcements.

```bash
# Apply database migrations (creates the announcements table)
docker compose exec app pnpm db:migrate

# Tail logs to watch deliveries (look for "delivered scheduled announcements")
docker compose logs -f app

# Run the module's tests
docker compose exec app pnpm --filter @botplatform/announcements-module test
```
