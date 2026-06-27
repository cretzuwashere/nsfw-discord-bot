# 01 — Current Bot Interaction Analysis

> Agent: **AGENT 1 — Current Bot Interaction Analysis** (Raise Hand / Speaker Queue)
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)
> Purpose: document how the bot **currently** turns Discord interactions into
> module behaviour, so the new `raise-hand` module plugs into the *existing*
> seams instead of inventing new ones.

This is verified from source (every file below was read this pass). It is the
"current state" baseline for the locked raise-hand design in
[`00-orchestrator-plan.md`](00-orchestrator-plan.md).

## Files read this pass

- `packages/discord-adapter/src/adapter.ts` (gateway listeners, interaction pipeline, voice capability)
- `packages/core/src/contracts/events.ts` (`PlatformEvent` union)
- `packages/core/src/contracts/commands.ts` (`CommandDefinition`, `CommandContext`)
- `packages/core/src/contracts/module.ts` (`BotModule`, `ModuleEventHandler`)
- `packages/core/src/contracts/guild-service.ts` (`GuildService` surface)
- `packages/core/src/registry.ts` (`ModuleRegistry` dispatch + error boundary)
- `packages/core/src/module-state.ts` (`CachedModuleState`)
- Module command sources: `audio-module/src/commands.ts`, `audio-module/src/index.ts`,
  `audio-module/src/now-playing.ts`, `moderation-module/src/commands.ts`,
  `announcements-module/src/commands.ts`, `role-menus-module/src/{index,commands,service}.ts`,
  `custom-commands-module/src/index.ts`, `reminders-module/src/index.ts`,
  `birthdays-module/src/index.ts`
- `moderation-module/src/services/permission-service.ts` (RBAC foundation)
- Wiring: `apps/bot/src/main.ts`, `apps/bot/src/register-commands.ts`,
  `packages/database/src/seed.ts`, `packages/shared/src/types.ts` (`MODULE_KEYS`)

**Commands run:** none — read-only (Read/Grep/Glob). No build/test/docker.

---

## 1. Existing slash commands (by owning module)

Every command is `guildOnly: true` today. Commands are defined as
`CommandDefinition[]` (see `commands.ts`) either in a dedicated `commands.ts`
(audio, moderation, announcements, role-menus) or inline in the module's
`index.ts` (custom-commands, reminders, birthdays). Moderation uses
`defaultMemberPermissions` for Discord-side gating; no other current module does.

| Module (key) | Command | Subcommands | Discord permission gate |
|---|---|---|---|
| **Audio Player** (`audio-player`) | `/join` | — | none (everyone) |
| | `/leave` | — | none |
| | `/play` (opt `url`) | — | none |
| | `/queue` | — | none |
| | `/skip` | — | none |
| | `/pause` | — | none |
| | `/resume` | — | none |
| | `/stop` | — | none |
| | `/nowplaying` | — | none |
| | `/controls` | — | none |
| **Moderation** (`moderation`) | `/warn` (user, reason) | — | `ModerateMembers` |
| | `/warnings` (user) | — | `ModerateMembers` |
| | `/clearwarnings` (user) | — | `ModerateMembers` |
| | `/timeout` (user, minutes, reason?) | — | `ModerateMembers` |
| | `/untimeout` (user, reason?) | — | `ModerateMembers` |
| | `/kick` (user, reason?) | — | `KickMembers` |
| | `/ban` (user, reason?, delete_days?) | — | `BanMembers` |
| | `/unban` (user_id, reason?) | — | `BanMembers` |
| | `/purge` (amount) | — | `ManageMessages` |
| | `/slowmode` (seconds) | — | `ManageChannels` |
| | `/lock` (reason?) | — | `ManageChannels` |
| | `/unlock` (reason?) | — | `ManageChannels` |
| **Announcements** (`announcements`) | `/announcement` | `list`, `preview` (id), `send` (id), `cancel` (id) | none |
| **Reaction Roles** (`role-menus`) | `/roles` | `list`, `menu` (id), `refresh` (id), `remove` (id) | none |
| **Custom Commands** (`custom-commands`) | `/custom` (name) | — | none |
| **Reminders** (`reminders`) | `/reminder` | `create` (message, when, here?, repeat?), `list`, `remove` (id) | none |
| **Birthdays** (`birthdays`) | `/birthday` | `set` (month, day, year?, timezone?), `view`, `remove`, `upcoming` | none |

Modules with **no slash commands** (event-driven or admin-panel-driven only):
**Welcome** (`welcome`), **Dynamic Cards** (`dynamic-cards`), **Scheduled
Messages** (`scheduled-messages`), **Auto-Moderation** (`automod`). These are
correctly absent from `register-commands.ts` (see §8).

> **Correction to the brief:** the audio module's key is **`audio-player`** (not
> `audio`) and its name is **`Audio Player`** — verified in
> `audio-module/src/index.ts:61` and `shared/src/types.ts` (`MODULE_KEYS.audioPlayer`).
> The raise-hand commands (`/raise-hand`, `/next-speaker`, etc.) must not collide
> with any name above; `ModuleRegistry.register` throws on a duplicate command
> name at registration time (`registry.ts:38-44`).

---

## 2. The interaction pipeline (command path)

`packages/discord-adapter/src/adapter.ts` is the **only** place discord.js is
touched. The end-to-end command flow:

1. **Gateway → adapter.** The client subscribes to `Events.InteractionCreate`
   (`adapter.ts:124`) and calls `handleInteraction(interaction)`.
2. **Type split** (`handleInteraction`, `adapter.ts:190`):
   - `interaction instanceof ChatInputCommandInteraction` → **command path**.
   - `interaction.isButton() || interaction.isStringSelectMenu()` → **component
     path** (§3).
3. **Build `CommandContext`** (`buildCommandContext`, `adapter.ts:335`). It maps
   the Discord interaction to the adapter-neutral `CommandContext`:
   `commandName`, `subcommand` (`options.getSubcommand(false)`), `guildId`,
   `channelId`, `user{id, displayName}`, a flattened `options` record (only
   `string|number|boolean` values; `user`/`channel` options arrive as the
   selected entity's **id string**), a child `logger`, and the per-invocation
   `voice` capability (null outside a guild). It also wires `defer()`,
   `reply()`, and `replyRich?()` onto the live interaction.
4. **Dispatch.** The adapter calls `ctx.dispatch(commandContext)` — `ctx` here is
   the `AdapterContext` whose `dispatch` is the `CommandDispatcher` built by
   `ModuleRegistry.createDispatcher` (`registry.ts:95`).
5. **Registry dispatcher** (`registry.ts:102-153`), the command **error boundary**:
   - Unknown command → `"Unknown command."` (ephemeral).
   - `guildOnly && !guildId` → `"This command only works inside a server."`.
   - `!moduleState.isEnabled(module.key)` → `"The <Name> module is currently
     disabled."` (data-driven on/off, §6).
   - Else `runCommand(command, ctx)` → routes to the matching `subcommands[].execute`
     or the flat `execute` (`registry.ts:157-172`).
   - On success: `audit.record({ action: '<key>.command.<name>' })`.
   - On throw: logs the real error, records `…command.<name>.error` with **only**
     `toSafeUserMessage(error)` in metadata, and replies `toSafeUserMessage(error)`.
6. **Last-resort boundary.** If `ctx.dispatch` itself rejects, the adapter catches
   it (`adapter.ts:198-210`) and sends `GENERIC_USER_ERROR` via `reply`/`editReply`.

**Error-boundary rule (load-bearing for raise-hand):** the **only** user-visible
error text is `UserFacingError.safeMessage` via `toSafeUserMessage(error)`. A
plain `Error` becomes the generic message; throwing `UserFacingError('CODE',
'msg')` is how a handler surfaces a specific message (audio's `requireVoice`
throws `UserFacingError('VOICE_UNAVAILABLE', …)` — `audio-module/src/commands.ts:21`).
Raise-hand's "Join a voice channel first." / "You're the current speaker." style
messages should be plain `ctx.reply({ ephemeral: true })` returns (the common
pattern), reserving thrown `UserFacingError` for genuine error conditions.

---

## 3. Button / select handling (component path)

Buttons and string-select submissions are **not** a separate dispatcher — they
are folded into the same `PlatformEvent` machinery as member/message events.

**How the event is built** (`adapter.ts:215-260`): for
`isButton() || isStringSelectMenu()`, the adapter constructs a
`ComponentInteractionEvent` (`events.ts:61-78`):

- `type: 'component.interaction'`, `adapterKey`, `guild` (`{id:null, externalId,
  name}` or null in DMs), `channelId`.
- `customId` — the routing string the originating module encoded.
- `values` — selected option values for selects; `[]` for buttons.
- `user` — `PlatformUserRef` (carries `externalId`).
- `userRoleIds` — the clicking member's role ids (from `interaction.member.roles`,
  array or cache keys).
- `reply(content)` — ephemeral ack; **idempotent** (first call `reply`, later
  calls `followUp`); guarded by an `acknowledged` flag.
- `update?(message)` — edits the message **in place** (used to refresh a live
  panel). Builds the payload via `buildMessagePayload`; first call `interaction.update`,
  later calls `editReply`.

**Dispatch + auto-ack** (`adapter.ts:261-269`): the adapter calls
`ctx.dispatchEvent(event)`. **If no module acknowledged** (`!acknowledged`), it
calls `interaction.deferUpdate()` so Discord doesn't render "interaction failed".
This means a module can safely ignore a `customId` that isn't its own.

**Routing is by `customId` prefix — every consumer must filter first:**

- **Role-menus** (`role-menus-module/src/service.ts:30`): `handleInteraction`
  runs `parseCustomId(event.customId)`; returns early if it doesn't match or
  `event.guild` is null. Button customIds carry a role id; selects use
  `event.values`. It computes role changes and calls `service.addRole/removeRole`,
  then `event.reply(...)`. Subscribed via
  `events: [{ type: 'component.interaction', handle: … }]` in
  `role-menus-module/src/index.ts:50-55`.
- **Audio** (`audio-module/src/commands.ts:282` `buildAudioComponentHandler`):
  `parseAudioButton(event.customId)` returns null for non-audio buttons (prefix
  **`audio:`**, `now-playing.ts:11`) — handler **returns immediately** if so.
  Otherwise it performs the action via the `PlayerManager` and refreshes the
  now-playing panel with `event.update(panel)` (falling back to `event.reply`).
  Subscribed in `audio-module/src/index.ts:74`.

**Dispatch fan-out** (`registry.ts:68-89`): `createEventDispatcher` sends the
event to **all** handlers whose `handler.type === event.type` (here
`component.interaction`) **for enabled modules only**, each isolated in a
`try/catch`. So multiple modules receive every button click and must
prefix-filter — raise-hand's panel buttons use prefix **`rh:`** (per the locked
design) and must early-return on any non-`rh:` customId, exactly like audio/role-menus.

> **Implication for raise-hand:** the control panel buttons reuse this exact
> path. No adapter change is needed for buttons. Server-side moderator re-checks
> (the design's `memberHasPermission`) happen **inside** the handler using
> `event.user.externalId` + `event.userRoleIds` and the (to-be-added)
> `GuildService.memberHasPermission` / existing `isGuildOwner`.

---

## 4. Event listeners (gateway → PlatformEvent map) — and the voice gap

The adapter's client subscribes to exactly these gateway events
(`adapter.ts:87-137`):

| Gateway event (`Events.*`) | Adapter handler | Emits `PlatformEvent`? |
|---|---|---|
| `ClientReady` (once) | sets status, audits `discord.connected`, records guilds | no (lifecycle) |
| `Error` | logs + audits `discord.connection.error` | no |
| `ShardDisconnect` | status → `disconnected` | no |
| `ShardResume` | status → `connected` | no |
| `InteractionCreate` | `handleInteraction` → command **or** `component.interaction` | yes (commands via `dispatch`; buttons/selects via `dispatchEvent`) |
| `GuildMemberAdd` | `emitMemberEvent('member.join', …)` | **`member.join`** |
| `GuildMemberRemove` | `emitMemberEvent('member.leave', …)` | **`member.leave`** |
| `MessageCreate` | `emitMessageCreate` (skips bots & non-guild) | **`message.create`** |

The complete current `PlatformEvent` union (`events.ts:80-84`):
`MemberJoinEvent | MemberLeaveEvent | MessageCreateEvent | ComponentInteractionEvent`.

**THE GAP raise-hand fills (explicit):** there is **no `Events.VoiceStateUpdate`
listener** and **no voice event** in the union today. A re-grep of
`packages/` for `VoiceStateUpdate` / `voice.state` / `voiceState` returns **zero
production hits** (the only historical match was a stale index entry, not present
on re-read). Voice is touched only at *command time* via the per-invocation
`VoiceCapability` (`adapter.ts:412` `buildVoiceCapability`): `getUserVoiceChannel()`
(caller's current VC), `getActiveSession()`, `join(channelId)` — there is **no
push notification when a user joins/leaves/moves VC**.

Crucially, the gateway intent needed to *receive* those updates is **already
enabled**: `GatewayIntentBits.GuildVoiceStates` is in the default intent list
(`adapter.ts:71-76`), unconditionally (not behind the `enableGuildMembers` /
`enableMessageContent` opt-ins). So the locked design's new
**`voice.state.update`** event only needs (a) a new member of the `PlatformEvent`
union in `events.ts`, and (b) a `client.on(Events.VoiceStateUpdate, …)` listener
in `adapter.ts` that emits it — **no privileged-intent / portal change**, and the
existing dispatcher fan-out + module-enabled gating handle the rest unchanged.

---

## 5. Code organization pattern (per module + composition root)

Uniform across every module (verified again here):

- **Factory:** `packages/<name>-module/src/index.ts` exports
  `create<Name>Module(options) → { module: BotModule, … }`. The handle carries
  the `BotModule` plus extras the app needs (`service`, `repo`, `schedulerJob`,
  audio admin actions).
- **`BotModule` shape** (`module.ts:47-59`): `key`, `name`, `description`,
  `commands: CommandDefinition[]`, optional `metadata`, optional
  `events: ModuleEventHandler[]`, optional `onLoad`/`onShutdown`.
- **`commands.ts`** — present where command-building is non-trivial (audio,
  moderation, announcements, role-menus); custom-commands/reminders/birthdays
  define their single command inline in `index.ts`.
- **`service.ts`** — orchestration that calls the `GuildService` and repos
  (role-menus, announcements). **Reference module for a button-driven feature is
  `role-menus-module`** (`index/commands/service/logic/repo`), which the
  raise-hand package mirrors.
- **`logic.ts`** — pure functions (role-menus `computeRoleChanges`, `parseCustomId`;
  unit-tested in isolation).
- **`repo.ts`** — Drizzle data access (per module).
- **Composition root:** `apps/bot/src/main.ts` is the only place that imports
  concrete modules + the `DiscordAdapter` + DB factories and injects them into
  `new BotKernel({ modules:[…], adapters:[adapter], audit, moduleState, … })`.
  The adapter is passed as the `GuildServiceProvider` to DB modules
  (`guildServiceProvider: adapter`). Scheduler jobs and health indicators are
  registered here too.
- **`apps/bot/src/register-commands.ts`** — separate CLI that re-instantiates
  *only the command-owning* modules (with a `NOOP_GUILD_PROVIDER`) to harvest
  command shapes and push them to Discord.
- **`packages/database/src/seed.ts`** — idempotent built-in module rows (the
  `modules` table; controls enable/disable).

---

## 6. State / persistence (Drizzle, repos, module on/off)

- **Single schema:** `packages/database/src/schema.ts` (one file; uuid PKs,
  `guildId` FK → `guilds.id` cascade, timestamptz defaults). Migrations are
  **generated** by drizzle-kit (`pnpm db:generate`); never hand-edited.
- **Per-module repos:** each DB module owns a `repo.ts`/`repositories/*` and the
  admin imports the same repo factories — one data-access layer for bot + panel.
- **Module enable/disable is data-driven.** The `modules` table row (seeded in
  `seed.ts`) is the on/off switch. The dispatcher consults
  `moduleState.isEnabled(module.key)` on **every** command *and* every event
  (`registry.ts:78`, `:115`).
- **`CachedModuleState`** (`module-state.ts`) wraps the DB-backed
  `ModuleStatePort` with a **10s TTL** and a "last known value / default enabled"
  fallback, so a DB hiccup never silences the bot. The admin `/modules` toggle
  flips the row; the change takes effect within the TTL.
- **Default-enabled state (seed):** only **Audio Player** and **Announcements**
  seed `defaultEnabled: true`; every other built-in module (including the future
  raise-hand) seeds **disabled** — operators turn it on in the panel. A disabled
  raise-hand module answers commands with the polite "module is currently
  disabled" message and its event handlers are skipped (the dispatcher filters by
  `isEnabled`), so its `voice.state.update` handler is also inert until enabled.

---

## 7. Permission system (current)

Three layers exist; raise-hand uses the first and third:

1. **Discord `defaultMemberPermissions`** (`commands.ts` `CommandDefinition`):
   an array of Discord permission names mapped to Discord's
   `default_member_permissions`. Discord enforces command **visibility/use**
   server-side. Today **only moderation** sets it (`ModerateMembers`,
   `KickMembers`, `BanMembers`, `ManageMessages`, `ManageChannels`). The
   raise-hand moderator commands use `['MuteMembers']` per the locked design.
2. **RBAC foundation** (`moderation-module/src/services/permission-service.ts` +
   the `permission_mappings` table): maps adapter role ids → platform permission
   keys (`hasPermission`, `grant`, `revoke`, `listForGuild`). This is a
   *foundation* used by moderation/admin; raise-hand does **not** need it for MVP.
3. **`GuildService` checks** (`guild-service.ts`): `botHasPermission`,
   `getMemberRoleIds`, **`isGuildOwner`** — and the moderation `runAction`
   already uses `isGuildOwner` to protect the owner. Buttons cannot be gated by
   Discord per-permission, so panel moderator buttons must be **re-checked
   server-side**. The locked design adds an additive
   `memberHasPermission(userExternalId, permission)` to `GuildService`
   (Discord impl: `member.permissions.has(PermissionFlagsBits[name])`) and gates
   `rh:next` / `rh:clear` with `memberHasPermission('MuteMembers') || isGuildOwner`.

**Pattern to copy:** moderator slash commands gate via Discord
`defaultMemberPermissions`; moderator **buttons** re-check in the handler using
`event.user.externalId` + `GuildService`. Everyone-level commands/buttons
(`/raise-hand`, `/lower-hand`, `/speaker-queue`, `rh:raise`, `rh:lower`,
`rh:show`) carry no gate.

---

## 8. Integration points where raise-hand attaches (the 5 wiring touchpoints)

These are the exact seams a new module must edit (none require new
infrastructure — all are additive):

1. **`packages/shared/src/types.ts`** — add `raiseHand: 'raise-hand'` to
   `MODULE_KEYS`. (`ModuleKey` is derived from it; the seed + factory must use
   the same string.)
2. **`packages/database/src/schema.ts` + a generated migration** — add the
   `speaker_queues` and `speaker_queue_entries` tables (locked design), then
   `pnpm db:generate` to emit the migration (do not hand-write it).
3. **`packages/database/src/seed.ts`** — add a built-in `modules` row for
   `MODULE_KEYS.raiseHand` (name "Speaker Queue"), `defaultEnabled: false` (matches
   every non-audio/announcements module).
4. **`apps/bot/src/main.ts`** — build the handle
   (`createRaiseHandModule({ config, logger, db, audit, guildServiceProvider:
   adapter })`) and add `…Handle.module` to the `modules: [...]` array passed to
   `BotKernel`. (No scheduler job needed; the feature is event + command driven.)
5. **`apps/bot/src/register-commands.ts`** — instantiate the module with
   `NOOP_GUILD_PROVIDER` and spread its `module.commands` into the `commands`
   array, or the new slash commands never reach Discord. This file is a **manual
   mirror** of the command-owning modules (audio, moderation, announcements,
   role-menus, custom-commands, reminders, birthdays today) — forgetting it is
   the classic "command registered in code but invisible in Discord" bug.

**Two further additive edits required by the voice-leave feature** (outside the
generic 5, but in shared surfaces — regression-check carefully):

- **`packages/core/src/contracts/events.ts`** — add the `VoiceStateUpdateEvent`
  interface to the `PlatformEvent` union.
- **`packages/discord-adapter/src/adapter.ts`** — add the
  `client.on(Events.VoiceStateUpdate, …)` listener that emits it (intent already
  enabled), plus the additive `GuildService.memberHasPermission` impl in
  `guild-service.ts` (and the contract in `core`). Because the adapter and core
  contracts are shared by every module, these must not change any existing
  signature — only add.

---

## Checkpoint

Status: PASS

### Validat
- All current slash commands + subcommands + permission gates enumerated by
  reading each command source (audio, moderation, announcements, role-menus,
  custom-commands, reminders, birthdays). Modules with no commands (welcome,
  dynamic-cards, scheduled-messages, automod) confirmed and shown absent from
  `register-commands.ts`.
- Command pipeline traced end-to-end: `InteractionCreate` →
  `handleInteraction` → `buildCommandContext` → `ctx.dispatch` →
  `ModuleRegistry.createDispatcher` → `runCommand` → `execute`. Error boundary
  (`toSafeUserMessage` only) confirmed in `registry.ts` + adapter last-resort.
- Component path confirmed: `ComponentInteractionEvent` shape (`customId`,
  `values`, `userRoleIds`, idempotent `reply`, in-place `update`), auto-`deferUpdate`
  when unacked, fan-out to all enabled `component.interaction` handlers, and
  prefix-filtering in role-menus (`parseCustomId`) and audio (`audio:` prefix).
- Gateway listener list verified against `adapter.ts` and mapped to each
  `PlatformEvent`. **No `VoiceStateUpdate` listener / no voice event** confirmed
  by reading the adapter and a clean re-grep; `GuildVoiceStates` intent confirmed
  already-enabled at `adapter.ts:71-76`.
- Module organization (index/commands/service/logic/repo), composition root
  (`main.ts`), `register-commands.ts`, and `seed.ts` read and described.
- Persistence + on/off: `modules` table, `CachedModuleState` 10s TTL fallback,
  dispatcher `isEnabled` check on commands and events — all read.
- Permission layers read: `defaultMemberPermissions` (moderation only),
  `permission_mappings`/`PermissionService`, `GuildService.isGuildOwner` /
  `getMemberRoleIds` / `botHasPermission`.
- The 5 wiring touchpoints + the 2 additive voice/permission edits located in
  the exact files.

### Nevalidat
- `packages/discord-adapter/src/guild-service.ts` implementation body not read
  this pass (contract surface read in `core`; impl to be read before Stage 4
  when `memberHasPermission` is added).
- `packages/core/src/contracts/voice.ts` read indirectly (via adapter usage +
  prior memory), not line-by-line this pass.
- No build/test/typecheck executed (read-only agent; Docker validation owned by
  the implementation/regression stages).

### Probleme
- **Naming correction:** audio module key is `audio-player` / name "Audio
  Player" (brief said "audio"). Documented above so later agents don't assume a
  `audio` key.
- `register-commands.ts` is a manual mirror of command-owning modules — easy to
  forget for raise-hand (would silently skip slash-command registration).
- `voice.state.update` + `memberHasPermission` touch shared surfaces (core
  contracts + adapter + guild-service) used by all modules — additive only, must
  be regression-checked.

### Următorul agent poate continua?
Da. The current interaction model is fully mapped to source: the command path,
the `component.interaction` button/select path (which raise-hand's panel reuses
verbatim), the gateway→event map, the confirmed absence of any voice event/listener
(the gap), the data-driven enable/disable + 10s-TTL state, the permission layers,
and the exact files for all wiring touchpoints. Agents 2–5 can design against
these seams, and Agent 6 has an unambiguous attach map (5 generic touchpoints +
the additive `voice.state.update` event and `memberHasPermission` edits).
