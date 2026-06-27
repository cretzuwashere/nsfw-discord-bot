# 05 — Implementation Plan (Raise Hand / Speaker Queue)

> Agent: **AGENT 5 — IMPLEMENTATION PLAN**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (all paths below are relative to repo root)
> Feature: **Speaker Queue** (module key `raise-hand`, package `packages/raise-hand-module`)
> Inputs: locked design in [`00-orchestrator-plan.md`](00-orchestrator-plan.md) §3,
> architecture facts in [`03-architecture-analysis.md`](03-architecture-analysis.md).

This file is the **incremental build plan** for Agent 6 (implementation). It breaks
the locked design into six small, separately testable stages. Each stage lists the
**real files affected**, the new code units, command/event/storage changes, the
tests, the **risk**, the **rollback plan**, the **Docker validation commands**, and
an explicit **acceptance gate (PASS/FAIL)**.

The build mirrors the reference button-driven module **`role-menus`**
(`packages/role-menus-module/src/{index,commands,service,logic,repo}.ts`); read that
module before starting each stage — the patterns transfer almost 1:1.

> **Everything runs in Docker.** The host has no Node. Every `pnpm …` command below
> is `docker compose exec app pnpm …`. The `app` service (`sleep infinity`) is the
> validation workbench.

---

## Conventions used by every stage

- **Package name:** `@botplatform/raise-hand-module`, directory
  `packages/raise-hand-module`. `package.json` `main`/`types` point at
  `./src/index.ts` (raw TS, like every other package — see arch analysis §"Source
  consumed as TS").
- **Module key:** `MODULE_KEYS.raiseHand = 'raise-hand'` (added in Stage 1, used in
  every later stage). Module `name`: `Speaker Queue`. Description:
  `Raise-hand speaker queue for voice channels.`
- **Custom-id prefix:** `rh:` for all panel buttons (e.g. `rh:raise:<vcId>`). Parsed
  by a `parseCustomId` helper in `logic.ts`, exactly like role-menus' `rolemenu:`.
- **Reply contract:** all command replies are ephemeral (`ctx.reply({ content,
  ephemeral: true })`), matching every other module's slash UX.
- **No new runtime dependencies** — only `discord.js`, `drizzle-orm`, `@botplatform/*`
  workspace packages (all already present).

---

## Stage 1 — Queue core (schema, migration, repo, pure logic, unit tests)

Build the data layer and the **pure, side-effect-free** queue logic with full unit
coverage. **No commands, no events, no UI** — nothing is wired into the bot yet, so
this stage cannot affect the running bot.

### Files affected / created

| File | Change |
|---|---|
| `packages/shared/src/types.ts` | **Edit:** add `raiseHand: 'raise-hand'` to `MODULE_KEYS`. |
| `packages/database/src/schema.ts` | **Edit:** add `speakerQueues` + `speakerQueueEntries` tables (below). |
| `packages/database/migrations/**` | **Generated:** `pnpm db:generate` emits a new migration SQL file. **Do not hand-edit.** |
| `packages/raise-hand-module/package.json` | **New:** mirrors `role-menus-module/package.json` (name, deps on `core`/`config`/`logger`/`shared`/`database`, `drizzle-orm`). |
| `packages/raise-hand-module/tsconfig.json` | **New:** extends the base, like other modules. |
| `packages/raise-hand-module/src/repo.ts` | **New:** `createSpeakerQueueRepo(db)` — data access. |
| `packages/raise-hand-module/src/logic.ts` | **New:** pure functions: ordering, dedupe, next-selection, promote, custom-id parse/build. |
| `packages/raise-hand-module/src/index.ts` | **New (skeleton):** `createRaiseHandModule(opts)` returning `{ module, service }` with an **empty** `commands: []` and `events: []` for now (filled in later stages). Exports repo + logic. |
| `packages/raise-hand-module/src/service.ts` | **New (skeleton):** `createSpeakerQueueService({ repo, guilds, guildServiceProvider, audit, logger })` — method stubs that the next stages flesh out. |
| `packages/raise-hand-module/src/logic.test.ts` | **New:** unit tests for the pure logic. |

### Storage / schema changes (exact Drizzle, matching existing patterns)

Add to `packages/database/src/schema.ts` (uses the helpers already imported there —
`uuid`, `text`, `integer`, `timestamp`, `index`, `uniqueIndex`, `sql`):

```ts
export const speakerQueues = pgTable(
  'speaker_queues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    voiceChannelId: text('voice_channel_id').notNull(),
    voiceChannelName: text('voice_channel_name').notNull().default(''),
    panelChannelId: text('panel_channel_id'),
    panelMessageId: text('panel_message_id'),
    announceChannelId: text('announce_channel_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('speaker_queues_guild_channel_idx').on(table.guildId, table.voiceChannelId),
  ]
);

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
    priority: integer('priority').notNull().default(0),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('speaker_queue_entries_queue_idx').on(table.queueId),
    // Duplicate prevention: at most one non-'done' entry per (queue, user).
    uniqueIndex('speaker_queue_entries_active_user_idx')
      .on(table.queueId, table.userExternalId)
      .where(sql`status <> 'done'`),
  ]
);
```

Notes:
- Mirrors `roleMenus`/`roleAssignmentLogs` exactly (uuid PK `defaultRandom`,
  `guildId` FK → `guilds.id` cascade, `withTimezone` timestamps `defaultNow`).
- `status`/`priority`/`raisedAt` are kept as **plain `text`/`integer`** (no new
  `pgEnum`) to match the project habit of documenting the small string union in a
  comment (see `roleAssignmentLogs.action`, `birthdays.visibility`). Avoiding a new
  enum keeps the migration trivially reversible.
- The **partial unique index** (`.where(sql\`status <> 'done'\`)`) is Drizzle's
  supported way to express a Postgres partial unique index; verify the generated
  migration contains `WHERE (status <> 'done')` after `db:generate`.

### Pure logic to implement (`logic.ts`) + the tests that pin it

All functions are **pure** (take rows + inputs, return a decision; never touch the
DB or the network):

| Function | Contract | Unit tests |
|---|---|---|
| `orderEntries(entries)` | Sort by `(priority DESC, raisedAt ASC)`; `done` excluded. | Mixed priorities + timestamps order correctly; ties broken by `raisedAt`. |
| `findActive(entries)` | Return the `status==='active'` entry or null. | None / one active. |
| `nextWaiting(entries)` | First `waiting` entry by `orderEntries`. | Empty → null; highest priority first; FIFO within equal priority. |
| `computeAdvance(entries)` | Given current entries, return `{ markDone?: id, promote?: id }` for `/next-speaker`: mark current active `done`, promote top waiting → `active`. | Active+waiting; only waiting (no active yet); empty queue (no-op). |
| `positionOf(entries, userId)` | 1-based position of a user among `waiting` (after ordering), or null. | Re-raise reports current position; active user → "current speaker" sentinel. |
| `nextPriorityAbove(entries)` | `max(priority)+1` over non-`done`, for `/promote-speaker`. | Empty → 1; jumps above current max. |
| `parseCustomId(id)` | `rh:<action>:<vcId>` → `{ action, voiceChannelId }`; non-`rh:` → null. | Round-trips `rh:raise:123`; rejects `rolemenu:…`. |
| `buildCustomId(action, vcId)` | Inverse of `parseCustomId`. | `buildCustomId('next','9') === 'rh:next:9'`. |

### Command / event changes

**None** in Stage 1.

### Risk

**Low.** Only additive: a new package + two new tables + one `MODULE_KEYS` entry.
Nothing references the module yet, so the bot's behaviour is unchanged. The only
shared-file edits are `shared/src/types.ts` (append a key) and `schema.ts` (append
two tables) — both purely additive.

### Rollback plan

- Revert the `schema.ts` and `shared/src/types.ts` edits; delete the generated
  migration file and `packages/raise-hand-module/`.
- If the migration was already applied to a dev DB, the new tables are isolated
  (no FK points *into* them from existing tables) — drop them, or roll the dev DB
  back; no existing data depends on them.

### Docker validation

```bash
docker compose exec app pnpm --filter @botplatform/raise-hand-module test   # logic.test.ts green
docker compose exec app pnpm db:generate                                    # emits one new migration
docker compose exec app pnpm db:migrate                                     # applies it to the dev DB
docker compose exec app pnpm typecheck                                      # whole monorepo clean
docker compose exec app pnpm lint
```

### Acceptance criteria

- **PASS** ⇔ all of: unit tests for every `logic.ts` function are green;
  `db:generate` produced **exactly one** new migration that creates both tables and
  the **partial** unique index (`WHERE (status <> 'done')`); `db:migrate` applies
  cleanly; `typecheck` + `lint` clean across the monorepo.
- **FAIL** ⇔ any logic test red, migration missing/partial-index absent, or
  typecheck/lint regressions anywhere.

---

## Stage 2 — Slash commands + module wiring

Add the everyday + moderator slash commands and wire the module into the bot so it
loads and registers. **Still no panel, no voice event** — moderator scoping uses
`ctx.voice.getUserVoiceChannel()` (already available on `CommandContext`).

### Files affected / created

| File | Change |
|---|---|
| `packages/raise-hand-module/src/commands.ts` | **New:** `buildRaiseHandCommands(deps)` → `CommandDefinition[]` (the 6 commands below). |
| `packages/raise-hand-module/src/service.ts` | **Edit:** implement `raise`, `lower`, `showQueue`, `advance` (`/next-speaker`), `removeSpeaker`, `clearQueue`. |
| `packages/raise-hand-module/src/index.ts` | **Edit:** set `commands: buildRaiseHandCommands(...)`; declare `metadata` (permissions/intents). |
| `apps/bot/src/main.ts` | **Edit:** `const raiseHandHandle = createRaiseHandModule({ config, logger, db, audit, guildServiceProvider });` and add `raiseHandHandle.module` to the `modules: [ … ]` array (after `roleMenusHandle.module`, ~line 126). |
| `apps/bot/src/register-commands.ts` | **Edit:** instantiate `createRaiseHandModule({ … NOOP_GUILD_PROVIDER })` and spread `...raiseHand.module.commands` into the `commands` array (mirrors the `roleMenus` lines 56-62, 82). |
| `packages/database/src/seed.ts` | **Edit:** add a built-in module row `{ key: MODULE_KEYS.raiseHand, name: 'Speaker Queue', description: '…', defaultEnabled: false }` to `builtInModules` (~line 50, next to `roleMenus`). The module ships **default-OFF**. |

> **Three-place agreement** (arch analysis risk #3): `MODULE_KEYS` (Stage 1) +
> `main.ts` build + `seed.ts` row must all use `'raise-hand'`. `register-commands.ts`
> is the fourth manual mirror — miss it and the slash commands never register.

### Commands (all `guildOnly: true`)

| Command | Permission | Options | Behaviour |
|---|---|---|---|
| `/raise-hand` | everyone | — | Caller must be in a VC (`ctx.voice.getUserVoiceChannel()`). Upsert the `(guild, vc)` queue, insert a `waiting` entry. **Idempotent:** re-raise reports current position. Not in VC → `"Join a voice channel first."` Already `active` → `"You're the current speaker."` |
| `/lower-hand` | everyone | — | Remove the caller's non-`done` entry from their VC's queue (delete or mark `done`). |
| `/speaker-queue` | everyone | — | Ephemeral ordered list for the caller's VC: current speaker + numbered waiting list. |
| `/next-speaker` | moderator | — | Mod must be **in** the VC. `computeAdvance`: mark active `done`, promote top waiting → `active`. (Announcement edit/post is added in Stage 4 once the panel/announce channel exists; in Stage 2 it replies the new speaker ephemerally.) |
| `/remove-speaker` | moderator | `user` (type `user`, required) | Mod must be in the VC. Remove the named user's entry from that VC's queue. |
| `/clear-speaker-queue` | moderator | — | Mod must be in the VC. Delete all entries for that VC's queue. |

- **Moderator gating (Discord layer):** moderator commands set
  `defaultMemberPermissions: ['MuteMembers']` on the `CommandDefinition` (Discord
  hides/blocks them for non-mods).
- **Moderator gating (server layer):** each moderator command additionally requires
  the mod to be in the VC it manages; otherwise reply `"Join the voice channel you
  want to manage."` **Guild owner always allowed** (`guildService.isGuildOwner`).
- Use the same `guildId(externalId)` upsert helper pattern as
  `role-menus-module/src/commands.ts` (`guilds.upsertByExternalId`).

### Module metadata (declared in `index.ts`)

```
requiredPermissions: ['SendMessages', 'EmbedLinks', 'ViewChannel', 'ReadMessageHistory']
requiredIntents: ['Guilds', 'GuildVoiceStates']
auditEvents: ['speakerqueue.advanced']   // emitted on /next-speaker
```

(`GuildVoiceStates` is already enabled by the adapter — declaring it here is
documentation, not a new privileged intent.)

### Event changes

**None** in Stage 2 (voice-leave is Stage 3).

### Tests needed

- Service unit tests with an **in-memory / faked repo** (no real DB): `raise`
  inserts + is idempotent; `lower` removes; `advance` marks done + promotes;
  `removeSpeaker` removes the right user; `clearQueue` empties. Permission/voice
  guards covered with a stub `GuildService`/`voice` returning known values.
- Re-run `logic.test.ts` (unchanged) to confirm no regression.

### Risk

**Medium.** First stage that touches the running bot. Edits four shared wiring files
(`main.ts`, `register-commands.ts`, `seed.ts`, plus the module). A command-name
collision (e.g. another module already owns a name) is caught **fail-fast at
registration** by `ModuleRegistry` (arch analysis pattern: duplicate command-name
rejection) — so a clash surfaces immediately at boot, not silently. The new command
names (`raise-hand`, `lower-hand`, `speaker-queue`, `next-speaker`, `remove-speaker`,
`clear-speaker-queue`) are unused elsewhere — confirm with a repo search before boot.

### Rollback plan

- Remove `raiseHandHandle` from the `modules[]` array in `main.ts` and the
  `...raiseHand.module.commands` spread in `register-commands.ts` → the bot boots
  exactly as before (module gone from the registry). Schema/tables from Stage 1 can
  stay (harmless, unreferenced).
- The seed row is idempotent; leaving it only adds a disabled-able row in the
  `modules` table.

### Docker validation

```bash
docker compose exec app pnpm typecheck
docker compose exec app pnpm lint
docker compose exec app pnpm --filter @botplatform/raise-hand-module test
docker compose exec app pnpm build                 # bot + admin bundle (module loads at compose time)
docker compose exec app node -e "require('child_process')"  # (illustrative) — real boot check below
docker compose restart bot && docker compose logs --tail=50 bot   # module registers, no command collision
```

### Acceptance criteria

- **PASS** ⇔ typecheck + lint + module unit tests + build all green; the `bot`
  container restarts **healthy** with the module registered and **no duplicate
  command-name / duplicate module-key error** in logs; `register-commands.ts`
  collects the 6 new commands (count increases by 6 in its log line when run).
- **FAIL** ⇔ any registration error, the bot crash-loops, the commands are absent
  from the register count, or typecheck/lint/test/build regress.

---

## Stage 3 — Voice-state integration (`voice.state.update` event)

Add the **new platform event** so leaving/moving out of a VC drops the user from
that VC's queue. Additive to the `PlatformEvent` union — must not break existing
event flows.

### Files affected / created

| File | Change |
|---|---|
| `packages/core/src/contracts/events.ts` | **Edit:** add `VoiceStateUpdateEvent` interface and add it to the `PlatformEvent` union + `PlatformEventType`. |
| `packages/discord-adapter/src/adapter.ts` | **Edit:** `client.on(Events.VoiceStateUpdate, (oldState, newState) => void this.emitVoiceStateUpdate(oldState, newState))` next to the existing `GuildMemberAdd`/`MessageCreate` wiring (~line 135), plus a private `emitVoiceStateUpdate` that maps to the new event (mirrors `emitMemberEvent`). |
| `packages/raise-hand-module/src/index.ts` | **Edit:** add an `events: [{ type: 'voice.state.update', handle: (e) => service.handleVoiceStateUpdate(e as VoiceStateUpdateEvent) }]` entry. |
| `packages/raise-hand-module/src/service.ts` | **Edit:** implement `handleVoiceStateUpdate`. |

### Event shape (added to `contracts/events.ts`)

```ts
export interface VoiceStateUpdateEvent {
  type: 'voice.state.update';
  adapterKey: string;
  guild: PlatformGuildRef;
  user: PlatformUserRef;
  /** VC the user was in before this update (null if they just joined). */
  oldChannelId: string | null;
  /** VC the user is in after this update (null if they left voice entirely). */
  newChannelId: string | null;
}
```

…and extend the union:

```ts
export type PlatformEvent =
  | MemberJoinEvent
  | MemberLeaveEvent
  | MessageCreateEvent
  | ComponentInteractionEvent
  | VoiceStateUpdateEvent;
```

### Handler behaviour (`service.handleVoiceStateUpdate`)

- Ignore bot users (`event.user.bot === true`).
- If `oldChannelId` is set **and** `oldChannelId !== newChannelId` (the user left or
  moved away from a VC): remove that user's non-`done` entry from the
  `(guild, oldChannelId)` queue, if one exists; then refresh that queue's panel if
  it has `panelChannelId`/`panelMessageId` set (panel edit is a no-op until Stage 4
  exists, so guard on the columns being non-null).
- Do nothing on pure join (`oldChannelId === null`) — a join doesn't enqueue anyone.

### Command changes

**None.**

### Tests needed

- `service` unit test: leaving a VC removes only that user from only that VC's queue
  (other VCs untouched); a same-channel update (`old === new`, e.g. mute toggle)
  is a no-op; a bot user is ignored; join (`old === null`) is a no-op.
- An adapter-level mapping test if the adapter has a unit-test harness; otherwise
  document this as integration-only (it needs a live gateway event).

### Risk

**Medium-high.** Edits **two shared core/adapter surfaces** used by every module.
The `PlatformEvent` union is exhaustively switched in some consumers — verify the
`ModuleRegistry.createEventDispatcher` and any `switch (event.type)` sites still
typecheck (the addition is non-breaking: handlers only receive events they subscribe
to). The adapter listener uses the **already-enabled** `GuildVoiceStates` intent —
no gateway-intent change, no privileged-intent opt-in.

### Rollback plan

- Remove the `events` entry from the module `index.ts` → the bot stops reacting to
  voice updates but is otherwise intact.
- To fully revert: remove the `VoiceStateUpdateEvent` from the union and the
  `client.on(Events.VoiceStateUpdate, …)` line. Because the event is additive, no
  existing handler depends on it — removal is clean.

### Docker validation

```bash
docker compose exec app pnpm typecheck                                   # union change compiles everywhere
docker compose exec app pnpm --filter @botplatform/core build            # core contract builds
docker compose exec app pnpm --filter @botplatform/discord-adapter build # adapter builds with new listener
docker compose exec app pnpm --filter @botplatform/raise-hand-module test
docker compose exec app pnpm lint
docker compose restart bot && docker compose logs --tail=50 bot          # boots, listener attached
```

### Acceptance criteria

- **PASS** ⇔ the union change typechecks across the whole monorepo (no
  non-exhaustive-switch errors); core + adapter build green; service voice-leave
  unit tests pass; bot boots healthy. (Live "leave a VC → entry disappears" is an
  integration check deferred to Stage 6 / Agent 7, requires a valid Discord token.)
- **FAIL** ⇔ any consumer fails to typecheck against the wider union, adapter build
  fails, or the leave-handler tests are red.

---

## Stage 4 — Control panel with buttons + `memberHasPermission`

Add the persistent button panel (`/speaker-panel`), the button routing on
`component.interaction`, the announce-on-advance behaviour, and the additive
server-side permission check used to gate moderator buttons.

### Files affected / created

| File | Change |
|---|---|
| `packages/core/src/contracts/guild-service.ts` | **Edit:** add `memberHasPermission(userExternalId: string, permission: string): Promise<boolean>;` to the `GuildService` interface. |
| `packages/discord-adapter/src/guild-service.ts` | **Edit:** implement it via `member.permissions.has(PermissionFlagsBits[permission])` (no-throw contract: return `false` on any failure). |
| `packages/raise-hand-module/src/commands.ts` | **Edit:** add `/speaker-panel` (moderator) → posts the panel in the current channel, bound to the mod's current VC; stores `panelChannelId`/`panelMessageId`/`announceChannelId` on the queue row. |
| `packages/raise-hand-module/src/logic.ts` | **Edit:** add `buildPanelMessage(queueState)` → `OutgoingMessage` (embed with live ordered queue + current speaker; buttons with `rh:` custom-ids). |
| `packages/raise-hand-module/src/service.ts` | **Edit:** implement `handleInteraction(event)` (button routing) + `refreshPanel(queueId)` + the announce edit/post on advance. |
| `packages/raise-hand-module/src/index.ts` | **Edit:** add `{ type: 'component.interaction', handle: … }` to `events`. |

### `/speaker-panel` and the panel

- `/speaker-panel` (moderator, `defaultMemberPermissions: ['MuteMembers']`, mod must
  be in a VC): posts an embed panel into the **current text channel**, bound to the
  mod's current voice channel id. Persists `panelChannelId` = current channel,
  `panelMessageId` = posted message, `announceChannelId` = current channel.
- Panel embed lists the **live ordered queue** (`orderEntries`) and the current
  speaker; refreshed via `event.update(message)` after each button, and via
  `editMessage` after slash-command/voice-leave changes.
- Buttons (custom-id prefix `rh:`):

| Button | Custom-id | Who | Server-side gate |
|---|---|---|---|
| Raise Hand | `rh:raise:<vcId>` | everyone | — |
| Lower Hand | `rh:lower:<vcId>` | everyone | — |
| Show Queue | `rh:show:<vcId>` | everyone | — (ephemeral reply) |
| Next Speaker | `rh:next:<vcId>` | moderator | `memberHasPermission(user, 'MuteMembers') OR isGuildOwner(user)` |
| Clear Queue | `rh:clear:<vcId>` | moderator | same |

- **Why a server-side re-check:** Discord cannot per-permission gate a button (only
  slash commands honour `default_member_permissions`). So `rh:next` / `rh:clear`
  re-verify the clicker with `memberHasPermission('MuteMembers')` or owner; on
  failure reply `"You need the Mute Members permission to do that."` (ephemeral).
- `handleInteraction` ignores any `customId` not starting with `rh:` (so it never
  touches other modules' components — same isolation as role-menus' `rolemenu:`
  guard).

### Announce on advance

On `/next-speaker` and `rh:next`: after `computeAdvance`, edit the panel message and
post `"🎤 @user is next to speak"` in `announceChannelId` with **allowed-mentions
limited to that one user** (`allowMentions: { users: [externalId] }`). No DMs.

### Command changes

- New: `/speaker-panel`.
- `/next-speaker` (Stage 2) now also edits the panel + posts the announce message
  when the VC has a panel.

### Tests needed

- `logic.test.ts`: `buildPanelMessage` renders the ordered queue + current speaker;
  `buildCustomId`/`parseCustomId` round-trip the 5 actions.
- `service` unit tests: `rh:next`/`rh:clear` rejected for a non-mod, allowed for a
  mod and for the owner (stub `memberHasPermission`/`isGuildOwner`); `rh:raise`
  enqueues; panel refresh called after each mutation.
- A `guild-service` test (or documented integration check) for `memberHasPermission`
  returning `false` on lookup failure (no-throw).

### Risk

**Medium-high.** Edits the **shared `GuildService` contract** (every adapter must
implement it). The method is additive but the interface is implemented in
`discord-adapter/src/guild-service.ts` — that impl **must** be added or the adapter
won't compile. Panel refresh touches Discord message edits (rate-limit aware:
refresh once per change, not in a loop).

### Rollback plan

- Remove the `/speaker-panel` command + the `component.interaction` event entry →
  buttons stop working, slash commands (Stages 2-3) keep working with ephemeral
  replies. `memberHasPermission` can stay (additive, unused) or be reverted.
- The `panelChannelId`/`panelMessageId` columns are nullable → safe to leave unused.

### Docker validation

```bash
docker compose exec app pnpm typecheck     # GuildService contract + Discord impl agree
docker compose exec app pnpm lint
docker compose exec app pnpm --filter @botplatform/raise-hand-module test
docker compose exec app pnpm --filter @botplatform/discord-adapter build
docker compose exec app pnpm build
docker compose restart bot && docker compose logs --tail=50 bot
```

### Acceptance criteria

- **PASS** ⇔ contract + Discord impl typecheck together; `memberHasPermission`
  implemented with the no-throw contract; panel/button unit tests green; mod-button
  server-side gate proven in unit tests (non-mod denied, mod + owner allowed); bot
  boots healthy. (Live button click + live announce mention is integration / Agent 7.)
- **FAIL** ⇔ adapter fails to compile (missing impl), a non-mod can pass the
  server-side gate in tests, or any build/typecheck/lint/test regression.

---

## Stage 5 — Priority support (`/promote-speaker`)

Add moderator priority control. The `priority` column already exists (Stage 1) and
ordering already honours it (`orderEntries`), so this stage is a thin command + one
logic function + tests.

### Files affected / created

| File | Change |
|---|---|
| `packages/raise-hand-module/src/commands.ts` | **Edit:** add `/promote-speaker` (moderator) with a `user` option. |
| `packages/raise-hand-module/src/service.ts` | **Edit:** `promote(vc, userId)` → set the user's `priority = nextPriorityAbove(entries)`; refresh panel. |
| `packages/raise-hand-module/src/logic.ts` | **(Already has `nextPriorityAbove` from Stage 1)** — confirm/finalize. |
| `apps/bot/src/register-commands.ts` | **(No change)** — `/promote-speaker` is collected automatically via `...raiseHand.module.commands`. |

### Command

- `/promote-speaker user:@u` (moderator, `defaultMemberPermissions: ['MuteMembers']`,
  mod must be in the VC): sets the target's `priority` above the current max so they
  jump to the front of `waiting`. If the user has no `waiting` entry → reply
  `"That user isn't in the queue."`

### The documented rule

> **Priority rule:** the queue is ordered by `(priority DESC, raisedAt ASC)`.
> `/promote-speaker @u` sets `@u.priority = max(priority over non-done entries) + 1`,
> which moves them ahead of everyone currently waiting **without** reordering the
> relative order of the others (their `raisedAt` order is preserved among equal
> priorities). Promoting a second user a moment later gives them a still-higher
> number, so the most-recently-promoted user is first. Priority does **not** affect
> the current `active` speaker — it only reorders `waiting`.

### Event / storage changes

**None** — column + ordering already exist.

### Tests needed

- `logic.test.ts`: `nextPriorityAbove` returns `max+1` (and `1` for an empty/all-done
  queue); after promotion, `orderEntries` places the promoted user first; a second
  promotion supersedes the first.
- `service` test: `promote` rejects a user not in the queue; updates only that user's
  `priority`.

### Risk

**Low.** One additive command + one pure function already unit-tested. No shared-file
edits beyond the module itself.

### Rollback plan

- Remove the `/promote-speaker` command definition from `commands.ts`. Ordering and
  the `priority` column remain (default `0` → behaves as plain FIFO).

### Docker validation

```bash
docker compose exec app pnpm --filter @botplatform/raise-hand-module test
docker compose exec app pnpm typecheck
docker compose exec app pnpm lint
docker compose restart bot && docker compose logs --tail=50 bot
```

### Acceptance criteria

- **PASS** ⇔ priority/ordering unit tests green; `/promote-speaker` moves a waiting
  user to the front in tests; rejects a non-queued user; typecheck + lint clean; bot
  healthy.
- **FAIL** ⇔ promotion doesn't reorder, affects the active speaker, or regresses
  ordering tests.

---

## Stage 6 — Persistence polish + optional admin page + full regression

State is **already DB-backed from Stage 1**, so this stage is **verification +
optional admin surface + the full regression gate**, not new core behaviour.

### Files affected / created

| File | Change |
|---|---|
| *(optional)* `apps/admin/src/routes/raise-hand.ts` | **New (optional):** read-only `AdminRoutePlugin` listing each guild's queues + entries (mirrors `apps/admin/src/routes/announcements.ts` structure). Registered in `apps/admin/src/routes/index.ts` **before** the `placeholders.ts` catch-all. |
| *(optional)* `apps/admin/views/raise-hand.ejs` | **New (optional):** the list view. |
| `docs/raise-hand/commands-and-interactions.md` | **(Agent 6/8)** finalized against shipped code. |

If the admin page is **out of scope for now**, this stage is purely the regression
gate + a note that state survives restart.

### "State survives restart" verification

- Raise a hand, post a panel, restart the `bot` container, confirm the queue +
  panel binding persist (rows in `speaker_queues` / `speaker_queue_entries` are
  unchanged; the panel can be refreshed and still maps to the same VC). This proves
  the persistence requirement without any new code.

### Command / event / storage changes

**None required.** (Optional admin route is read-only and additive.)

### Tests needed

- Full monorepo test suite (all modules) to confirm no regression.
- If the admin page ships: a route smoke test (auth guard + renders) like the other
  admin routes.

### Risk

**Low** (regression-only) — **Medium** if the optional admin page ships (couples the
SSR app to the new repo, like other modules already do; keep `placeholders.ts` last
in `routes/index.ts`).

### Rollback plan

- The optional admin route is independently removable (delete the route + view, drop
  it from `routes/index.ts`); the bot feature is unaffected. No DB change to roll
  back.

### Docker validation (full gate)

```bash
docker compose exec app pnpm typecheck
docker compose exec app pnpm lint
docker compose exec app pnpm test               # full suite, all modules
docker compose exec app pnpm build              # bot + admin
docker compose exec app pnpm db:migrate         # idempotent re-apply
docker compose restart bot admin
docker compose ps                               # db, app, bot, admin all Up/healthy
docker compose logs --tail=80 bot               # no errors; module registered
```

### Acceptance criteria

- **PASS** ⇔ full `test` + `typecheck` + `lint` + `build` green; `db:migrate`
  idempotent; all containers `Up/healthy` after restart; queue + panel state
  verified to survive a `bot` restart. If the admin page shipped, its route renders
  behind auth.
- **FAIL** ⇔ any regression in the full suite, a container unhealthy, state lost on
  restart, or (if shipped) the admin route errors / leaks past its auth guard.

---

## Cross-stage validation summary

| Stage | Primary gate command(s) | Live-only (Agent 7, needs valid token) |
|---|---|---|
| 1 | `test` (logic) · `db:generate` · `db:migrate` · `typecheck` | — |
| 2 | `typecheck` · `lint` · module `test` · `build` · bot restart | live slash registration |
| 3 | `typecheck` (union) · core+adapter `build` · module `test` | live "leave VC drops entry" |
| 4 | `typecheck` (GuildService) · adapter `build` · module `test` | live button click + announce mention |
| 5 | module `test` · `typecheck` · `lint` | live priority reorder |
| 6 | full `test` · `build` · `db:migrate` · `ps` healthy | end-to-end VC session |

**Definition of "validated":** only what is actually run (`build`/`test`/`lint`/
`typecheck`/`db:migrate`) or directly observed. Live Discord behaviour (real VC
join/leave, real slash registration, real button clicks, the announce mention) is
**integration / Agent 7** and depends on a valid `DISCORD_TOKEN`; if the token is
malformed (a known repo risk), those checks are reported **PARTIAL**, not PASS.

---

## Checkpoint

Status: PASS

### Validat
- Every stage's **file list** verified against real source: `MODULE_KEYS`
  (`packages/shared/src/types.ts`), schema patterns + `uniqueIndex`/`.where()`
  partial-index style (`packages/database/src/schema.ts`, `roleMenus`/
  `roleAssignmentLogs`/`birthdays`), the 4-touchpoint wiring (`apps/bot/src/main.ts`
  line 126, `register-commands.ts` lines 56-62/82, `seed.ts` line 50), command shape
  (`role-menus-module/src/commands.ts`), module factory (`role-menus-module/src/
  index.ts`), the `PlatformEvent` union + `ComponentInteractionEvent.update`
  (`core/src/contracts/events.ts`), `GuildService` (`core/src/contracts/
  guild-service.ts`), and the adapter event-emission site (`adapter.ts` lines
  129-137, `GuildVoiceStates` already requested line 73).
- The plan honours the locked design (00 §3) exactly: table/column names, command
  names + permissions, `rh:` custom-ids, the `voice.state.update` event shape, the
  additive `memberHasPermission`, announce-with-limited-mentions, no new runtime
  deps.
- Each stage is independently testable and independently revertible; Docker
  validation commands match the project's `docker compose exec app pnpm …` workflow.

### Nevalidat
- `packages/discord-adapter/src/guild-service.ts` implementation not read this
  session (Stage 4 will read it before adding `memberHasPermission`; the 00 plan
  flags the same).
- No code built/tested — this is a plan; the Docker commands are specified, not yet
  run (that is Agent 6).
- Live Discord behaviour (token validity) unverified — flagged as PARTIAL-risk for
  the live-only checks.
- Whether Drizzle's generated migration emits the partial index exactly as
  `WHERE (status <> 'done')` is asserted from Drizzle behaviour, to be confirmed by
  inspecting the generated SQL in Stage 1.

### Probleme
- Four manual mirrors must stay in sync (`MODULE_KEYS`, `main.ts`,
  `register-commands.ts`, `seed.ts`) — Stage 2 calls this out explicitly.
- Stages 3 and 4 edit shared core/adapter contracts (`events.ts`, `guild-service.ts`)
  — additive, but every consumer must still typecheck; flagged as the highest-risk
  stages with explicit rollback.
- Live VC / slash-registration validation depends on a possibly-malformed
  `DISCORD_TOKEN`; report PARTIAL if unavailable.

### Următorul agent poate continua?
Da. Agent 6 has an exact, ordered, file-level build map with per-stage Docker gates
and rollbacks; each stage compiles/tests independently, so implementation can proceed
sequentially with a green gate before advancing. The only read still owed is
`discord-adapter/src/guild-service.ts` immediately before Stage 4.
