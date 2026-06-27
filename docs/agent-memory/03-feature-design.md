# 03 — Feature Design (Speaker Queue / Raise Hand)

> Agent: **AGENT 3 — FEATURE DESIGN**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)
> Feature: **Speaker Queue** (module key `raise-hand`, package
> `packages/raise-hand-module`).

This file is the precise functional spec of the Speaker Queue feature, derived
from the locked orchestrator design
([`00-orchestrator-plan.md`](00-orchestrator-plan.md) §3). It elaborates — and
does **not** deviate from — that brief. Companion flow docs:

- [`../raise-hand/user-flows.md`](../raise-hand/user-flows.md) — normal-user flows
- [`../raise-hand/moderator-flows.md`](../raise-hand/moderator-flows.md) — moderator flows
- [`../raise-hand/queue-and-priority-rules.md`](../raise-hand/queue-and-priority-rules.md) — ordering, priority, lifecycle

---

## What it is

A **Speaker Queue** lets members in a voice channel raise their hand to request
the floor, and lets moderators advance through that queue in a fair, ordered
way. It is an **explicit, managed raise-hand queue**, not a voice-activity
detector: Discord cannot reliably tell the bot *who is speaking* (that needs an
invasive voice-receive connection), so speaking order is managed deliberately
through slash commands and a button control panel.

The queue is **per `(guild, voice channel)`**. A raise-hand is tied to the voice
channel the user is in at that moment. Two different voice channels in the same
server are two independent queues. Different servers are fully isolated.

---

## The 10 minimum capabilities

The feature is complete when all ten of these work:

| # | Capability | Surface |
| --- | --- | --- |
| 1 | **Raise hand** — a member in a VC joins that VC's queue | `/raise-hand`, **Raise Hand** button |
| 2 | **Lower hand** — a member removes themselves from the queue | `/lower-hand`, **Lower Hand** button |
| 3 | **Queue persists** — the queue survives a bot restart (stored in Postgres) | persistence (no command) |
| 4 | **View order** — anyone can see the live ordered queue and current speaker | `/speaker-queue`, **Show Queue** button |
| 5 | **Moderator advance** — mark current speaker done, promote next waiting member to active | `/next-speaker`, **Next Speaker** button |
| 6 | **Moderator remove** — remove a specific member from the queue | `/remove-speaker user:@u` |
| 7 | **Moderator clear** — empty the queue for the VC | `/clear-speaker-queue`, **Clear Queue** button |
| 8 | **Announce next** — on advance, announce who is next to speak | panel edit + channel message |
| 9 | **Handle voice-leave** — auto-remove a member from the queue of the VC they leave | `voice.state.update` event |
| 10 | **Prevent duplicates** — a member cannot occupy a queue twice; re-raising reports position | partial unique index + idempotent `/raise-hand` |

---

## Who can use what

Everyone is `guildOnly`; the queue only exists inside a server.

| Command | Who | Discord gate | Extra rule |
| --- | --- | --- | --- |
| `/raise-hand` | Everyone | none | caller must be in a VC |
| `/lower-hand` | Everyone | none | — |
| `/speaker-queue` | Everyone | none | shows the caller's VC queue (ephemeral) |
| `/next-speaker` | Moderator | `defaultMemberPermissions: ['MuteMembers']` | mod must be in the VC they manage |
| `/remove-speaker` | Moderator | `['MuteMembers']` | mod must be in the VC they manage |
| `/clear-speaker-queue` | Moderator | `['MuteMembers']` | mod must be in the VC they manage |
| `/promote-speaker` | Moderator | `['MuteMembers']` | mod must be in the VC they manage |
| `/speaker-panel` | Moderator | `['MuteMembers']` | mod must be in the VC they manage |

- **"Moderator" = anyone Discord lets use the command** via the
  `Mute Members` permission (`MuteMembers`). This permission was chosen because
  it is the natural "manage who speaks" capability; the bot does **not** actually
  mute anyone — the permission is used only as a gate. **The guild owner is
  always allowed**, even without the permission.
- **Panel buttons** carry no Discord per-permission gating (Discord cannot gate a
  single button by member permission), so the moderator buttons (**Next Speaker**,
  **Clear Queue**) are **re-checked server-side** before acting, via the additive
  `GuildService.memberHasPermission(userExternalId, 'MuteMembers')` **OR**
  `isGuildOwner`. The everyone buttons (**Raise Hand**, **Lower Hand**,
  **Show Queue**) are open to all.
- **"Must be in the VC you manage"**: every moderator command/button operates on
  the moderator's *current* voice channel, read with
  `ctx.voice.getUserVoiceChannel()`. A moderator who is not in any VC is told
  *"Join the voice channel you want to manage."* This guarantees a moderator can
  only manage a room they are present in.

---

## Edge cases — explicit answers

Every edge case below has one defined behaviour.

### User is not in a voice channel
`/raise-hand` (and the **Raise Hand** button) require a VC. If
`ctx.voice.getUserVoiceChannel()` returns `null`, the user is told:
> "Join a voice channel first."

No queue row is created. (`/lower-hand`, `/speaker-queue` do not require a VC for
the command to run, but they resolve the target queue from the caller's current
VC; with no VC there is nothing to act on and the user is told their VC has no
queue / they are not in one.)

### User is already in the queue (re-raise)
`/raise-hand` is **idempotent**. If the member already has a non-`done` entry in
that VC's queue, no second row is created (the partial unique index forbids it).
The member is told their **current position**, e.g.:
> "You're already in the queue — position 3 of 7."

### User is already the active speaker
If the member's existing entry is `status = 'active'` (they currently hold the
floor), `/raise-hand` reports:
> "You're the current speaker."

No change is made.

### User leaves the voice channel while queued
Handled by the new **`voice.state.update`** platform event. When a member's voice
state changes such that `oldChannelId` is set and `oldChannelId !== newChannelId`
(they left or moved away from that VC), the module removes that member's entry
from the **old** VC's queue and refreshes that VC's panel. Leaving the VC is
treated as withdrawing the raised hand. If they were the **active** speaker, their
entry is removed too; a moderator advances the queue with `/next-speaker` or the
**Next Speaker** button when ready (the feature does not auto-promote on leave in
the MVP — see [queue rules](../raise-hand/queue-and-priority-rules.md)).

### Bot restarts
The queue **persists**. All queue state lives in Postgres (tables below), so a
bot restart, redeploy, or crash does **not** lose the queue. On restart the panel
message still exists in Discord and continues to work; the next interaction or
advance re-renders it from the database. (One caveat: voice-state changes that
happen *while the bot is offline* are not delivered as events, so a member who
left during downtime may still show as queued until they re-trigger a state
change or a moderator removes them. This is documented, not a defect.)

### State: persistent vs in-memory
**Persistent.** Nothing about the queue is held only in memory. This matches every
other database-backed module in the platform (Drizzle + Postgres) and is what
makes capability #3 true.

### Scope: per guild + voice channel
Each `(guild, voice channel)` pair has at most one `speaker_queues` row (enforced
by a unique constraint). All entries hang off that row. A member can be queued in
two *different* voice channels at once (those are different queues), but never
twice in the *same* one.

### Priority — how it is set
By default every entry has `priority = 0` and the queue is first-come-first-served
within that priority. `/promote-speaker user:@u` (moderator) raises a member's
`priority` to **above the current maximum** in that queue, so the member jumps to
the front of the `waiting` group while preserving relative order among
already-promoted members. There is no automatic role-based priority in the MVP
(deferred to roadmap).

### Moderator promote-to-front
`/promote-speaker user:@u` is the documented way to move a waiting member to the
front. It only affects `waiting` entries (it does not displace the one `active`
speaker). If the target member is not in the queue, the moderator is told so.

### Queue reset
`/clear-speaker-queue` (or the **Clear Queue** button) removes **all** entries for
the moderator's current VC — `waiting`, `active`, and any retained `done` rows —
leaving an empty queue. The `speaker_queues` row and its panel binding remain so
the panel keeps working.

---

## Data model

Two tables, added to the single Drizzle schema
`packages/database/src/schema.ts`. Conventions match the existing tables: `uuid`
primary keys (`defaultRandom`), `guildId uuid` FK → `guilds.id`
(`ON DELETE CASCADE`), `timestamptz` with `defaultNow`, and
`uniqueIndex`/`index` helpers. The migration is generated with
`pnpm db:generate` (drizzle-kit) — never hand-written.

### `speaker_queues`

One row per `(guild, voice channel)`. Holds the panel binding and announce
channel.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid (PK) | `defaultRandom` |
| `guild_id` | uuid → `guilds.id` | `ON DELETE CASCADE` |
| `voice_channel_id` | text | The Discord voice channel ID this queue belongs to |
| `voice_channel_name` | text | Cached channel name (default `''`) for rendering the panel without an extra fetch |
| `panel_channel_id` | text (nullable) | Text channel the control panel was posted in |
| `panel_message_id` | text (nullable) | The panel message ID (for in-place edits) |
| `announce_channel_id` | text (nullable) | Where "next to speak" is announced (defaults to the panel channel) |
| `created_at` | timestamptz | `defaultNow` |
| `updated_at` | timestamptz | `defaultNow` |

**Unique:** `unique(guild_id, voice_channel_id)` — exactly one queue per VC per
guild.

### `speaker_queue_entries`

One row per raised hand.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid (PK) | `defaultRandom` |
| `queue_id` | uuid → `speaker_queues.id` | `ON DELETE CASCADE` |
| `user_external_id` | text | The Discord user ID of the member |
| `display_name` | text | Cached display name for rendering the panel/list |
| `status` | text | `'waiting'` \| `'active'` \| `'done'` (default `'waiting'`) |
| `priority` | integer | Default `0`; higher = nearer the front |
| `raised_at` | timestamptz | `defaultNow`; tie-breaker within a priority |

**Partial unique index (duplicate prevention):**

```
unique index on (queue_id, user_external_id) WHERE status <> 'done'
```

This permits at most one *live* (`waiting` or `active`) entry per member per
queue, while still allowing historical `done` rows to coexist. It is what makes
`/raise-hand` idempotent at the database level.

**Ordering:** the queue is ordered by

```
priority DESC, raised_at ASC
```

i.e. higher priority first; within the same priority, whoever raised earlier is
ahead. The single `active` entry (current speaker) is shown separately at the top.

---

## How the pieces connect (design summary)

- **Commands** (`commands.ts`): the eight slash commands above, all
  `guildOnly`; moderator commands carry `defaultMemberPermissions: ['MuteMembers']`.
- **Pure logic** (`logic.ts`): ordering, position calculation, promote-priority
  computation, and state-transition rules — no I/O, unit-testable.
- **Service** (`service.ts`): orchestrates command/button handlers, reads the
  caller's VC via `ctx.voice`, calls the repo, renders + refreshes the panel via
  `GuildService` / `event.update()`, posts the announce message.
- **Repo** (`repo.ts`): all Drizzle access to the two tables.
- **Event handler**: subscribes to the new `voice.state.update` event for
  voice-leave auto-removal, and to `component.interaction` (customId prefix
  `rh:`) for the panel buttons.
- **Panel**: an embed listing the current speaker + the ordered `waiting` list,
  with buttons `rh:raise:<vcId>`, `rh:lower:<vcId>`, `rh:show:<vcId>` (everyone)
  and `rh:next:<vcId>`, `rh:clear:<vcId>` (moderator, re-checked server-side).

No new runtime dependencies are introduced.

---

## Checkpoint

Status: PASS

### Validat
- Command contract (`name`, `description`, `options`, `subcommands`, `guildOnly`,
  `defaultMemberPermissions`, `execute`) verified against
  `packages/core/src/contracts/commands.ts`.
- `VoiceCapability.getUserVoiceChannel()` returning the caller's current VC
  `{id,name}|null` verified against `packages/core/src/contracts/voice.ts`.
- `PlatformEvent` union currently has no voice event (only `member.join`,
  `member.leave`, `message.create`, `component.interaction`) — verified against
  `packages/core/src/contracts/events.ts`; the design's `voice.state.update` is
  genuinely additive, and `component.interaction` already exposes `customId`,
  `values`, `user`, `userRoleIds`, `reply`, optional `update` as the panel needs.
- Data model (column names, FK cascade, partial unique index, `(priority DESC,
  raised_at ASC)` ordering) transcribed exactly from the locked brief; conventions
  cross-checked against the documented `role_menus`/`role_menu_options` tables in
  `docs/REACTION_ROLES.md`.
- Tone/structure matched to `docs/REACTION_ROLES.md`.

### Nevalidat
- `GuildService.memberHasPermission` does not yet exist in source (it is the
  additive method the implementation adds); only its intended signature is
  specified here.
- `voice.state.update` adapter wiring not yet implemented (Agent 6).
- Exact panel embed layout (field formatting) — design intent only; final
  rendering finalized at implementation.

### Probleme
- Bot-offline voice-state changes are not delivered as events, so a member who
  leaves during downtime may remain queued until re-triggered or removed —
  documented as a known limitation, not a bug.

### Următorul agent poate continua?
Da. The functional spec, permission matrix, every edge case, and the exact data
model (tables, columns, partial unique index, ordering) are locked and consistent
with the verified contracts. Agent 4 (permissions/capabilities) and Agent 5
(implementation plan) can build directly on this.
