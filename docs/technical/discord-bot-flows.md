# Discord Bot — End-to-End Flows

> Scope verified on disk 2026-06-27 against the current repo (27 packages, 20 modules
> wired in `apps/bot/src/main.ts`). Every claim below is tagged:
> **[verified in code]** (read directly), **[deduced]** (inferred from the code), or
> **[documented-elsewhere-unverified]**. Secrets are placeholders only
> (`<DISCORD_BOT_TOKEN>`, `<DISCORD_CLIENT_ID>`, `<DISCORD_GUILD_ID>`).

This document traces how a trigger (slash command, button/select click, gateway event,
or scheduler tick) flows through the **Discord adapter → core contracts → a module →
back to Discord**, with the **intents** and **bot permissions** each flow requires.

---

## 0. The shared plumbing every flow rides on

All Discord-specific behaviour lives in `packages/discord-adapter/src/adapter.ts`
(`DiscordAdapter`); modules and the kernel speak only in adapter-neutral core
contracts. **[verified in code]**

### Gateway intents requested (`adapter.ts:73-84`) **[verified in code]**

The client connects with these **base (non-privileged)** intents always:

```text
Guilds, GuildVoiceStates, GuildMessages, GuildModeration
```

Two **privileged** intents are opt-in (added only when the matching config flag is on):

| Intent           | Config flag                            | Unlocks                                                   |
| ---------------- | -------------------------------------- | -------------------------------------------------------- |
| `GuildMembers`   | `config.discord.enableGuildMembers`    | `member.join` / `member.leave` events (welcome module)   |
| `MessageContent` | `config.discord.enableMessageContent`  | non-empty `message.create` content (content automod rules) |

Why opt-in: requesting a privileged intent that is NOT also enabled in the Discord
developer portal makes the gateway reject the connection (close code 4014, "Disallowed
intents") and the bot will not connect at all. So the default audio bot requests zero
privileged intents and connects with zero portal toggles. **[verified in code,
`adapter.ts:64-84`]**

`GuildVoiceStates` is **non-privileged and always on** — it powers both audio voice
sessions and the raise-hand `voice.state.update` auto-removal. **[verified in code]**

### How gateway events become platform events (`adapter.ts:126-342`) **[verified in code]**

| discord.js event       | Platform event                         | Notes |
| ---------------------- | -------------------------------------- | ----- |
| `InteractionCreate` (ChatInputCommand) | dispatched as a `CommandContext` to the command router | `adapter.ts:199-216` |
| `InteractionCreate` (Button / StringSelect) | `component.interaction` event with `reply()` + optional `update()` | `adapter.ts:220-275` |
| `GuildMemberAdd`       | `member.join`                          | needs `GuildMembers` |
| `GuildMemberRemove`    | `member.leave`                         | needs `GuildMembers` |
| `MessageCreate`        | `message.create` (bot authors & DMs filtered out, `adapter.ts:304`) | `content` is `''` unless `MessageContent` is on |
| `VoiceStateUpdate`     | `voice.state.update` (pure mute/deafen toggles ignored; bot users ignored, `adapter.ts:326-329`) | |

The five platform event shapes are defined in
`packages/core/src/contracts/events.ts`. **[verified in code]**

### Component-interaction acknowledgement contract (`adapter.ts:228-275`) **[verified in code]**

For any button/select, the adapter builds a `ComponentInteractionEvent` with:

- `reply(content)` — ephemeral reply (idempotent: first call `reply`, later calls `followUp`).
- `update(message)` — **edits the message that carried the component in place** (used by
  now-playing panels, trivia reveals, paginated leaderboards). First call `interaction.update`,
  later calls `editReply`.
- After `dispatchEvent`, if **no module acknowledged**, the adapter calls
  `interaction.deferUpdate()` so Discord never shows "interaction failed".

Several modules subscribe to `component.interaction` and each **ignores `customId`s it
does not own** (prefix check), so they coexist on the one event. **[verified in code]**

### Modules act on a guild via `GuildService` (`packages/core/src/contracts/guild-service.ts`) **[verified in code]**

`DiscordAdapter` also implements `GuildServiceProvider`. A module calls
`guildServiceProvider.forGuild(externalGuildId)` to get a `GuildService` (or `null` when
the adapter is disconnected). Key methods used by the flows below:

- Messaging: `sendMessage`, `editMessage`, `deleteMessage`, `sendDirectMessage`
- Roles: `addRole`, `removeRole`, `canManageRole` (hierarchy check)
- Moderation: `timeoutMember`, `removeTimeout`, `kickMember`, `banMember`,
  `unbanMember`, `purgeMessages`, `setSlowmode`, `setChannelLocked`
- Permission gates: `botHasPermission`, **`memberHasPermission`** (server-side per-member
  check for gating button clicks Discord can't gate), `isGuildOwner`, `getMemberRoleIds`

`forGuild()` returns `null` whenever `isReady()` is false (adapter not connected), which is
why most flows degrade gracefully with "the bot is not connected right now". **[verified in
code, `adapter.ts:182-191`]**

### Scheduler (`packages/core/src/scheduler.ts`) **[verified in code]**

A minimal in-process periodic scheduler. Each `ScheduledJob` has a `name`, an
`intervalMs` tick, and a `run()` that queries the DB for due work and acts. Properties
relevant to delivery flows:

- `unref()`ed `setInterval` per job; DB-backed so it is crash-safe without Redis.
- **Overlap guard**: a job whose previous `run()` is still in flight skips the tick
  (prevents double-send). **[verified in code, `scheduler.ts:61-78`]**
- A failing job is logged and retried next tick; it never crashes the worker.
- Jobs registered in `apps/bot/src/main.ts:204-212`: announcements, scheduled-messages,
  reminders, birthdays, engagement-prompts (daily-qotd), giveaways, **2× server-stats**
  (flush + weekly-recap), **2× trivia** (resolve-expired + auto), minigames (expire-stale).
  **[verified in code]**

> Note: the **admin app has no Discord connection**; "Send now" in the panel just marks a
> row due, and the bot worker's scheduler delivers it within one tick (~30s). **[deduced
> from announcements service + scheduler design]**

---

## 1. Audio play (URL → resolve → queue → voice session → now-playing panel)

**Module:** `packages/audio-module` (key `audio-player`). **Trigger:** `/play url:<link>`
(guildOnly). **[verified in code, `commands.ts:150-198`]**

**Intents:** `Guilds` + `GuildVoiceStates` (both base/non-privileged — audio needs no
privileged intents). **Bot permissions (deduced):** Connect + Speak in the voice channel,
plus Send Messages / Embed Links for the panel. The module declares **no metadata block at
all**, so `requiredPermissions` / `requiredIntents` are **undeclared (undefined)** — a known
admin-panel display gap. **[verified in code, `index.ts:75-122`]**

### Steps **[verified in code]**

1. Adapter receives `/play`, builds a `CommandContext` including a **`voice` capability**
   (`adapter.ts:439-494`): `getUserVoiceChannel()`, `getActiveSession()`, `join()`.
2. `play.execute` calls `ctx.defer()` then `ensureActiveSession()`
   (`commands.ts:135-148`): if there is no live session, it reads the caller's current
   voice channel and `voice.join(channelId)`. If the user is not in a VC →
   ephemeral "You need to join a voice channel first." and abort.
3. `voice.join` (`adapter.ts:464-492`) creates a `DiscordVoiceSession`
   (`voice-session.ts`) via `joinVoiceChannel({ selfDeaf: true })` and waits up to 20 s
   for `VoiceConnectionStatus.Ready` (throws `VOICE_UNAVAILABLE` on timeout). The session
   is cached per-guild in `voiceSessions`.
4. **Resolution** (`resolver/resolver.ts`): the raw URL passes `validateExternalUrl`
   (SSRF guards in `@botplatform/security`, optional allowed-domain allowlist), then the
   **first provider that `canResolve` the host** handles it. Provider order: YouTube/SoundCloud
   (`YtDlpAudioProvider`) and Spotify (`SpotifyAudioProvider`) first **only when
   `config.audio.enableStreamingSources` is on**, then the direct-HTTP catch-all.
   `onLoad` warns if streaming is enabled but `yt-dlp` is not available on PATH.
   **[verified in code, `index.ts:38-117`]**
   - A **pure YouTube playlist link** auto-expands via `enqueuePlaylist` (capped at
     `maxPlaylistItems`); a `watch?v=…&list=…` link plays just the one video (use
     `/playlist` to expand). **[verified in code, `commands.ts:56-88,170-175`]**
5. The resolved track gets `requestedBy = ctx.user.displayName`, then
   `session.enqueueOrPlay(track)` (engine: `GuildPlaybackSession` + `PlaybackQueue`,
   bounded by `maxQueueSize` / `maxTrackDurationSeconds`).
6. **User-visible result:**
   - If playback **started** → the bot renders the **now-playing panel** in place via
     `ctx.replyRich(buildNowPlayingPanel(snapshot))` (`commands.ts:187-193`).
   - If **queued** → `"Queued (#<pos>): **<title>**"`.
7. **Streaming:** `DiscordVoiceSession.play` opens the source stream, pipes it through an
   `createAudioResource(StreamType.Arbitrary)` (ffmpeg transcodes), waits up to 15 s for
   `Playing`, then emits exactly one terminal `finished`/`error` event per track so the
   queue advances. **[verified in code, `voice-session.ts:131-251`]**

### Persistence **[verified in code]**

DB tables `playback_history` + `queue_items` via `createPlaybackRepo`. Persistence is
**optional** — `createAudioModule` accepts `playback: null` to disable the history/queue
mirror (`index.ts:18-23`). Per-guild overrides (`allowedAudioDomains`, `maxQueueSize`,
`maxTrackDurationSeconds`) live in `guild_settings`; the package itself only writes
`playback_history`/`queue_items`.

### Now-playing panel buttons (the `component.interaction` half) **[verified in code]**

The panel (`now-playing.ts`) carries buttons with `customId = audio:<control>` where
control ∈ `pause | resume | skip | stop | leave | refresh`. The module's single
`component.interaction` handler fans out to **both** the audio button handler and the radio
select handler; each ignores foreign ids (`index.ts:90-98`). On a button click
(`buildAudioComponentHandler`, `commands.ts:378-417`):

1. `parseAudioButton` → ignore if not an `audio:` id.
2. Perform the action on the guild's session via `PlayerManager` (pause/resume/skip/stop/leave).
3. Rebuild the panel and **`event.update()` it in place** (or `event.reply()` the result
   text if in-place edit is unavailable).

Radio (`/radio …` and the `radio:select` menu, `RADIO_SELECT_ID`) plays a station on the
**active** session; if the bot is not connected it tells the user to run `/radio play`.
**[verified in code, `index.ts:67-73`]**

```text
trigger:   /play url:<link>            (or panel button audio:<control>)
intents:   Guilds, GuildVoiceStates    (no privileged intents)
perms:     Connect, Speak, SendMessages, EmbedLinks   [deduced]
result:    audio in VC + in-channel now-playing panel with live controls
```

---

## 2. Moderation action (`/warn`, `/timeout`, `/ban`, `/purge`, …)

**Module:** `packages/moderation-module` (key `moderation`). **Trigger:** one of 12 flat,
`guildOnly` slash commands, each with a `defaultMemberPermissions` gate. **[verified in
code, `commands.ts:108-371`]**

**Intents:** `Guilds`, `GuildModeration`. **Bot permissions vary by command:**
`ModerateMembers` (warn/timeout), `KickMembers` (kick), `BanMembers` (ban/unban),
`ManageMessages` (purge), `ManageChannels` (slowmode/lock/unlock). **[verified in code,
metadata in `index.ts`]**

### Steps — the shared `runAction` scaffold (`commands.ts:29-99`) **[verified in code]**

1. Resolve `service = guildServiceProvider.forGuild(ctx.guildId)`. If `null` →
   ephemeral "The bot is not connected right now." and abort.
2. Optional **owner protection**: timeout/kick/ban refuse to target the guild owner
   (`service.isGuildOwner`).
3. `opts.perform(service)` executes the actual Discord op (e.g.
   `service.timeoutMember(id, minutes*60, reason)` / `banMember(id, reason, deleteSeconds)`).
   On throw → `toSafeUserMessage(error)` ephemeral reply (no raw adapter error escapes).
4. **Persistence:** create a **numbered `moderation_cases` row** (`cases.create`).
5. **Best-effort side effects** read from `moderation_settings`:
   - DM-on-action to the target (`dmOnAction`).
   - A `mod-log` channel post `**Case #N** · <action> · <@target> by <@mod>` (`logChannelId`).
6. `audit.record` with action `moderation.<actionType>` (mute/unmute/kick/ban/unban/other);
   `/purge` records `moderation.purge` separately. **[verified in code]**
7. **User-visible result:** `"Case #<n>: <action> applied."`

Special cases: `/warn` writes **both** a `warnings` row (`WarningService`) **and** a `warn`
moderation case (`commands.ts:108-135`). `/clearwarnings` does **not** delete warnings — it
only records an `other` case (foundation). **[verified in code]**

### Persistence tables **[verified in code]**

`moderation_cases`, `moderation_settings`, `warnings`, plus the foundation services'
`moderation_actions`, `moderation_rules`, `permission_mappings`.

### Gaps **[verified in code]**
- **No dedicated admin route** despite the rich schema + exported services (warning/action/
  rule/permission) — confirmed not registered in `apps/admin/src/routes/index.ts`.
- `defaultEnabled: false` in `seed.ts`.

```text
trigger:   /timeout user:<@u> minutes:<n> reason:<text>
intents:   Guilds, GuildModeration
perms:     ModerateMembers (varies per command)
result:    Discord action applied + numbered case + optional DM + mod-log + audit
```

---

## 3. Role-menu self-assign (button / select → roles)

**Module:** `packages/role-menus-module` (key `role-menus`, seed name "Reaction Roles").
**[verified in code]**

Two triggers:
- **Admin/publish path:** `/roles list | menu <id> | refresh <id> | remove <id>`
  publishes/re-publishes/disables a menu message. **No `defaultMemberPermissions` gate on
  the command or any subcommand** — any member can invoke it; replies are ephemeral but
  `publishMenu` posts a real message to the channel. **[verified in code]**
- **Self-assign path:** a member clicks a button or submits a select on a published menu.

**Intents:** `Guilds`. **Bot permissions:** `ManageRoles`, `SendMessages`. **[verified in
code, `index.ts` metadata]**

### Self-assign steps (`service.ts:29-112`) **[verified in code]**

1. `component.interaction` → `service.handleInteraction`. `parseCustomId` rejects any id
   not prefixed `rolemenu:`. A **button** id is `rolemenu:<menuId>:<roleId>` (single role);
   a **select** id is `rolemenu:<menuId>` (its `values` are the full desired set).
2. Load `menus.getWithOptions(menuId)`; if missing/disabled → reply "This role menu is no
   longer active."
3. Resolve `service = forGuild(...)`; if `null` → "The bot is not available right now."
4. `computeRoleChanges` (pure, `logic.ts`) diffs **held roles** (`event.userRoleIds`) vs
   **requested** under the menu `mode` (`add_only | remove_only | single | unique |
   multiple/toggle`) and `constraints` (`maxSelections`, `requiredRoleId`, `blockedRoleId`).
   A rejected constraint → ephemeral reason and stop.
5. Apply each add/remove via `service.addRole` / `service.removeRole`, logging every change
   to `role_assignment_logs`. Per-role failures are counted as `skipped` (likely missing
   permission / hierarchy).
6. **User-visible result:** "Your roles have been updated." / "No changes were made." /
   "I could not update those roles — I may lack permission or role hierarchy."

### Persistence **[verified in code]**

`role_menus`, `role_menu_options`, `role_assignment_logs`. Publishing audits
`rolemenu.published` and stores `channelId`/`messageId` for in-place re-publish.

> **Access-control caveat [verified in code]:** the only access control on *using* a menu is
> the menu's constraint roles; `memberHasPermission` is **not** used by the handler. The
> publish subcommands have no permission gate.

```text
trigger:   button rolemenu:<menuId>:<roleId>  OR  select rolemenu:<menuId>
intents:   Guilds
perms:     ManageRoles, SendMessages
result:    member's roles toggled per menu mode/constraints + assignment log
```

---

## 4. Welcome-on-join (privileged GuildMembers intent)

**Module:** `packages/welcome-module` (key `welcome`). **No slash commands** — fully
event-driven, configured via the admin panel. **[verified in code, `index.ts:42-62`]**

**Trigger:** `member.join` (and `member.leave`). **Intents:** **`GuildMembers`
(PRIVILEGED)** — these events only fire when `config.discord.enableGuildMembers` is on AND
the portal toggle is enabled; otherwise the bot does not even subscribe. **[verified in
code adapter side, `adapter.ts:79-81`; the gating-then-no-events linkage is deduced]**
**Bot permissions:** `SendMessages`, `ManageRoles`, `AttachFiles`. **[verified in code,
metadata]**

### Steps on join (`service.ts:38-140`) **[verified in code]**

1. **Dedup:** an in-memory `recentJoins` map with a 60 s TTL (`DEDUP_TTL_MS`) drops
   duplicate gateway events for the same `(guild, user)`.
2. `guilds.upsertByExternalId` → load `welcome_settings` for the guild. If neither
   auto-roles nor the welcome message are configured → return.
3. **Auto-roles fire on EVERY join, INDEPENDENT of the welcome-message toggle, and
   IMMEDIATELY** (not subject to `delaySeconds`) — matches commit 695be76. Each role is
   added via `service.addRole(...)`; per-role failures are logged and never break the join;
   one `welcome.autorole` audit is emitted when ≥1 role was assigned. **[verified in code]**
4. The welcome **message / card / DM** are gated on `welcomeEnabled`. If
   `delaySeconds > 0` the send is scheduled with an in-process `setTimeout(...).unref()`
   (**not** the kernel scheduler — so this module registers no scheduler job). The
   `GuildService` is **re-resolved at send time**, so a delayed message survives a brief
   disconnect within the delay window. **[verified in code]**
5. Message build: placeholders applied (`{user}` etc.), the welcomed user may be pinged
   (allowed-mentions limited to that user). If `welcomeCardTemplateId` is set and a
   `renderCard` bridge is wired, the cards module renders a PNG attachment
   (`welcome.png`). **[verified in code]**
6. Optional DM if `dmEnabled` (best-effort; users who block DMs just fail silently).
7. `audit.record('welcome.sent')`. On leave: optional `leave_channel` message +
   `welcome.leave` audit.

### Cards bridge **[verified in code]**

`apps/bot/src/main.ts:79-81` wires `renderCard = cardsHandle.service.renderById`. The cards
module (`packages/cards-module`) renders PNGs from sanitized layout templates; avatar/
background fetch is SSRF-guarded (`openSafeHttpStream`, ≤8 MiB).

### Persistence **[verified in code]**

`welcome_settings` (PK `guild_id`). Admin route `apps/admin/src/routes/welcome.ts`.
`defaultEnabled: false` in `seed.ts`.

```text
trigger:   member.join  (privileged GuildMembers intent)
intents:   GuildMembers
perms:     SendMessages, ManageRoles, AttachFiles
result:    auto-roles always; welcome msg/card/DM if enabled (optionally delayed)
```

---

## 5. Automod message scan (privileged MessageContent intent)

**Module:** `packages/automod-module` (key `automod`). **No slash commands** — configured
via the admin panel; acts on the `message.create` event. **[verified in code,
`index.ts:171-194`]**

**Intents:** `Guilds`, `GuildMessages`, **`MessageContent` (PRIVILEGED)**. When
`MessageContent` is off, content rules silently degrade (the adapter delivers
`content = ''`) and `onLoad` logs a **DEGRADED** warning — the module still loads.
**Bot permissions:** `ManageMessages`, `ModerateMembers`. **[verified in code]**

### Steps (`handleMessage`, `index.ts:53-169`) **[verified in code]**

1. `message.create` arrives (adapter already filtered out bot authors and DMs).
   `guilds.upsertByExternalId` → load `repo.enabledForGuild(guildId)`. If no rules → return.
2. If a `spam` rule is enabled, push `now` onto a **per-process in-memory** sliding window
   (`recentMessages`, `SPAM_WINDOW_MS = 10 s`, pruned ≥5000 keys; default
   `SPAM_THRESHOLD = 5`).
3. For each rule, skip if the channel is in `ignoredChannelIds` or the author has an
   `ignoredRoleIds` role. Evaluate via `matchesRule` (pure, `matcher.ts`) — implemented:
   `banned_words`, `mention_spam`, `caps`, `invite_links`, `suspicious_links`,
   `attachments`, `new_account`; `spam` is the stateful path above.
   **GAP: `repeated_messages` and `raid` are declared rule types but `matchesRule` returns
   NO_MATCH — non-functional stubs.** **[verified in code]**
4. **One action per message** (`break` after the first violation). `applyAction`:
   - **Escalation:** count this user's violations in the last 10 min
     (`ESCALATION_WINDOW_MS`); if `count + 1 >= escalationThreshold`, upgrade `action` to
     `escalationAction`.
   - Perform via `GuildService`: `delete` (deleteMessage), `timeout`/`mute`
     (`timeoutMember(600)`), `kick`, `ban`, or `warn` (post `responseMessage` mentioning
     the user). `log_only` does nothing. Errors are swallowed at debug level.
5. **Persistence:** `repo.recordViolation(...)` → `automod_violations`; then
   `audit.record('automod.violation', severity: 'notice')`.

### Persistence **[verified in code]**

`automod_rules`, `automod_violations`. Admin route `apps/admin/src/routes/automod.ts`.
`defaultEnabled: false`. Spam state is in-memory only (not multi-replica-safe; resets on
restart).

```text
trigger:   message.create  (content requires privileged MessageContent intent)
intents:   Guilds, GuildMessages, MessageContent
perms:     ManageMessages, ModerateMembers
result:    one rule action (delete/timeout/kick/ban/warn) + violation row + audit
```

---

## 6. Scheduled & announcement delivery (scheduler-driven)

Two modules deliver via the kernel scheduler; neither has a Discord connection in the admin
app, so the **bot worker's scheduler** does the sending.

### 6a. Announcements (`packages/announcements-module`, key `announcements`) **[verified in code]**

- **Trigger:** scheduler job `announcements.deliver-due`, tick `DELIVERY_TICK_MS = 30 s`
  (registered `main.ts:204`); or the `/announcement send <id>` command which defers then
  calls `service.deliverById`. **[verified in code, `index.ts:66-75`]**
- **Intents:** `Guilds`. **Bot permissions:** `SendMessages`, `EmbedLinks`.
- **Steps** (`service.ts:29-100`): `deliverDue(now)` → `announcements.listDue(now)`; for
  each row `deliver(...)`:
  1. Skip templates / rows without a target channel (the latter is marked `failed`).
  2. Resolve guild + `forGuild`. **Bot offline → leave it scheduled** (retry next tick) —
     no failure recorded.
  3. `botHasPermission('SendMessages', channelId)` check; missing → mark `failed`.
  4. `buildOutgoing` applies strict allowed-mentions (only the explicit `mentionMode` —
     `everyone`/`here`/`roles`/none).
  5. `sendMessage` → set status `sent` (+ `sentMessageId`); `audit.record('announcement.sent')`.
     On send throw → mark `failed` + `announcement.failed` audit.
- **Persistence:** `announcements` table (optional `card_template_id`). `defaultEnabled:
  true` in `seed.ts` (one of only two on-by-default modules, with audio-player). Admin
  route: `apps/admin/src/routes/announcements.ts`. **[verified in code]**
- **User-visible result:** the announcement appears in the target channel within ~30 s of
  becoming due. The admin "Send now" just makes it due immediately. **[deduced]**

> The schema has `buttons` (jsonb) but the module has **no `component.interaction`
> handler** — buttons are rendered but their clicks are not handled by this module.
> **[verified in code, per module notes]**

### 6b. Scheduled messages (`packages/scheduled-messages-module`, key `scheduled-messages`) **[verified in code]**

- **Trigger:** scheduler job `scheduled-messages.deliver-due`, tick `TICK_MS = 30 s`
  (registered `main.ts:205`). **No slash commands, no events** — authored only via
  `apps/admin/src/routes/scheduled-messages.ts`.
- **Intents:** `Guilds`. **Bot permissions:** `SendMessages`.
- **Steps:** `listDue(now)` returns ≤50 rows where `paused = false AND next_run_at <= now`.
  Per row: send (plain or embed, with `mentionMode`/`mentionRoleIds`). On success
  `recordRun('sent')` + audit `scheduled-message.sent` + `computeNextRun` advances
  `next_run_at` (one-offs whose next is null become `paused = true`). On failure
  `recordRun('failed')` + reschedule `+RETRY_BACKOFF_MS (5 min)`. **Bot offline leaves the
  row untouched** to retry. **[verified in code, per module notes]**
- **Schedule engine** (`next-run.ts`, pure, luxon + cron-parser): `once | interval | daily
  | weekly | monthly | cron`; `MIN_INTERVAL_SECONDS = 60`; monthly day clamped 1–28;
  invalid timezone → UTC.
- **Persistence:** `scheduled_messages` + `scheduled_message_runs`.
- 30 s tick → times can fire up to ~30 s late; the 50-row cap drains a backlog over
  multiple ticks.

```text
trigger:   scheduler tick every 30s  (admin authors the rows)
intents:   Guilds
perms:     SendMessages (+ EmbedLinks for announcements)
result:    message posted to the target channel; run/status persisted; audit
```

---

## 7. Raise-hand speaker queue (voice.state.update auto-removal + gated panel buttons)

**Module:** `packages/raise-hand-module` (key `raise-hand`, "Speaker Queue"). **[verified in
code]**

**Triggers:** 8 top-level slash commands (deliberately *not* grouped so each can carry its
own `defaultMemberPermissions`): 3 open (`raise-hand`, `lower-hand`, `speaker-queue`) and 5
gated by `MuteMembers` (`next-speaker`, `remove-speaker`, `clear-speaker-queue`,
`promote-speaker`, `speaker-panel`); plus `component.interaction` (panel buttons) and
**`voice.state.update`**. **[verified in code, `index.ts:46-70`]**

**Intents:** `Guilds`, `GuildVoiceStates` (both base/non-privileged — `GuildVoiceStates`
is the same intent the audio engine uses). **Bot permissions:** `ViewChannel`,
`SendMessages`, `EmbedLinks`, `ReadMessageHistory`. The module **never mutes anyone** —
`MuteMembers` is used purely to *identify* moderators. **[verified in code]**

### Panel button flow (`service.ts:268-313`) **[verified in code]**

Panel `customId = rh:<action>:<voiceChannelId>`; the persistent panel shows **5 of 8**
actions (`raise | lower | show | next | clear`; remove/promote are slash-only).

1. `parsePanelCustomId` → ignore foreign ids.
2. If `action ∈ MODERATOR_ACTIONS = {next, clear}`, re-check **server-side**:
   `isModerator = isGuildOwner(user) OR memberHasPermission(user, 'MuteMembers')`. This is
   the **new server-side per-member gate** (Discord cannot gate component clicks by
   permission). Non-mods get "Only moderators (Mute Members) can use that control."
   **[verified in code, `service.ts:60-70,279-284`]**
3. Dispatch: `raise`/`lower`/`show`/`next`/`clear` mutate the queue (transactional
   `advance`/`promote` in the repo), then `refreshPanel` re-renders the panel in place and
   (for `next`) `announce` posts "🎤 <@next> is next to speak!" in the announce/panel channel.

### Voice-leave auto-removal (`handleVoiceState`, `service.ts:316-323`) **[verified in code]**

1. `voice.state.update` arrives with `oldChannelId` / `newChannelId` (adapter already
   ignores pure mute/deafen toggles and bot users).
2. If the user **left or moved away from** a channel (`oldChannelId &&
   oldChannelId !== newChannelId`), look up that channel's queue and
   `repo.removeEntry(queue.id, user)`. If removed, `refreshPanel`.
3. **User-visible result:** a member who leaves the VC drops out of its speaker queue
   automatically and the panel updates.

### Persistence **[verified in code]**

`speaker_queues` (one per `(guild, voiceChannelId)`; caches `voiceChannelName`,
`panelChannelId`, `panelMessageId`, `announceChannelId`; survives restarts) +
`speaker_queue_entries` (status `waiting|active|done`, ordering `priority DESC, raisedAt
ASC`; partial unique index excludes `done`). Audits: `raisehand.next`, `raisehand.panel`,
`raisehand.cleared`. **No admin route** (configured entirely via Discord). `defaultEnabled:
false`.

```text
trigger:   panel button rh:<action>:<vc>  |  voice.state.update
intents:   Guilds, GuildVoiceStates   (non-privileged)
perms:     ViewChannel, SendMessages, EmbedLinks, ReadMessageHistory
gate:      moderator buttons re-checked via memberHasPermission('MuteMembers')
result:    ordered speaking queue; auto-drop on VC leave; live panel
```

---

## 8. Engagement modules (flow level)

### 8a. Giveaways (`packages/giveaways-module`, key `giveaways`) **[verified in code]**

- **Triggers:** `/giveaway start|end|reroll|cancel|list` — whole command + all subcommands
  gated by `ManageGuild`; plus the `giveaway:enter:<id>` button and the
  `giveaways.draw-due` scheduler job (tick 30 s, `main.ts:209`). **[verified in code,
  `index.ts`]**
- **Intents:** `Guilds`. **Bot permissions:** `SendMessages`, `EmbedLinks`.
- **Start flow** (`service.ts:103-118`): `start` requires a connected adapter
  (`ADAPTER_ERROR` otherwise), creates a `giveaways` row (status `active`, `ends_at = now +
  durationSec`), posts an embed with an **Enter** button (`giveaway:enter:<uuid>`), then
  stores the `message_id`.
- **Enter flow** (`service.ts:120-132`): the `component.interaction` handler checks the
  giveaway is still `active` and not past `ends_at`, then `repo.addEntry` (unique
  `(giveaway_id, user_external_id)`); replies "entered" / "already entered" / "ended".
- **Draw flow** (`drawDue`, `service.ts:135-146`): each active giveaway past `ends_at` →
  `listEntrants` → `drawWinners` (partial Fisher–Yates) → `repo.finish` (status `ended`,
  winners persisted) → **edit the original message + post a congrats announcement**
  (best-effort). `end`/`reroll`/`cancel` are admin variants (`reroll` only on `ended`,
  `cancel`/`end` only on `active`); short-id lookup matches exact-or-prefix among ≤200
  recent rows. **[verified in code]**
- **Persistence:** `giveaways` + `giveaway_entries`. `auditEvents: []` (none).
  `defaultEnabled: false`. **No admin route.**

```text
trigger:   /giveaway start  →  Enter button  →  draw-due tick (30s)
intents:   Guilds   |   perms: SendMessages, EmbedLinks   |   gate: ManageGuild (commands)
result:    embed with Enter button; auto-draw edits message + congrats post
```

### 8b. Trivia (`packages/trivia-module`, key `trivia`) **[verified in code]**

- **Triggers:** `/trivia` (start a round), `/trivia-leaderboard`, `/triviaconfig`
  (`ManageGuild`); the `trivia:ans:<roundId>:<choice>` answer buttons; and **two**
  scheduler jobs — `trivia.resolve-expired` (30 s) and `trivia.auto` (60 s), registered via
  a loop in `main.ts:211`. **[verified in code, `index.ts`]**
- **Intents:** `Guilds`. **Bot permissions:** `SendMessages`, `EmbedLinks`.
- **Start** (`service.ts:58-83`): refuse if a round is already open in the channel; pick a
  non-repeating question from the bundled 41-question bank (recent-ring cap 20); create a
  `trivia_rounds` row; post the question embed with one button per option; store the
  message id.
- **Answer** (`handleAnswer`, `service.ts:85-114`): record **one answer per user/round**
  (unique index). Wrong → "Wrong answer". Correct → `resolveIfOpen` performs an **atomic
  first-correct claim**; the winner increments `trivia_scores.wins` and the message is
  **updated in place** to reveal the answer + winner; a later-correct user gets "someone
  beat you to it".
- **Timeout** (`resolveExpired`): rounds open past `ROUND_TIMEOUT_SEC = 45 s` are revealed
  with "Time's up — nobody got it!". **Auto-trivia** (`runAutoTrivia`): start a round in
  configured channels when `isAutoDue` and no round is open.
- **Persistence:** `trivia_rounds`, `trivia_answers`, `trivia_scores`, `trivia_settings`.
  `defaultEnabled: false`. **No admin route.**

```text
trigger:   /trivia  →  trivia:ans buttons  →  resolve-expired/auto ticks
intents:   Guilds   |   perms: SendMessages, EmbedLinks
result:    question embed; first-correct wins (atomic) + leaderboard; auto reveal
```

### 8c. Levels & Economy (XP and currency) **[verified in code]**

**Levels** (`packages/levels-module`, key `levels`):
- **Triggers:** `message.create` (award XP) + `component.interaction` (`lvl:lb:<page>`
  paginated leaderboard) + slash `/rank`, `/levels`, `/levelconfig`, `/levelnoxp`,
  `/levelrewards`. **[verified in code, `index.ts`/`service.ts`]**
- **Intents:** declared `Guilds`. It subscribes to `message.create`, which the adapter
  emits from `Events.MessageCreate` under the **base `GuildMessages` intent** — and levels
  only *counts* messages (it never reads `content`), so it works with no privileged intent.
  The module metadata under-declaring the gateway intent is harmless because the intent is
  owned by the adapter. **[verified in code; intent-ownership point deduced]**
- **XP flow** (`handleMessage`, `service.ts:114-134`): skip bots/DMs; load cached settings
  (30 s TTL); skip if disabled or channel in `noXpChannelIds`; enforce a per-user cooldown
  (default 60 s, in-memory); roll `xp_min..xp_max`; `applyAward`; on level-up grant any
  reward roles for levels in `(oldLevel, newLevel]` (hierarchy-checked via `canManageRole`)
  and post the level-up message (`{user}`/`{level}` placeholders).
- **Curve:** MEE6-style `5l² + 50l + 100`. **Persistence:** `level_members`,
  `level_rewards`, `level_settings`. **Off by default twice** — `seed.ts` *and*
  `level_settings.enabled` default false; an admin must run `/levelconfig enabled:true`.
  In-memory caches are per-process. **No scheduler jobs** (level-ups happen inline).
  **No admin route.** **[verified in code]**

**Economy** (`packages/economy-module`, key `economy`):
- **Triggers:** `/balance`, `/give`, `/daily`, `/baltop`, `/shop`, `/buy`, `/economy
  grant|take|config` (`ManageGuild`), `/shopadmin add|remove` (`ManageGuild`); plus
  `component.interaction` (`eco:baltop:<page>`, `eco:shop:<page>` pagination). **No
  scheduler jobs.** **[verified in code per module data]**
- **Intents:** `Guilds`. **Bot permissions:** `SendMessages`, `ManageRoles` (shop purchases
  grant Discord roles).
- **Buy flow:** `tryDebit` (overdraft-safe, balances clamp at 0) → `addRole`; on grant
  failure refund via `applyDelta` and throw `ADAPTER_ERROR`; role ownership + bot hierarchy
  (`canManageRole`) checked first. Transfers/debits are SQL-transaction atomic.
- **Persistence:** `economy_accounts`, `economy_transactions` (append-only ledger),
  `economy_settings`, `shop_items`, `shop_purchases`. `defaultEnabled: false`. **No admin
  route.** **[verified in code]**

```text
levels:   message.create (counts only, base GuildMessages intent) → XP, level-up roles
economy:  slash commands + pagination buttons → balances/transfers/role shop (ManageRoles)
```

---

## 9. Cross-cutting gaps (for the admin panel / future work) **[verified in code]**

- **9 newest modules have no admin page at all**: raise-hand, fun-commands,
  engagement-prompts, giveaways, server-stats, trivia, minigames, economy, levels (not
  registered in `apps/admin/src/routes/index.ts`, not in `placeholders.ts`). `reminders`
  has only a read-only placeholder page (`placeholders.ts`), no CRUD. Confirmed dedicated
  `routes/` plugins exist for: announcements, automod, birthdays, cards, custom-commands,
  role-menus, scheduled-messages, welcome (plus an index/context/placeholders set).
  **audio-player** and **moderation** have **no `routes/` plugin but DO have a real admin
  page defined inline in `apps/admin/src/server.ts`** (`/audio` at line 282, `/moderation`
  at line 386) — so 10 of 20 modules have a real admin page and 10 do not.
- **audio-player declares no metadata** → `requiredPermissions`/`requiredIntents` undefined
  in the panel.
- **automod stubs**: `repeated_messages`, `raid` are non-functional.
- **custom-commands**: `allowedRoleIds` stored but not enforced at runtime (only channel
  allowlist + cooldown). **[documented-elsewhere-unverified — from module notes]**
- **birthdays**: `cardTemplateId` and `roleDurationHours` stored but the scheduler renders
  no card and never auto-removes the birthday role. **[documented-elsewhere-unverified —
  from module notes]**
- **reminders**: `createdByAdmin` column exists but there is no admin route to create them.
  **[documented-elsewhere-unverified — from module notes]**

---

## Quick reference: trigger → module → intent

| Flow                         | Trigger type            | Module               | Intents (base = Guilds, GuildVoiceStates, GuildMessages, GuildModeration) |
| ---------------------------- | ----------------------- | -------------------- | --------------------------------- |
| Audio play                   | slash + voice + buttons | audio-player         | Guilds, GuildVoiceStates          |
| Moderation action            | slash command           | moderation           | Guilds, GuildModeration           |
| Role-menu self-assign        | button / select         | role-menus           | Guilds                            |
| Welcome on join              | member.join event       | welcome              | **GuildMembers (privileged)**     |
| Automod scan                 | message.create event    | automod              | GuildMessages, **MessageContent (privileged)** |
| Announcement delivery        | scheduler 30s           | announcements        | Guilds                            |
| Scheduled message delivery   | scheduler 30s           | scheduled-messages   | Guilds                            |
| Raise-hand queue             | slash + buttons + voice | raise-hand           | Guilds, GuildVoiceStates          |
| Giveaways                    | slash + button + 30s    | giveaways            | Guilds                            |
| Trivia                       | slash + buttons + 30/60s| trivia               | Guilds                            |
| Levels (XP)                  | message.create event    | levels               | GuildMessages (counts only)       |
| Economy                      | slash + buttons         | economy              | Guilds                            |
