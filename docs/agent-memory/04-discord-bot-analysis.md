# 04 — Discord Bot Domain Analysis

> Agent: **AGENT 4 — DISCORD BOT DOMAIN**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)

## Agent purpose

Study `botplatform` as a Discord product and document — exhaustively and
**verified in code** — every slash command and subcommand, every platform/Discord
event the bot listens to, every interaction handler (buttons, select menus,
modals, reactions), the main end-to-end usage flows, the gateway intents and
permissions each feature needs, the roles/channels/server settings the bot
depends on, what data it persists and where, and which configuration is
hardcoded vs from env/DB. Produces this memory file plus two technical
references (`docs/technical/discord-bot-flows.md`,
`docs/technical/commands-and-events.md`).

## Files analyzed (verified by reading)

- Entry / CLI: `apps/bot/src/main.ts`, `apps/bot/src/register-commands.ts`.
- Adapter package: `packages/discord-adapter/src/adapter.ts`,
  `command-mapper.ts`, `register-commands.ts`, `guild-service.ts`,
  `voice-session.ts`.
- Core contracts: `packages/core/src/contracts/commands.ts`, `events.ts`,
  `module.ts`; dispatch in `packages/core/src/registry.ts`.
- Module command files: `packages/audio-module/src/commands.ts` +
  `now-playing.ts` + `index.ts`; `packages/moderation-module/src/commands.ts` +
  `index.ts`; `packages/announcements-module/src/commands.ts` + `index.ts`;
  `packages/role-menus-module/src/commands.ts` + `logic.ts` + `service.ts` +
  `index.ts`.
- Modules whose commands/events are defined inline in `index.ts`:
  `packages/birthdays-module/src/index.ts`, `reminders-module/src/index.ts`,
  `custom-commands-module/src/index.ts`, `welcome-module/src/index.ts`,
  `automod-module/src/index.ts`, `scheduled-messages-module/src/index.ts`,
  `cards-module/src/index.ts`.
- Config / contracts of record: `packages/config/src/index.ts`,
  `packages/shared/src/types.ts` (MODULE_KEYS, ADAPTER_KEYS).
- Cross-cut greps: `SlashCommandBuilder`, `addSubcommand`, `ButtonBuilder`,
  `StringSelectMenu`, `ModalBuilder`, `MessageReaction*`, `reaction`,
  `requiredIntents`, `requiredPermissions` (results documented below).

## Commands run

**None — read-only analysis.** Only Glob/Grep/Read were used. No
pnpm/node/npm/build/test/docker commands were executed (host has no Node;
another process owns real validation).

## What was discovered (high level)

1. **Command shapes are adapter-neutral.** Modules never call discord.js
   builders. They return `CommandDefinition[]` (core contract,
   `packages/core/src/contracts/commands.ts`). The adapter converts them to
   Discord JSON in `packages/discord-adapter/src/command-mapper.ts`. So
   `SlashCommandBuilder`/`addSubcommand` **do not appear** in module code — the
   grep for them returns nothing in modules; the equivalent is `subcommands: []`
   and `options: []` on a `CommandDefinition`. (Verified.)
2. **11 top-level slash commands have subcommands/flat shapes across 7
   command-owning modules.** Exactly 7 modules contribute commands; 4 modules
   (welcome, cards, automod, scheduled-messages) contribute **zero** commands
   and act only on events/schedulers. (Verified in each `index.ts`.)
3. **Registration set ≠ full runtime set.** `apps/bot/src/register-commands.ts`
   registers commands from **7 modules**: audio, moderation, announcements,
   role-menus, custom-commands, reminders, birthdays. The runtime kernel
   (`apps/bot/src/main.ts`) wires **11 module handles** but the non-command
   modules (welcome, cards, automod, scheduled-messages) contribute no slash
   commands, so the two lists are consistent. (Verified — see Problems #1 for
   the one nuance.)
4. **Three platform event types only.** `packages/core/src/contracts/events.ts`
   defines `member.join`, `member.leave`, `message.create`,
   `component.interaction`. The Discord adapter maps gateway events
   `GuildMemberAdd`/`GuildMemberRemove`/`MessageCreate`/`InteractionCreate`
   onto these. (Verified in `adapter.ts`.)
5. **No raw emoji reactions, no modals.** Despite the role-menus module being
   named "Reaction Roles" and the DB enum `role_menu_type` including
   `'reaction'`, there is **no `MessageReactionAdd` listener and no
   `GuildMessageReactions` intent**; `buildMenuMessage`
   (`packages/role-menus-module/src/logic.ts:138`) publishes "reaction"-type
   menus as **buttons** in v1. There are **no `ModalBuilder` usages anywhere**.
   So all interactivity is buttons + string select menus, routed through one
   `component.interaction` event. (Verified by grep + reading.)
6. **Two privileged intents are opt-in and gated by env flags.**
   `packages/discord-adapter/src/adapter.ts` requests
   `Guilds`, `GuildVoiceStates`, `GuildMessages`, `GuildModeration` always; it
   adds `GuildMembers` only when `DISCORD_ENABLE_GUILD_MEMBERS=true` and
   `MessageContent` only when `DISCORD_ENABLE_MESSAGE_CONTENT=true`. Requesting a
   privileged intent that is not also enabled in the Discord developer portal
   makes the gateway reject the connection (close code 4014). (Verified — see
   the inline comment block in `adapter.ts` lines ~62-82.)

## Verified findings — commands

Source of truth: each module's `commands.ts`/`index.ts`. Every command is
`guildOnly: true` unless noted (the mapper emits `contexts: [0]` for those).
"Owner module" is the module key from `packages/shared/src/types.ts`.

### Audio Player (`audio-player`) — `packages/audio-module/src/commands.ts`
Flat commands (no subcommands), all `guildOnly`, no `defaultMemberPermissions`:
`join`, `leave`, `play <url:string,required>`, `queue`, `skip`, `pause`,
`resume`, `stop`, `nowplaying`, `controls`. (10 commands.)

### Moderation (`moderation`) — `packages/moderation-module/src/commands.ts`
Flat commands, all `guildOnly`, each gated by `defaultMemberPermissions`:
- `warn <user,reason>` — `ModerateMembers`
- `warnings <user>` — `ModerateMembers`
- `clearwarnings <user>` — `ModerateMembers`
- `timeout <user,minutes,reason?>` — `ModerateMembers`
- `untimeout <user,reason?>` — `ModerateMembers`
- `kick <user,reason?>` — `KickMembers`
- `ban <user,reason?,delete_days?>` — `BanMembers`
- `unban <user_id:string,reason?>` — `BanMembers`
- `purge <amount:int>` — `ManageMessages`
- `slowmode <seconds:int>` — `ManageChannels`
- `lock <reason?>` — `ManageChannels`
- `unlock <reason?>` — `ManageChannels`
(12 commands. Built only when `db` + `guildServiceProvider` present, else `[]` —
verified in `moderation-module/src/index.ts:52-61`.)

### Announcements (`announcements`) — `packages/announcements-module/src/commands.ts`
One parent `announcement` with subcommands: `list`, `preview <id>`,
`send <id>`, `cancel <id>`. (`guildOnly`.)

### Reaction Roles (`role-menus`) — `packages/role-menus-module/src/commands.ts`
One parent `roles` with subcommands: `list`, `menu <id>`, `refresh <id>`,
`remove <id>`. (`guildOnly`.)

### Birthdays (`birthdays`) — `packages/birthdays-module/src/index.ts`
One parent `birthday` with subcommands: `set <month,day,year?,timezone?>`,
`view`, `remove`, `upcoming`. (`guildOnly`, opt-in.)

### Reminders (`reminders`) — `packages/reminders-module/src/index.ts`
One parent `reminder` with subcommands:
`create <message,when,here?,repeat?>`, `list`, `remove <id>`. (`guildOnly`.)

### Custom Commands (`custom-commands`) — `packages/custom-commands-module/src/index.ts`
One flat dispatcher command `custom <name:string,required>` (`guildOnly`). User
custom commands are NOT individually registered as slash commands — they are
looked up by name from the DB at runtime (deliberate, to avoid dynamic slash
registration; comment at `index.ts:32-33`).

### Modules with NO commands (verified `commands: []`)
- Welcome / Leave (`welcome`) — `welcome-module/src/index.ts:51`.
- Dynamic Cards (`dynamic-cards`) — `cards-module/src/index.ts:41` (pure render
  service used by other modules + admin).
- Auto-Moderation (`automod`) — `automod-module/src/index.ts:180`.
- Scheduled Messages (`scheduled-messages`) —
  `scheduled-messages-module/src/index.ts:123`.

## Verified findings — events & interaction handlers

`module.events` subscriptions (core contract `ModuleEventHandler`):

| Platform event | Subscribing module(s) | Handler |
|---|---|---|
| `component.interaction` | audio-player | `buildAudioComponentHandler` (audio control buttons) |
| `component.interaction` | role-menus | `service.handleInteraction` (button/select role toggle) |
| `member.join` | welcome | `service.handleJoin` |
| `member.leave` | welcome | `service.handleLeave` |
| `message.create` | automod | `handleMessage` (rule scan) |

(Verified in each module's `index.ts`. The dispatcher fans an event out to
every subscriber whose module is enabled, isolating failures —
`packages/core/src/registry.ts:68-89`.)

### Interaction-handler detail
- **Audio buttons** (`now-playing.ts`): customId prefix `audio:` with controls
  `pause|resume|skip|stop|leave|refresh`. The panel renders an embed + a button
  row (`⏸/▶`, `⏭`, `⏹`, `👋`, `🔄`). After acting, the handler edits the
  message in place via `event.update` (falls back to `event.reply`).
- **Role-menu components** (`logic.ts`): customId
  `rolemenu:<menuId>` (select submission) or `rolemenu:<menuId>:<roleId>`
  (button click). `computeRoleChanges` is a pure function implementing modes
  `add_only`, `remove_only`, `single`, `unique`, `multiple`/`toggle`, with
  `requiredRoleId`/`blockedRoleId`/`maxSelections` constraints.
- **Adapter dispatch** (`adapter.ts:215-270`): only `interaction.isButton()` and
  `interaction.isStringSelectMenu()` are converted to `component.interaction`.
  If no module replied, the adapter calls `interaction.deferUpdate()` so Discord
  does not show a failure. Chat-input commands go through `dispatch(ctx)`; the
  adapter is the last-resort error boundary (sends `GENERIC_USER_ERROR`).

## Verified findings — intents & permissions

### Gateway intents requested (adapter.ts)
Always: `Guilds`, `GuildVoiceStates`, `GuildMessages`, `GuildModeration`.
Conditionally: `GuildMembers` (if `DISCORD_ENABLE_GUILD_MEMBERS`),
`MessageContent` (if `DISCORD_ENABLE_MESSAGE_CONTENT`). Both are **privileged**.

What breaks when each is OFF:
- `GuildMembers` OFF → `member.join`/`member.leave` never fire → Welcome/Leave
  messages, auto-roles, and member-based birthday-on-join behaviour do not run.
  (Birthdays still work via the scheduler; only join-time logic needs it.)
- `MessageContent` OFF → `MessageCreateEvent.content` is an empty string
  (`events.ts:49` + `adapter.ts:307`) → content-based automod rules (banned
  words, links, caps, invite) cannot match. The automod module logs a DEGRADED
  warning on load (`automod-module/src/index.ts:184-192`). Spam/mention/
  attachment rules still work (they don't need text).

### Module-declared metadata (admin display + checks)
`requiredIntents` / `requiredPermissions` from each module's `metadata`:

| Module | requiredIntents | requiredPermissions |
|---|---|---|
| role-menus | Guilds | ManageRoles, SendMessages |
| welcome | GuildMembers | SendMessages, ManageRoles, AttachFiles |
| birthdays | Guilds | SendMessages, ManageRoles |
| reminders | Guilds | SendMessages |
| custom-commands | Guilds | SendMessages |
| automod | Guilds, GuildMessages, MessageContent | ManageMessages, ModerateMembers |
| scheduled-messages | Guilds | SendMessages |
| announcements | Guilds | SendMessages, EmbedLinks |
| moderation | Guilds, GuildModeration | ModerateMembers, KickMembers, BanMembers, ManageMessages, ManageChannels |
| dynamic-cards | (none declared) | AttachFiles |
| audio-player | (no metadata declared) | (none declared — needs Connect/Speak in voice, see Problems #2) |

Audio voice playback uses `@discordjs/voice` (`voice-session.ts`); it joins with
`selfDeaf: true` and needs the bot to have `Connect`+`Speak` in the target
voice channel — this is **not** declared in module metadata (gap, Problems #2).

### Per-command `default_member_permissions`
Only the **moderation** commands set `defaultMemberPermissions` (see the
moderation table above). All other commands set none, so Discord shows them to
everyone (the platform still re-checks the **bot's** own permissions before
acting, e.g. `canManageRole`, `botHasPermission` in `guild-service.ts`).

## Verified findings — roles / channels / server settings the bot depends on

- **Voice channel**: `/play`, `/join` require the invoking user to be in a voice
  channel (`voice.getUserVoiceChannel()`); the bot joins that channel.
- **Role hierarchy**: role add/remove (role-menus, welcome auto-roles, birthday
  role) require the bot's highest role to be **above** the managed role and the
  role to be non-managed (`guild-service.ts:canManageRole`).
- **Configured channels/roles (from DB settings, not env)**: announcement
  default channel; moderation mod-log channel + DM-on-action toggle
  (`moderation_settings`); welcome/leave channels + auto-role; birthday
  announcement channel + role + announce hour; scheduled-message target channel
  + mention mode/roles; reminder channel (when `here:true`); role-menu channel +
  message id; automod ignored channels/roles. (All in `packages/database`
  schema tables; managed via the admin panel.)
- **Guild owner protection**: kick/ban/timeout refuse to target the guild owner
  (`commands.ts` `protectOwner` → `service.isGuildOwner`).

## Verified findings — persisted data (what, where, why)

The bot persists through Drizzle repos (`packages/database` +
per-module `repo.ts`). By module:
- **audio-player**: `playback_history`, `queue_items` (mirror of in-memory
  queue) via `createPlaybackRepo` — passed from `main.ts`. Persistence is
  optional (`playback: null` disables it; used in register-commands & tests).
- **moderation**: `moderation_cases` (+ `caseNumber`), `moderation_settings`
  (log channel, dmOnAction), `warnings`, `moderation_actions`,
  `moderation_rules`, `permission_mappings`. Why: durable case log + RBAC.
- **announcements**: `announcements` (draft/scheduled/sent/canceled).
- **role-menus**: `role_menus`, `role_menu_options`, `role_assignment_logs`
  (audit of who toggled which role).
- **welcome**: `welcome_settings`.
- **birthdays**: `birthdays`, `birthday_settings`, `birthday_announcements`
  (dedup so a birthday is announced once per local day).
- **reminders**: `reminders` (dueAt, recurrenceSeconds, delivery type).
- **scheduled-messages**: `scheduled_messages`, `scheduled_message_runs`
  (sent/failed history).
- **automod**: `automod_rules`, `automod_violations`.
- **custom-commands**: `custom_commands` (use counter).
- **cards**: `card_templates`, `card_assets`.
- Cross-cutting: `guilds`/`guild_settings` (every module upserts the guild by
  external id via `createGuildsRepo`), `audit_logs` (every command + many
  events emit an audit record — `registry.ts` + module handlers), `admin_users`,
  `modules`/`module_settings` (enable/disable state read by the dispatcher),
  `platform_users`, `system_settings`.

(Schema is the single file `packages/database/src/schema.ts` — table list
verified against the inventory in `01-project-inventory.md`. This pass verified
the **module-side** repo usage, not each column.)

## Verified findings — config: hardcoded vs env/DB

- **From env** (`packages/config/src/index.ts`, zod-validated): all Discord
  identity + intent flags (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
  `DISCORD_GUILD_ID`, `DISCORD_ENABLE_MESSAGE_CONTENT`,
  `DISCORD_ENABLE_GUILD_MEMBERS`); audio limits (`MAX_QUEUE_SIZE`,
  `MAX_TRACK_DURATION_SECONDS`, `AUDIO_REQUEST_TIMEOUT_MS`,
  `ALLOWED_AUDIO_DOMAINS`, `AUDIO_ENABLE_STREAMING_SOURCES`, `YTDLP_PATH`,
  `YTDLP_COOKIES_FILE`); `HEALTH_PORT`, `INTERNAL_API_TOKEN`, `BOT_INTERNAL_URL`;
  `UPLOADS_DIR`. `discord.enabled` is derived (token AND clientId non-empty).
- **From DB** (admin panel, per guild): module enable/disable, all the channels
  /roles/settings listed under "server settings" above.
- **Hardcoded constants** (in module source, NOT configurable): spam window
  `10_000ms` + threshold `5` + escalation window `10min` (automod
  `index.ts:30-32`); reminder tick `30_000ms`, retry backoff `2min`, max 25
  per user (reminders `index.ts:30-32`); scheduled-messages tick `30_000ms`,
  retry `5min`; announcements delivery tick `30_000ms`; birthdays tick
  `5min` (per-hour gate dedups); audio button customId prefix `audio:`; role
  menu customId prefix `rolemenu:`; default voice connect timeout `20_000ms`,
  play start timeout `15_000ms` (`voice-session.ts`); purge cap 100, slowmode
  cap 21600s, ban delete max 7 days, timeout cap 40320min (command clamps).

## Problems found

1. **`automod` content rule availability is read once at construction**
   (`automod-module/src/index.ts:39`, `contentRulesAvailable =
   config.discord.enableMessageContent`). Correct, but it means flipping the
   intent requires a bot restart — worth noting in deployment docs (verified,
   not a bug).
2. **Audio module declares no `metadata`** (no `requiredPermissions`/
   `requiredIntents`). The bot needs voice `Connect`+`Speak` and the
   `GuildVoiceStates` intent, but the admin panel cannot display this for the
   audio module because the metadata block is absent
   (`audio-module/src/index.ts:60-98`). Documentation gap surfaced to the user.
3. **"Reaction Roles" name is aspirational for the reaction *type*.** The DB
   enum and seed mention reactions, but v1 publishes reaction-type menus as
   buttons and there is no emoji-reaction gateway listener. Anyone reading
   `docs/REACTION_ROLES.md` should confirm it does not promise true emoji
   reactions. (Verified discrepancy.)
4. **`clearwarnings` does not actually clear warnings** — it records an `other`
   moderation case with reason "cleared warnings" and replies; warnings remain
   in history (`commands.ts:157-175`, comment says "Foundation"). Behaviour vs
   command name mismatch (verified).
5. **Per-command permission gating exists only for moderation.** Non-mod
   commands (e.g. `purge` is gated, but `announcement send`, `roles menu`,
   `reminder`, `birthday`) have no `default_member_permissions`, so Discord
   shows them to all members; gating relies on the bot's own permission checks +
   the admin panel being the "primary editor". This is by design but is an
   exposure to call out.

## Recommendations

- Add `metadata` to the audio module declaring `requiredIntents:
  ['Guilds','GuildVoiceStates']` and `requiredPermissions: ['Connect','Speak']`
  so the admin panel can surface voice requirements.
- Either implement emoji-reaction role menus (needs `GuildMessageReactions`
  intent + `MessageReactionAdd` listener + `reaction` rendering) or rename the
  `reaction` enum value / clarify docs to "buttons and select menus only".
- Consider `default_member_permissions` for management subcommands
  (`announcement *`, `roles *`) to hide them from non-staff.
- Make `clearwarnings` actually deactivate warning rows or rename it.

## What remains to verify (handoff)

- Per-column schema details for each table (this pass verified the repo *usage*,
  not every column) — see `packages/database/src/schema.ts`.
- Audio resolver provider behaviour (yt-dlp/Spotify/direct, SSRF guards) —
  `packages/audio-module/src/resolver/*` not read this pass (covered by the
  audio-sources doc; flows file references it at the contract level only).
- Welcome/birthday card rendering path through the cards module
  (`renderCard` bridge in `main.ts:71`) — confirmed wired, not traced into
  `cards-module/src/renderer.ts`.
- The internal HTTP API audio admin endpoints (`apps/bot/src/internal-api.ts`)
  that the admin panel calls to skip/stop/clear queue — out of scope here
  (Agent for admin/internal-API owns it).

---

## Checkpoint

Status: PASS

### Validat
- Every slash command + subcommand enumerated from each module's
  `commands.ts`/`index.ts` (audio 10 flat; moderation 12 flat;
  announcement/roles/birthday/reminder grouped; custom flat dispatcher).
- All 5 event subscriptions verified (audio + role-menus → component.interaction;
  welcome → member.join/leave; automod → message.create).
- Interaction handlers (audio `audio:` buttons; role-menu `rolemenu:` buttons +
  select) verified including customId encodings and the in-place `update` path.
- Intent gating verified in `adapter.ts` (4 base + 2 opt-in privileged) and the
  env flags in `packages/config/src/index.ts`; degradation behaviour confirmed
  in `events.ts`/`automod`.
- Per-module `requiredIntents`/`requiredPermissions` metadata transcribed from
  source; per-command `default_member_permissions` (moderation only) verified.
- Confirmed by grep: NO `ModalBuilder`, NO `MessageReactionAdd`/
  `GuildMessageReactions` (reactions are buttons in v1).
- Persisted-data map built from each module's repo usage + `main.ts` wiring.
- Hardcoded-vs-env-vs-DB split verified against `config/src/index.ts` and module
  constants.

### Nevalidat
- Per-column DB schema (verified repo usage, not columns).
- Audio resolver internals (`resolver/*`) and card renderer internals.
- `apps/bot/src/internal-api.ts` audio-admin endpoint bodies.
- That commands actually appear in Discord after registration (cannot run the
  bot; registration code path verified statically only).

### Probleme
- Audio module has no `metadata` (voice intent/perms not surfaced).
- `reaction` role-menu type renders as buttons (name vs behaviour).
- `clearwarnings` does not clear warnings (records an "other" case only).
- Most management subcommands lack `default_member_permissions`.

### Următorul agent poate continua?
Da. Commands, subcommands, events, interaction handlers, intents, permissions,
persisted data and config sources are all mapped to exact files/lines. The two
technical references (`discord-bot-flows.md`, `commands-and-events.md`) give the
end-to-end flows and lookup tables. Open items are schema columns, audio
resolver internals, and the internal-API audio endpoints — each owned by other
agents and pointed to above.
