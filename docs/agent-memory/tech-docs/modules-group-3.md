# Tech docs — Module Group 3

Scope: 4 modules read line-by-line on 2026-06-27 from `packages/<dir>/src/` plus
`packages/database/src/schema.ts` and `packages/database/src/seed.ts`. All facts
below are **verified in code** unless explicitly marked otherwise.

Modules covered:

1. `scheduled-messages` (`packages/scheduled-messages-module`)
2. `automod` (`packages/automod-module`)
3. `custom-commands` (`packages/custom-commands-module`)
4. `raise-hand` (`packages/raise-hand-module`)

Wiring confirmed in `apps/bot/src/main.ts`:

- `createRaiseHandModule` (line 89), `createScheduledMessagesModule` (line 96),
  `createCustomCommandsModule` (line 103), `createAutomodModule` (line 154).
- All four `.module` handles registered (lines 179–184).
- Scheduler jobs: only `scheduledMessagesHandle.schedulerJob` is registered
  (line 205). The other three modules register **no** scheduler jobs.

---

## 1. scheduled-messages (`scheduled-messages-module`)

- Module key: `scheduled-messages`. Name "Scheduled Messages".
- **Slash commands: NONE.** `commands: []`. The module is entirely
  scheduler-driven; everything is authored from the admin panel.
- **Platform events handled: NONE.** No `events` array.
- **Interaction handlers: NONE.**
- **Scheduler job (verified):**
  - name `scheduled-messages.deliver-due`, `intervalMs = 30_000` (30s tick,
    `TICK_MS`).
  - `run()` calls `repo.listDue(now)` (returns up to 50 rows where
    `paused=false AND next_run_at <= now`) and delivers each.
  - Delivery builds an `OutgoingMessage`; `mentionMode` of `everyone`/`here`/`roles`
    prefixes the content and sets `allowMentions`. On success: `recordRun('sent')`,
    audit `scheduled-message.sent`, then advances `nextRunAt` via `computeNextRun`
    (one-offs whose next run is `null` get `paused=true`). On failure: `recordRun('failed')`
    and reschedules with a 5-min backoff (`RETRY_BACKOFF_MS`) — never drops a one-off.
  - If bot is offline (`forGuild` returns null) the row is left untouched to retry next tick.
- **Schedule engine** (`next-run.ts`, pure, luxon + cron-parser): `ScheduleType =
  'once' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron'`. `MIN_INTERVAL_SECONDS = 60`.
  Monthly day is clamped to 1–28 to avoid skipping short months. Invalid tz falls back to UTC.
- **DB tables (2):**
  - `scheduled_messages` — name, channelId, content, format (`plain`/`embed`),
    embedConfig jsonb, mentionMode, mentionRoleIds, scheduleType (enum), scheduleConfig
    jsonb, timezone, nextRunAt, lastRunAt, paused, lastFailureReason. Indexes on guildId
    and nextRunAt.
  - `scheduled_message_runs` — bigserial id, FK scheduledMessageId (cascade),
    status (`sent`/`failed`/`skipped`), detail, ranAt. Index on messageId.
- **metadata:** `requiredPermissions: ['SendMessages']`, `requiredIntents: ['Guilds']`,
  `auditEvents: ['scheduled-message.sent']`.
- **Admin route:** `apps/admin/src/routes/scheduled-messages.ts` (173 lines, REAL,
  registered in `routes/index.ts`). Paths: `GET /scheduled-messages`,
  `GET /scheduled-messages/new`, `GET /scheduled-messages/:id`, `POST /scheduled-messages/:id`,
  plus a `POST /scheduled-messages/:id/...` action.
- **defaultEnabled:** `false` (seed.ts).
- **Caveats:** No slash UX at all (admin-only authoring). Tick granularity is 30s, so
  scheduled times can fire up to ~30s late. `listDue` cap of 50 per tick means a large
  backlog drains over multiple ticks.

## 2. automod (`automod-module`)

- Module key: `automod`. Name "Auto-Moderation".
- **Slash commands: NONE.** `commands: []`.
- **Platform events handled (verified):** `message.create` → `handleMessage`.
- **Interaction handlers: NONE.**
- **Scheduler jobs: NONE.**
- **Logic:** On each guild message it upserts the guild, loads `enabledForGuild`
  rules; returns early if none. Per rule it skips ignored channels/roles, then
  evaluates. Pure matching lives in `matcher.ts` (`matchesRule` + `isSpam`).
  - **Rule types (`AutomodRuleType`):** `banned_words`, `spam`, `repeated_messages`,
    `mention_spam`, `caps`, `invite_links`, `suspicious_links`, `attachments`,
    `new_account`, `raid`. NOTE: `repeated_messages` and `raid` are declared but
    `matchesRule` returns NO_MATCH for them (stateful, not implemented); only `spam`
    is implemented statefully (in-memory per-user sliding window:
    `SPAM_WINDOW_MS=10_000`, default `SPAM_THRESHOLD=5`).
  - **Actions (`action` / `escalationAction`):** `log_only`, `delete`, `timeout`/`mute`
    (600s timeout), `kick`, `ban`, `warn` (replies with `responseMessage`). One action
    per message (`break`).
  - **Escalation:** if `escalationThreshold` + `escalationAction` set, counts the user's
    violations in the last 10 min (`ESCALATION_WINDOW_MS`) and upgrades the action when
    `count+1 >= threshold`.
  - Every violation: `repo.recordViolation(...)` + audit `automod.violation`
    (severity `notice`).
- **Content-intent gate (caveat, verified):** `contentRulesAvailable =
  config.discord.enableMessageContent`. When the privileged **MessageContent** intent
  is OFF, content-based rules (banned words, links, caps) silently see empty text and
  `onLoad` logs a DEGRADED warning. The module still loads.
- **DB tables (2):**
  - `automod_rules` — name, ruleType (enum), enabled (default false), config jsonb,
    action (enum, default `log_only`), severity, ignoredChannelIds, ignoredRoleIds,
    escalationThreshold, escalationAction, responseMessage. Index on guildId.
  - `automod_violations` — bigserial id, FK ruleId (set null on delete),
    userExternalId, channelId, ruleType, actionTaken, detail, createdAt. Indexes on
    guildId and (guildId,userExternalId).
- **metadata:** `requiredPermissions: ['ManageMessages','ModerateMembers']`,
  `requiredIntents: ['Guilds','GuildMessages','MessageContent']`,
  `auditEvents: ['automod.violation']`.
- **Admin route:** `apps/admin/src/routes/automod.ts` (121 lines, REAL, registered).
  Paths: `GET /automod`, `POST /automod` (create), `POST /automod/:id` (action).
- **defaultEnabled:** `false` (seed.ts).
- **Caveats:** `repeated_messages` and `raid` rule types are non-functional stubs. Spam
  state is per-process in-memory (not shared across bot instances; reset on restart).
  `MessageContent` is a Discord privileged intent — content rules degrade silently if
  it is disabled.

## 3. custom-commands (`custom-commands-module`)

- Module key: `custom-commands`. Name "Custom Commands".
- **Slash commands (1, verified):** `/custom` — single dispatcher.
  - subcommands: none. Option `name` (string, required) selects the stored command.
  - `guildOnly: true`. **defaultMemberPermissions: NONE** (open to everyone;
    per-command access is enforced in code via channel allowlist + cooldown, not by a
    Discord permission gate).
  - Behavior: upserts guild, looks up command by name; rejects if missing/disabled.
    Enforces `allowedChannelIds` allowlist and per-(command,user) in-memory cooldown
    (`cooldowns` Map, `cooldownSeconds`). Renders the response via `renderCustomResponse`,
    flattens to plain text for the slash reply contract, then `repo.incrementUse`.
  - Design note (verified): a single dispatcher command avoids dynamic slash
    registration; the admin panel manages the catalog.
- **Platform events handled: NONE.**
- **Interaction handlers: NONE** (the `link` response type emits a link button, but
  there is no interaction handler — link buttons need no callback).
- **Scheduler jobs: NONE.**
- **Render engine** (`render.ts`, pure): response types `text`, `embed`, `random`
  (deterministic `pickIndex % choices.length`), `link`. Placeholders applied via
  `applyPlaceholders` from `@botplatform/shared`. `isValidCommandName`:
  `/^[a-z0-9_-]{1,32}$/`.
- **DB tables (1):** `custom_commands` — name (unique per guild), description,
  responseType (enum, default `text`), response jsonb, allowedRoleIds,
  allowedChannelIds, enabled (default **true**), cooldownSeconds, useCount.
  Unique index (guildId, name).
- **metadata:** `requiredPermissions: ['SendMessages']`, `requiredIntents: ['Guilds']`,
  `auditEvents: ['custom-command.created']`.
- **Admin route:** `apps/admin/src/routes/custom-commands.ts` (147 lines, REAL,
  registered). Paths: `GET /custom-commands`, `GET /custom-commands/new`,
  `GET /custom-commands/:id`, `POST /custom-commands/:id`, plus a `POST /custom-commands/:id/...`.
- **defaultEnabled:** `false` (seed.ts). (Note: per-command DB `enabled` default is
  `true`, distinct from the module's seed `defaultEnabled=false`.)
- **Caveats:** `allowedRoleIds` is stored on the row but the slash dispatcher only
  enforces the **channel** allowlist + cooldown — role gating is NOT enforced at
  runtime. Cooldown map is per-process in-memory. The audit event
  `custom-command.created` is declared in metadata but is recorded by the admin route,
  not by the bot module (the module never calls `audit.record`).

## 4. raise-hand (`raise-hand-module`) — "Speaker Queue"

- Module key: `raise-hand`. Name "Speaker Queue".
- **Slash commands (8 top-level, verified — intentionally NOT grouped so that
  `default_member_permissions` can gate each independently):**
  - `/raise-hand` — join queue for caller's current VC. gate: NONE.
  - `/lower-hand` — leave queue. gate: NONE.
  - `/speaker-queue` — show order. gate: NONE.
  - `/next-speaker` — advance queue. gate: `MuteMembers`.
  - `/remove-speaker` (option `user`, required) — remove member. gate: `MuteMembers`.
  - `/clear-speaker-queue` — wipe queue. gate: `MuteMembers`.
  - `/promote-speaker` (option `user`, required) — move to front. gate: `MuteMembers`.
  - `/speaker-panel` — post the persistent button control panel. gate: `MuteMembers`.
  - All `guildOnly: true`. Moderator commands use
    `defaultMemberPermissions: ['MuteMembers']`. Each command resolves the caller's
    voice channel via `ctx.voice.getUserVoiceChannel()`.
- **Platform events handled (2, verified):**
  - `component.interaction` → `service.handleInteraction`.
  - `voice.state.update` → `service.handleVoiceState` (drops a user from the queue of
    any channel they leave/move away from; uses the already-enabled GuildVoiceStates
    intent — NOT privileged).
- **Interaction handlers (customId pattern `rh:<action>:<voiceChannelId>`):**
  - Actions: `raise`, `lower`, `show`, `next`, `clear` (note: panel has 5 buttons; the
    8 slash commands include `remove`/`promote` which are NOT on the panel).
  - `MODERATOR_ACTIONS = {next, clear}` are re-checked **server-side** via
    `isModerator()` → `svc.isGuildOwner()` OR `svc.memberHasPermission(user, 'MuteMembers')`
    (uses the new `GuildService.memberHasPermission`). Non-mods get
    "Only moderators (Mute Members) can use that control."
- **Scheduler jobs: NONE.**
- **DB tables (2):**
  - `speaker_queues` — one per (guild, voiceChannelId) (unique index). Caches
    voiceChannelName; holds `panelChannelId`/`panelMessageId`/`announceChannelId` for
    the persistent panel. State survives restarts.
  - `speaker_queue_entries` — userExternalId, displayName, status
    (`waiting`/`active`/`done`), priority (higher = front), raisedAt. FK queueId
    (cascade). **Partial unique index** `(queueId, userExternalId) WHERE status <> 'done'`
    enforces at-most-one live entry per user. Ordering everywhere: priority DESC,
    raisedAt ASC.
- **Logic (`logic.ts`, pure):** `sortWaiting`, `nextWaiting`, `promotedPriority`
  (max+1), `waitingPosition`, panel customId encode/parse, `buildPanelMessage`
  (embed + 5 buttons, blurple `0x5865f2`, never pings). `advance` (txn) marks active
  `done` and promotes the front waiter; `promote` (txn) sets priority to max+1.
- **metadata:** `requiredPermissions: ['ViewChannel','SendMessages','EmbedLinks',
  'ReadMessageHistory']`, `requiredIntents: ['Guilds','GuildVoiceStates']`,
  `auditEvents: ['raisehand.next','raisehand.panel','raisehand.cleared']`.
- **Admin route:** **none / placeholder.** There is NO
  `apps/admin/src/routes/raise-hand.ts` and no import in `routes/index.ts`. This is a
  real gap — raise-hand is configured entirely through Discord (slash + panel), with no
  admin-panel surface.
- **defaultEnabled:** `false` (seed.ts).
- **Caveats:** The module never actually mutes anyone — `MuteMembers` is used purely to
  identify moderators. The panel exposes only 5 of the 8 actions (no remove/promote
  buttons). `done` entries persist as history until `clear-speaker-queue`.

---

## Checkpoint

Status: PASS

### Validat
- All 4 modules read in full (index.ts, logic/service/matcher/render, repo.ts,
  commands.ts where present).
- Slash commands + defaultMemberPermissions gates verified in code: scheduled-messages=0,
  automod=0, custom-commands=1 (`/custom`, no gate), raise-hand=8 (3 open + 5 gated by
  `MuteMembers`).
- Platform events verified: automod `message.create`; raise-hand `component.interaction`
  + `voice.state.update`; scheduled-messages & custom-commands handle none.
- DB tables verified against schema.ts: scheduled_messages, scheduled_message_runs,
  automod_rules, automod_violations, custom_commands, speaker_queues,
  speaker_queue_entries.
- seed.ts: all four `defaultEnabled: false`.
- Admin routes verified present + registered for scheduled-messages, automod,
  custom-commands; absent for raise-hand.
- Scheduler: only scheduled-messages registers a job (`scheduled-messages.deliver-due`,
  30s); confirmed in main.ts line 205.

### Nevalidat
- Runtime behaviour not executed (no Node/Docker run in this pass) — all conclusions are
  static-read.
- Exact admin-route POST sub-actions (e.g. pause/delete/test) were sampled by path,
  not exhaustively read line-by-line.

### Probleme
- automod: `repeated_messages` and `raid` rule types are declared but non-functional
  (matcher returns NO_MATCH); spam state is per-process in-memory.
- custom-commands: `allowedRoleIds` stored but NOT enforced at runtime (only channel
  allowlist + cooldown are); `custom-command.created` audit event declared in metadata
  but emitted by the admin route, not the bot module.
- raise-hand: no admin route (Discord-only config) — confirmed gap.

### Următorul agent poate continua?
Da. To extend: read the admin-route POST handlers fully for create/update/test/pause
semantics, and inspect `packages/shared/src/types.ts` enums (scheduleType,
automodRuleType, automodAction, customCommandResponseType) + the Drizzle enum
definitions near the top of schema.ts for exact allowed values.
