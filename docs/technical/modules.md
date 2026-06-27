# Modules Catalog

Per-module reference for the **botplatform** Discord bot platform. All 20 modules
listed below are wired into the bot kernel in `apps/bot/src/main.ts` and registered
as built-in modules in `packages/database/src/seed.ts`.

Module keys are defined in `packages/shared/src/types.ts` (`MODULE_KEYS`).

**Verification legend**
- *verified in code* — confirmed by reading the module/source on 2026-06-27.
- *deduced* — inferred from code structure; not asserted by an explicit statement in code.
- *documented-elsewhere-unverified* — taken from other docs; not re-confirmed here.

> Scope note (verified in code): there are **20 modules**. **8 have a dedicated
> module admin route plugin** in `apps/admin/src/routes/` (announcements, cards,
> welcome, role-menus, scheduled-messages, custom-commands, birthdays, automod —
> `apps/admin/src/routes/index.ts`), plus the `/commands` reference page
> (`commands.ts`) and a trailing `placeholders.ts`. **Two more modules have a
> real admin page defined inline in `apps/admin/src/server.ts`**: `audio-player`
> (`/audio`, line 282) and `moderation` (`/moderation`, line 386) — so **10
> modules have a real admin page in total**. **10 modules have NO admin page**:
> `reminders` (placeholder-only, no CRUD) plus the 9 newest modules (raise-hand,
> fun-commands, engagement-prompts, giveaways, server-stats, trivia, minigames,
> economy, levels). This aligns with `architecture.md` §7.2, which counts the two
> inline pages and also counts the `reminders` *placeholder* page — so it states
> "**11 have a page / 9 have ZERO admin UI**". The only difference is bookkeeping:
> this file treats the read-only `reminders` placeholder as "no real page" (→ 10
> with a real page), while §7.2 counts the placeholder as a page (→ 11). Both
> describe the same code. Flagged per-section and in the table below.

---

## Summary table

| # | Module (key) | Commands | Platform events | Scheduler jobs | Admin page | Default |
|---|--------------|:--------:|-----------------|:--------------:|-----------|:-------:|
| 1 | Audio Player (`audio-player`) | 12 | `component.interaction` | 0 | yes — inline `/audio` in `server.ts` (+ internal API for controls) | **on** |
| 2 | Moderation (`moderation`) | 12 | — | 0 | yes — inline `/moderation` in `server.ts` | off |
| 3 | Announcements (`announcements`) | 1 | — | 1 | yes | **on** |
| 4 | Welcome / Leave (`welcome`) | 0 | `member.join`, `member.leave` | 0 | yes | off |
| 5 | Dynamic Cards (`dynamic-cards`) | 0 | — | 0 | yes | off |
| 6 | Reaction Roles (`role-menus`) | 1 (4 sub) | `component.interaction` | 0 | yes | off |
| 7 | Birthdays (`birthdays`) | 1 (4 sub) | — | 1 | yes | off |
| 8 | Reminders (`reminders`) | 1 (3 sub) | — | 1 | **no — gap** | off |
| 9 | Scheduled Messages (`scheduled-messages`) | 0 | — | 1 | yes | off |
| 10 | Auto-Moderation (`automod`) | 0 | `message.create` | 0 | yes | off |
| 11 | Custom Commands (`custom-commands`) | 1 | — | 0 | yes | off |
| 12 | Speaker Queue (`raise-hand`) | 8 | `component.interaction`, `voice.state.update` | 0 | **no — gap** | off |
| 13 | Fun Commands (`fun-commands`) | 5 | — | 0 | **no — gap** | off |
| 14 | Engagement Prompts (`engagement-prompts`) | 6 | `component.interaction` | 1 | **no — gap** | off |
| 15 | Giveaways (`giveaways`) | 1 (5 sub) | `component.interaction` | 1 | **no — gap** | off |
| 16 | Server Stats (`server-stats`) | 3 | `message.create` | 2 | **no — gap** | off |
| 17 | Trivia (`trivia`) | 3 | `component.interaction` | 2 | **no — gap** | off |
| 18 | Mini-games (`minigames`) | 2 | `component.interaction` | 1 | **no — gap** | off |
| 19 | Economy (`economy`) | 8 | `component.interaction` | 0 | **no — gap** | off |
| 20 | Levels (`levels`) | 5 | `message.create`, `component.interaction` | 0 | **no — gap** | off |

**Totals (verified in code):** 20 modules · ~83 top-level commands · 9 scheduler
jobs registered in `main.ts` (announcements, scheduled-messages, reminders,
birthdays, engagement-prompts, giveaways, server-stats ×2, trivia ×2,
minigames — note server-stats and trivia each contribute 2) · only **2 modules
default-on** (audio-player, announcements).

**The 9 newest modules with NO dedicated admin route** (verified gap): `raise-hand`,
`fun-commands`, `engagement-prompts`, `giveaways`, `server-stats`, `trivia`,
`minigames`, `economy`, `levels`. In addition, `reminders` has only a read-only
placeholder page (no CRUD). So **10 of 20 modules have no real admin page**. The
other 10 modules DO have a page: the 8 `routes/` plugins plus `audio-player`
(`/audio`) and `moderation` (`/moderation`), both defined inline in
`apps/admin/src/server.ts` (verified in code: `server.ts:282,386`).

---

# Audio

## 1. Audio Player — `audio-player`

- **Package:** `packages/audio-module`
- **Purpose:** Voice-channel audio playback (YouTube / SoundCloud / Spotify / direct
  links + online radio) with a queue and a visual now-playing control panel.
- **Default enabled:** **on** (one of only two on-by-default modules) — `seed.ts:26-30`.

**Commands** (12; all `guildOnly`, no permission gate):

| Command | Description |
|---|---|
| `/join` | Join your current voice channel |
| `/leave` | Leave the voice channel |
| `/play url:<string>` | Play from YouTube/SoundCloud/Spotify or a direct link, or queue it |
| `/playlist url:<string>` | Add every track from a YouTube playlist link |
| `/queue` | Show the current queue (first 10) |
| `/skip` | Skip the current track |
| `/pause` | Pause playback |
| `/resume` | Resume paused playback |
| `/stop` | Stop playback and clear the queue (stays in channel) |
| `/nowplaying` | Show current track with a visual progress bar |
| `/controls` | Show audio player controls + live status |
| `/radio [list \| play <station> \| stop \| nowplaying]` | Play online radio stations |

**Events:** `component.interaction` (one subscription; the single handler fans out to
both the audio-button handler and the radio-select handler, each ignoring customIds it
doesn't own).

**Interactions:**
- `audio:` prefix buttons (`now-playing.ts` `AUDIO_BUTTON_PREFIX='audio:'`):
  `audio:pause|resume|skip|stop|leave|refresh` → performs the action via `PlayerManager`,
  then edits the now-playing panel in place (`event.update`) or replies.
- `radio:select` select-menu (`RADIO_SELECT_ID`, `radio:` prefix) → plays the chosen
  station on the ACTIVE session; if the bot isn't connected, instructs the user to use
  `/radio play`.

**Scheduler jobs:** none (NOT registered with `kernel.scheduler` in `main.ts`).

**DB tables:** `playback_history`, `queue_items` (via `createPlaybackRepo`). Persistence
is optional — `createAudioModule` accepts `playback:null` to disable history/queue mirror.

**Required permissions / intents:** **UNDECLARED.** The module `index.ts` sets **no
metadata block at all**, so `requiredPermissions` and `requiredIntents` are `undefined`
(verified in code) — a gap for admin-panel display.

**Admin route:** has an admin page, but **not** a `routes/` plugin — the `/audio` page is
defined **inline in `apps/admin/src/server.ts:282`** (`GET /audio`, plus the audio control
POSTs). Live control actions (skip/stop/clear-queue) go through the **bot internal API**
(`audioHandle` / `buildInternalApi`, `main.ts:231-241`).

**Caveats:**
- Streaming sources (yt-dlp providers) gated behind `config.audio.enableStreamingSources`;
  `onLoad` warns if yt-dlp is unavailable.
- Per-guild audio overrides live in `guild_settings`
  (`allowedAudioDomains` / `maxQueueSize` / `maxTrackDurationSeconds`), but the module
  package itself only reads/writes `playback_history` + `queue_items`.

---

# Moderation & safety

## 2. Moderation — `moderation`

- **Package:** `packages/moderation-module`
- **Purpose:** Moderation commands (warn, timeout, kick, ban, unban, purge, slowmode,
  lock/unlock) with numbered case logging, optional DM-on-action and mod-log.
- **Default enabled:** off — `seed.ts`.

**Commands** (12; all flat — no subcommands; all `guildOnly`; each has a
`defaultMemberPermissions` gate):

| Command | Gate | Description |
|---|---|---|
| `/warn user reason` | `ModerateMembers` | Warn a member; writes a `warnings` row AND a warn case |
| `/warnings user` | `ModerateMembers` | List a member's warnings (ephemeral) |
| `/clearwarnings user` | `ModerateMembers` | Clear active warnings (records an `other` case; history retained) |
| `/timeout user minutes(1-40320) [reason]` | `ModerateMembers` | Time out a member; protects owner |
| `/untimeout user [reason]` | `ModerateMembers` | Remove a member's timeout |
| `/kick user [reason]` | `KickMembers` | Kick a member; protects owner |
| `/ban user [reason] [delete_days 0-7]` | `BanMembers` | Ban a member; protects owner |
| `/unban user_id [reason]` | `BanMembers` | Unban a user by ID |
| `/purge amount(1-100)` | `ManageMessages` | Bulk-delete recent messages (ephemeral) |
| `/slowmode seconds(0-21600)` | `ManageChannels` | Set channel slowmode |
| `/lock [reason]` | `ManageChannels` | Lock this channel |
| `/unlock [reason]` | `ManageChannels` | Unlock this channel |

**Events:** none. **Interactions:** none. **Scheduler jobs:** none.

**DB tables:** `moderation_cases`, `moderation_settings`, `warnings`,
`moderation_actions`, `moderation_rules`, `permission_mappings`.

**Required permissions:** `ModerateMembers`, `KickMembers`, `BanMembers`,
`ManageMessages`, `ManageChannels`.
**Required intents:** `Guilds`, `GuildModeration`.

**Admin route:** has an admin page, but **not** a `routes/` plugin — the `/moderation`
page is defined **inline in `apps/admin/src/server.ts:386`** (`GET /moderation` + a rule
toggle POST). It is not registered in `apps/admin/src/routes/index.ts`. The rich schema and
exported services (warning / action / rule / permission) are only partially surfaced by
this inline page.

**Caveats:**
- Commands are only built when `db` AND `guildServiceProvider` AND `services` AND `cases`
  are all present (`main.ts` passes all).
- Shared `runAction`: optional `protectOwner`, creates a numbered `moderation_cases` row,
  best-effort DM-on-action and mod-log channel message from `moderation_settings`, then
  `audit.record`.
- `/warn` writes BOTH a `warnings` row (WarningService) and a warn moderation case.
- `/clearwarnings` does NOT delete warnings; it only records an `other` case (foundation).
- Acts via `GuildServiceProvider.forGuild(...)`
  (`timeoutMember`/`removeTimeout`/`kickMember`/`banMember`/`unbanMember`/`purgeMessages`/`setSlowmode`/`setChannelLocked`);
  replies "bot not connected" when the service is unavailable.
- `auditEvents` metadata: `moderation.warn`, `moderation.mute`, `moderation.kick`,
  `moderation.ban`, `moderation.purge`. Runtime audit action key is
  `moderation.<actionType>` (mute/unmute/kick/ban/unban/other) plus `moderation.purge`.

---

## 10. Auto-Moderation — `automod`

- **Package:** `packages/automod-module`
- **Purpose:** Auto-moderation — banned words, spam, mention, caps, invite/suspicious
  links, attachments and new-account filtering with per-rule actions and escalation.
- **Default enabled:** off — `seed.ts`.

**Commands:** none — entirely event-driven; rules are authored in the admin panel.

**Events:** `message.create` — `handleMessage` upserts the guild, loads
`enabledForGuild` rules, skips ignored channels/roles, evaluates each rule, applies
**one action per message**.

**Scheduler jobs:** none.

**DB tables:**
- `automod_rules` (`name`, `ruleType` enum, `enabled` default false, `config` jsonb,
  `action` enum default `log_only`, `severity`, `ignoredChannelIds`, `ignoredRoleIds`,
  `escalationThreshold`, `escalationAction`, `responseMessage`; idx `guildId`).
- `automod_violations` (bigserial id, FK `ruleId` set-null, `userExternalId`, `channelId`,
  `ruleType`, `actionTaken`, `detail`, `createdAt`; idx `guildId`, `(guildId,userExternalId)`).

**Required permissions:** `ManageMessages`, `ModerateMembers`.
**Required intents:** `Guilds`, `GuildMessages`, `MessageContent`.

**Admin route:** **yes** — `apps/admin/src/routes/automod.ts` (REAL, registered;
`GET /automod`, `POST /automod` create, `POST /automod/:id` action).

**Caveats:**
- Rule types: `banned_words`, `spam`, `repeated_messages`, `mention_spam`, `caps`,
  `invite_links`, `suspicious_links`, `attachments`, `new_account`, `raid`.
- **GAP:** `repeated_messages` and `raid` are declared rule types but `matchesRule` returns
  NO_MATCH (non-functional stubs).
- `spam` is stateful in-memory (`SPAM_WINDOW_MS=10000`, default `SPAM_THRESHOLD=5`);
  per-process (`recentMessages` Map, pruned at >=5000 keys), not shared across instances,
  reset on restart.
- Actions: `log_only`, `delete`, `timeout`/`mute` (600s), `kick`, `ban`, `warn` (replies
  `responseMessage`). Escalation: counts user violations in the last 10 min
  (`ESCALATION_WINDOW_MS`); upgrades to `escalationAction` when `count+1 >= escalationThreshold`.
- **Content-intent gate:** `contentRulesAvailable = config.discord.enableMessageContent`;
  when the `MessageContent` privileged intent is OFF, content rules silently degrade and
  `onLoad` logs a DEGRADED warning (the module still loads).
- `auditEvents` metadata: `['automod.violation']` (severity `notice`).

---

# Engagement & fun

## 4. Welcome / Leave — `welcome`

- **Package:** `packages/welcome-module`
- **Purpose:** Welcome/leave messages, optional welcome cards, DMs and auto-roles, driven
  by member join/leave events.
- **Default enabled:** off — `seed.ts`.

**Commands:** none — fully event-driven, configured via the admin panel.

**Events:** `member.join` → `service.handleJoin`; `member.leave` → `service.handleLeave`.

**Scheduler jobs:** none. Delayed welcome uses an in-process
`setTimeout(delaySeconds*1000)` with `unref()` — NOT the kernel scheduler.

**DB tables:** `welcome_settings` (per-guild, primary key `guild_id`).

**Required permissions:** `SendMessages`, `ManageRoles`, `AttachFiles`.
**Required intents:** `GuildMembers` (**privileged** — the platform gates it behind an
opt-in flag, commit `4ee8b66`, so events only fire when enabled — *deduced*).

**Admin route:** **yes** — `apps/admin/src/routes/welcome.ts` (`registerWelcomeRoutes`).

**Caveats:**
- **Auto-roles fire on EVERY join, INDEPENDENT of the welcome-message toggle, and
  IMMEDIATELY** (not subject to `delaySeconds`) — matches commit `695be76`. Per-role
  failures are logged, don't break the join; emits one `welcome.autorole` audit when >=1
  role is assigned.
- Welcome message/card/DM gated on `welcomeEnabled`; the service is re-resolved at send
  time so a delayed message survives a brief disconnect.
- Join dedup: in-memory `recentJoins` map, 60s TTL (`DEDUP_TTL_MS`).
- Bridged to the cards module in `main.ts:79-81`: `renderCard = cardsHandle.service.renderById`;
  optional `welcome_card_template_id` → `card_templates`.
- `auditEvents` metadata: `welcome.sent`, `welcome.leave`, `welcome.autorole`.

---

## 5. Dynamic Cards — `dynamic-cards` (package `cards-module`)

> Note: the module **key** is `dynamic-cards` (`MODULE_KEYS.dynamicCards`,
> seed name "Dynamic Cards"); the **package** is `packages/cards-module`.

- **Package:** `packages/cards-module`
- **Purpose:** Rendering service that generates personalized PNGs (welcome/birthday
  cards, banners) from sanitized layout templates; no user-facing commands.
- **Default enabled:** off — `seed.ts:43-48`.

**Commands:** none. **Events:** none. **Interactions:** none. **Scheduler jobs:** none.

**DB tables:** `card_templates` (`cardTemplates`), `card_assets` (`cardAssets`).

**Required permissions:** `AttachFiles`. **Required intents:** not set (omitted).

**Admin route:** **yes** — `apps/admin/src/routes/cards.ts`.

**Caveats:**
- Exposes `CardsService`, consumed by the welcome module (`renderCard` bridge in
  `main.ts:79-81`) and by admin preview.
- Avatar/background fetch is SSRF-guarded via `openSafeHttpStream`, capped at 8 MiB
  (`service.ts:17,72-95`).
- `card_templates.backgroundAssetId` is a plain uuid (no FK) and unused by the renderer;
  the layout JSON `background.assetId` drives asset resolution — *deduced* legacy column.
- `auditEvents`: `card.template.created` / `updated` / `archived`.

---

## 6. Reaction Roles — `role-menus` (package `role-menus-module`)

- **Package:** `packages/role-menus-module`
- **Purpose:** Self-assignable roles via buttons / select menus (seed name "Reaction
  Roles"); the admin panel is the primary editor.
- **Default enabled:** off — `seed.ts:49-54`.

**Commands** (`guildOnly`; **no** `defaultMemberPermissions` on the command or any
subcommand):

| Command | Description |
|---|---|
| `/roles list` | List role menus |
| `/roles menu id:<string>` | Publish a menu to the current channel |
| `/roles refresh id:<string>` | Re-publish (delete old + re-send) |
| `/roles remove id:<string>` | Disable a menu |

**Events:** `component.interaction` → `service.handleInteraction` (`index.ts:50-55`).

**Interactions:**
- Button `rolemenu:<menuId>:<roleId>` (`buttonCustomId`) — toggles/sets that single role
  per menu mode.
- Select `rolemenu:<menuId>` (`selectCustomId`) — values = full desired set; `parseCustomId`
  rejects non-`rolemenu:` ids; `computeRoleChanges` honors mode
  (`add_only`/`remove_only`/`single`/`unique`/`multiple`|`toggle`) and constraints
  (`maxSelections`/`requiredRoleId`/`blockedRoleId`); calls
  `guildService.addRole`/`removeRole`; logs to `role_assignment_logs`.

**Scheduler jobs:** none.

**DB tables:** `role_menus` (`roleMenus`), `role_menu_options` (`roleMenuOptions`),
`role_assignment_logs` (`roleAssignmentLogs`).

**Required permissions:** `ManageRoles`, `SendMessages`. **Required intents:** `Guilds`.

**Admin route:** **yes** — `apps/admin/src/routes/role-menus.ts`.

**Caveats:**
- **Gating caveat:** `/roles menu|refresh|remove` publish/disable menus to channels with
  NO `defaultMemberPermissions` gate — any member can invoke; replies are ephemeral but
  publish posts a real message. `memberHasPermission` is NOT used by the handler;
  constraint roles are the only access control on button/select use.
- Button menus cap at 25 options (`logic.ts:139`); select `maxValues` forced to 1 for
  `single`/`unique` modes.
- `auditEvents`: `rolemenu.published`.

---

## 12. Speaker Queue — `raise-hand` (package `raise-hand-module`)

- **Package:** `packages/raise-hand-module`
- **Purpose:** Persistent raise-hand speaking queue scoped per (guild, voice channel) with
  moderator controls and a button panel (seed name "Speaker Queue").
- **Default enabled:** off — `seed.ts`.

**Commands** (8 top-level, intentionally NOT grouped so each can be gated independently;
all `guildOnly`):

| Command | Gate | Description |
|---|---|---|
| `/raise-hand` | — | Join the speaking queue for your current VC |
| `/lower-hand` | — | Lower hand and leave the queue |
| `/speaker-queue` | — | Show the current speaking order for your VC |
| `/next-speaker` | `MuteMembers` | Moderator: advance the queue |
| `/remove-speaker user` | `MuteMembers` | Moderator: remove a member from the queue |
| `/clear-speaker-queue` | `MuteMembers` | Moderator: clear the queue for your VC |
| `/promote-speaker user` | `MuteMembers` | Moderator: move a member to the front |
| `/speaker-panel` | `MuteMembers` | Moderator: post the persistent button control panel |

**Events:**
- `component.interaction` → `service.handleInteraction` (routes panel button clicks).
- `voice.state.update` → `service.handleVoiceState` — drops a user from the queue of any
  channel they leave/move from; uses the **non-privileged** `GuildVoiceStates` intent.

**Interactions:** `rh:<action>:<voiceChannelId>`; actions `raise|lower|show|next|clear`
(the panel has 5 buttons). `MODERATOR_ACTIONS={next,clear}` are re-checked server-side via
`isModerator()` = `svc.isGuildOwner()` OR `svc.memberHasPermission(user,'MuteMembers')`;
non-mods get "Only moderators (Mute Members) can use that control."

**Scheduler jobs:** none.

**DB tables:**
- `speaker_queues` (one per (guild, voiceChannelId), unique idx; `voiceChannelName` cache,
  `panelChannelId`, `panelMessageId`, `announceChannelId`; survives restarts).
- `speaker_queue_entries` (`userExternalId`, `displayName`, `status` waiting|active|done,
  `priority` higher=front, `raisedAt`; FK `queueId` cascade; partial unique idx
  `(queueId,userExternalId) WHERE status<>'done'`; ordering priority DESC, raisedAt ASC).

**Required permissions:** `ViewChannel`, `SendMessages`, `EmbedLinks`, `ReadMessageHistory`.
**Required intents:** `Guilds`, `GuildVoiceStates`.

**Admin route:** **none — gap** (verified). No `apps/admin/src/routes/raise-hand.ts` and no
import in `routes/index.ts`; configured entirely via Discord slash + panel.

**Caveats:**
- The module never actually mutes anyone — `MuteMembers` is used purely to identify
  moderators.
- The panel exposes only 5 of 8 actions (no remove/promote buttons); remove/promote are
  slash-only.
- Moderator re-check on panel buttons uses `GuildService.memberHasPermission` (the new
  server-side per-member gate).
- `auditEvents`: `['raisehand.next','raisehand.panel','raisehand.cleared']`; `done` entries
  persist as history until `clear-speaker-queue`.

---

## 13. Fun Commands — `fun-commands` (package `fun-commands-module`)

- **Package:** `packages/fun-commands-module`
- **Purpose:** Stateless random fun slash commands (8-ball, dice, coin flip, chooser,
  rock-paper-scissors) with an in-memory per-user cooldown.
- **Default enabled:** off — `seed.ts`.

**Commands** (5; none `guildOnly`, none with `defaultMemberPermissions`):

| Command | Description |
|---|---|
| `/8ball question:<string>` | Ask the magic 8-ball a yes/no question |
| `/roll [dice:<string>]` | Roll dice e.g. `1d20` or `2d6+3` (default `1d6`), clamped to DICE_LIMITS |
| `/flip` | Flip a coin |
| `/choose options:<string>` | Pick one of comma/pipe-separated options (max 20) |
| `/rps move:<rock\|paper\|scissors>` | Rock-paper-scissors vs the bot |

**Events:** none. **Interactions:** none. **Scheduler jobs:** none. **DB tables:** none —
fully stateless.

**Required permissions:** `SendMessages`. **Required intents:** `Guilds`.

**Admin route:** **none — gap.**

**Caveats:**
- Per-user-per-command cooldown is in-memory, default 3000ms (`createCooldownStore` +
  `hitCooldown`, key `` `${user.id}:${name}` ``); resets on restart.
- Factory `createFunCommandsModule` takes only `{ logger }` (no `db`/`guildServiceProvider`)
  in `main.ts:104`.
- Pure logic in `logic.ts` is deterministic via injectable `rng`/`now`; `logic.test.ts`
  present.

---

## 14. Engagement Prompts — `engagement-prompts` (package `engagement-prompts-module`)

- **Package:** `packages/engagement-prompts-module`
- **Purpose:** Conversation-starter prompts (QOTD, Would You Rather, Truth/Dare, Never Have
  I Ever, Most Likely To) plus a scheduled daily Question of the Day.
- **Default enabled:** off — `seed.ts`.

**Commands** (6; all `guildOnly`):

| Command | Gate | Description |
|---|---|---|
| `/qotd` | — | Post a Question of the Day |
| `/wyr` | — | Would You Rather |
| `/neverhaveiever` | — | A Never Have I Ever prompt |
| `/mostlikelyto` | — | Who's most likely to… |
| `/truthordare [kind:truth\|dare\|random]` | — | Get a truth or a dare |
| `/promptconfig channel hour(0-23 UTC) enabled` | `ManageGuild` | Configure the daily QOTD |

**Events:** `component.interaction`.

**Interactions:** `prompt:another:<category>` — re-pick a non-recent prompt for the
category and `event.update()` the message in place (falls back to `event.reply` if no
update). Unknown category or no guild → "no longer available" reply.

**Scheduler jobs:** `engagement-prompts.daily-qotd` — interval 5 min (5×60_000ms);
`deliverDailyQotd` posts to guilds where `isQotdDue` (enabled + channel + matching UTC hour
+ not posted today); advances `lastQotdDate` even on send failure. Registered in
`main.ts:208`.

**DB tables:** `prompt_settings` (PK `guild_id` → `guilds` cascade; `qotd_channel_id`,
`qotd_enabled` default false, `qotd_hour_utc` default 12, `last_qotd_date`, `recent` jsonb
default `{}`, `updated_at`).

**Required permissions:** `SendMessages`. **Required intents:** `Guilds`.

**Admin route:** **none — gap.**

**Caveats:**
- Prompt banks are bundled SFW in-repo data (`banks.ts`), no external API.
- Categories: `qotd`, `wyr`, `truth`, `dare`, `nhie`, `mostlikely`. `/truthordare` maps
  `kind` to truth/dare (random via `rng`).
- Non-repeating selection via per-category recent ring buffer (cap 12) persisted in
  `prompt_settings.recent` jsonb.
- Per-user cooldown default 5000ms (in-memory).
- Internal guild id resolved on demand via `guilds.upsertByExternalId`.

---

## 15. Giveaways — `giveaways` (package `giveaways-module`)

- **Package:** `packages/giveaways-module`
- **Purpose:** Run giveaways with a one-tap Enter button and an automatic scheduled draw;
  supports end-now, reroll, cancel and list.
- **Default enabled:** off — `seed.ts`.

**Commands** (`guildOnly`; the whole command + all subcommands gated by `ManageGuild`):

| Command | Description |
|---|---|
| `/giveaway start prize duration winners(1-20, default 1) [channel]` | Start a giveaway (duration e.g. `1h`/`1d`/`1d 6h`) |
| `/giveaway end id` | End now |
| `/giveaway reroll id` | Reroll winners (ended only) |
| `/giveaway cancel id` | Cancel (active only) |
| `/giveaway list` | List giveaways |

(`id` is an 8-char short id, prefix match.)

**Events:** `component.interaction`.

**Interactions:** `giveaway:enter:<giveawayId>` — add a unique entry to `giveaway_entries`
(dedup via unique index); replies entered / already entered / ended.

**Scheduler jobs:** `giveaways.draw-due` — interval 30s (30_000ms); `drawDue` finds active
giveaways past `ends_at`, draws unique winners (partial Fisher-Yates), marks ended, edits
the original message + posts a congrats announcement (best-effort). Registered in
`main.ts:209`.

**DB tables:**
- `giveaways` (PK uuid; `guild_id` → `guilds` cascade, `channel_id`, `message_id`, `prize`,
  `winners_count` default 1, `host_external_id`, `status` default `active` (active/ended/canceled),
  `winners` jsonb string[], `ends_at`, `ended_at`, `created_at`; idx `giveaways_guild_idx`,
  `giveaways_due_idx(status,ends_at)`).
- `giveaway_entries` (PK uuid; `giveaway_id` → `giveaways` cascade, `user_external_id`,
  `created_at`; unique `(giveaway_id,user_external_id)`).

**Required permissions:** `SendMessages`, `EmbedLinks`. **Required intents:** `Guilds`.

**Admin route:** **none — gap.**

**Caveats:**
- `metadata.auditEvents: []` (empty).
- Duration parsed by `parseDuration` (s/m/h/d/w + combos), clamped 10s..30 days; winners
  clamped 1..20.
- `start` throws `ADAPTER_ERROR` if the bot isn't connected; `reroll` only on ended,
  `cancel`/`end` only on active (`UserFacingError` → `toSafeUserMessage`).
- `findByShortId` loads up to 200 recent guild giveaways and matches exact id or prefix.

---

# Utility

## 3. Announcements — `announcements`

- **Package:** `packages/announcements-module`
- **Purpose:** Create, schedule and send server announcements; the admin panel is the
  primary UI, and a worker scheduler job delivers due/scheduled announcements.
- **Default enabled:** **on** — `seed.ts:32-36`.

**Commands** (1 parent, `guildOnly`, **no** `defaultMemberPermissions` — admin panel is
primary UI):

| Command | Description |
|---|---|
| `/announcement list` | Recent 10 (ephemeral) |
| `/announcement preview id` | Preview an announcement |
| `/announcement send id` | Defer, then immediate `deliverById` |
| `/announcement cancel id` | Set status canceled; refuses if already sent |

(`id` accepts the first 8 chars.)

**Events:** none. **Interactions:** none.

**Scheduler jobs:** `announcements.deliver-due` @ 30000ms (`DELIVERY_TICK_MS`); registered
in `main.ts:204` via `kernel.scheduler.register(announcementsHandle.schedulerJob)`; calls
`service.deliverDue(now)`.

**DB tables:** `announcements` (has optional `card_template_id` → `card_templates`).

**Required permissions:** `SendMessages`, `EmbedLinks`. **Required intents:** `Guilds`.

**Admin route:** **yes** — `apps/admin/src/routes/announcements.ts`
(`registerAnnouncementRoutes`; registered first in `index.ts`).

**Caveats:**
- `auditEvents` metadata: `announcement.sent`, `announcement.failed`, `announcement.created`.
- `configSchema`: one field `defaultChannelId` (type channel, label "Default channel").
- No `component.interaction` handler even though `announcements.buttons` jsonb exists in the
  schema (buttons are rendered but not handled by this module).
- Admin "Send now" schedules for immediate delivery; the worker delivers within ~30s (the
  admin app has no Discord connection).

---

## 7. Birthdays — `birthdays` (package `birthdays-module`)

- **Package:** `packages/birthdays-module`
- **Purpose:** Opt-in birthday announcements with an optional birthday role; card template +
  role-duration are configurable but not acted on by the scheduler.
- **Default enabled:** off — `seed.ts:55-60`.

**Commands** (1 parent, `guildOnly`; all subcommands self-service + ephemeral, no
`defaultMemberPermissions`):

| Command | Description |
|---|---|
| `/birthday set month day [year] [timezone]` | Opt-in set/update your birthday |
| `/birthday view` | View your birthday |
| `/birthday remove` | Hard-delete (privacy) |
| `/birthday upcoming` | List upcoming (excludes `visibility=private`, max 15) |

**Events:** none. **Interactions:** none.

**Scheduler jobs:** `birthdays.announce` @ `TICK_MS = 5*60_000` (every 5 min; per-announce-hour
UTC gate + per-(guild,user,date) dedup row prevents duplicates). Registered in `main.ts:207`.

**DB tables:** `birthdays` (`birthdays`), `birthday_settings` (`birthdaySettings`),
`birthday_announcements` (`birthdayAnnouncements`).

**Required permissions:** `SendMessages`, `ManageRoles`. **Required intents:** `Guilds`.

**Admin route:** **yes** — `apps/admin/src/routes/birthdays.ts`.

**Caveats:**
- Scheduler gates on guild `announceHour` in UTC (settings has no tz column), then matches
  each birthday month/day in the USER's own timezone; sends FIRST, then records dedup so
  transient failures retry; optionally adds the birthday role; audits `birthday.announced`.
- **Configured-but-unimplemented:** `birthday_settings.cardTemplateId` and
  `roleDurationHours` are stored but the scheduler does NOT render a birthday card nor
  schedule role removal after `roleDurationHours` — the role is added and never auto-removed
  (*deduced*).
- `birthdays`: unique `(guildId,userExternalId)`, index `(month,day)`; visibility
  public|members|private (default members); `year` nullable.

---

## 8. Reminders — `reminders` (package `reminders-module`)

- **Package:** `packages/reminders-module`
- **Purpose:** Personal and recurring reminders delivered by DM or in a channel.
- **Default enabled:** off — `seed.ts:61-66`.

**Commands** (1 parent, `guildOnly`; all ephemeral, no `defaultMemberPermissions`):

| Command | Description |
|---|---|
| `/reminder create message when [here] [repeat]` | `parseDuration` for when/repeat (`30m`/`2h`/`1d 6h`/bare-number=minutes, clamped 60s..365d); `here`=channel else DM; MAX_PER_USER=25 |
| `/reminder list` | List active (max 50) |
| `/reminder remove id` | Remove by id prefix, scoped to user |

**Events:** none. **Interactions:** none.

**Scheduler jobs:** `reminders.deliver-due` @ `TICK_MS = 30_000` (every 30s). Registered in
`main.ts:206`.

**DB tables:** `reminders` (only one table — no settings/log table).

**Required permissions:** `SendMessages`. **Required intents:** `Guilds`.

**Admin route:** **placeholder-only — gap** (verified). No `apps/admin/src/routes/reminders.ts`
and no plugin in `routes/index.ts`; the only `/reminders` page is the static, read-only
placeholder in `apps/admin/src/routes/placeholders.ts:9` (no CRUD) — despite a
`createdByAdmin` column on the `reminders` table, so admin-created reminders are unreachable
from the panel.

**Caveats:**
- Delivery (`index.ts:39-87`): channel delivery prepends role mentions + `<@user>`; DM
  fallback otherwise. Bot offline → leave `dueAt` (retry next tick). Send fails online →
  `reschedule(+RETRY_BACKOFF_MS=2min)` so one-offs/recurrences are never dropped. Success:
  recurring → reschedule by `recurrenceSeconds`; one-off → deactivate. Audits
  `reminder.delivered`.
- `reminders.timezone` column is stored but unused by delivery (delays computed as absolute
  `dueAt = now + seconds`) — *deduced* legacy/forward-looking. Indexes on `dueAt` and
  `userExternalId`; `guildId` nullable.

---

## 9. Scheduled Messages — `scheduled-messages` (package `scheduled-messages-module`)

- **Package:** `packages/scheduled-messages-module`
- **Purpose:** Schedule one-off and recurring (interval/daily/weekly/monthly/cron) messages
  to channels, delivered by a 30s scheduler tick.
- **Default enabled:** off — `seed.ts`.

**Commands:** none — entirely scheduler-driven; authored only via the admin panel.
**Events:** none.

**Scheduler jobs:** `scheduled-messages.deliver-due` (intervalMs=30000 / `TICK_MS`, 30s;
`listDue<=50` rows where `paused=false AND next_run_at<=now`; on success
`recordRun('sent')` + audit + `computeNextRun` advance, one-offs whose next=null get
`paused=true`; on failure `recordRun('failed')` + 5 min `RETRY_BACKOFF_MS` reschedule;
bot-offline leaves the row untouched to retry). Registered in `main.ts:205` — the only one
of these modules whose scheduler is explicitly registered as `schedulerJob`.

**DB tables:**
- `scheduled_messages` (`name`, `channelId`, `content`, `format` plain|embed, `embedConfig`
  jsonb, `mentionMode`, `mentionRoleIds`, `scheduleType` enum, `scheduleConfig` jsonb,
  `timezone`, `nextRunAt`, `lastRunAt`, `paused`, `lastFailureReason`; idx `guildId`,
  `nextRunAt`).
- `scheduled_message_runs` (bigserial id, FK `scheduledMessageId` cascade, `status`
  sent|failed|skipped, `detail`, `ranAt`; idx `messageId`).

**Required permissions:** `SendMessages`. **Required intents:** `Guilds`.

**Admin route:** **yes** — `apps/admin/src/routes/scheduled-messages.ts` (REAL, registered;
`GET /scheduled-messages`, `GET /scheduled-messages/new`, `GET /scheduled-messages/:id`,
`POST /scheduled-messages/:id`, `POST /scheduled-messages/:id/<action>`).

**Caveats:**
- Schedule engine `next-run.ts` (pure, luxon + cron-parser): ScheduleType
  once|interval|daily|weekly|monthly|cron; `MIN_INTERVAL_SECONDS=60`; monthly day clamped to
  1-28; invalid tz falls back to UTC.
- `auditEvents` metadata: `['scheduled-message.sent']`.
- 30s tick granularity means times can fire up to ~30s late; the 50-row cap drains a backlog
  over multiple ticks.

---

## 11. Custom Commands — `custom-commands` (package `custom-commands-module`)

- **Package:** `packages/custom-commands-module`
- **Purpose:** Guild-defined text/embed/link/random response commands invoked through a
  single `/custom` dispatcher; the catalog is managed in the admin panel.
- **Default enabled:** off — `seed.ts` (distinct from the per-command DB `enabled` default,
  which is TRUE).

**Commands** (1; `guildOnly`):

| Command | Description |
|---|---|
| `/custom name:<string>` | Run a custom command — enforces the `enabled` flag, `allowedChannelIds` allowlist, and per-(command,user) in-memory cooldown; renders via `renderCustomResponse`, flattens to text, increments `useCount` |

**Events:** none. **Interactions:** none. **Scheduler jobs:** none.

**DB tables:** `custom_commands` (`name` unique-per-guild, `description`, `responseType`
enum default text, `response` jsonb, `allowedRoleIds`, `allowedChannelIds`, `enabled`
default TRUE, `cooldownSeconds`, `useCount`; unique idx `(guildId,name)`).

**Required permissions:** `SendMessages`. **Required intents:** `Guilds`.

**Admin route:** **yes** — `apps/admin/src/routes/custom-commands.ts` (REAL, registered;
`GET /custom-commands`, `GET /custom-commands/new`, `GET /custom-commands/:id`,
`POST /custom-commands/:id`, `POST /custom-commands/:id/<action>`).

**Caveats:**
- The single dispatcher `/custom` avoids dynamic slash registration; the admin panel manages
  the catalog.
- `render.ts` (pure): response types text, embed, random (deterministic
  `pickIndex % choices.length`), link (emits a link button — no interaction handler needed).
  Placeholders via `applyPlaceholders`. `isValidCommandName` = `/^[a-z0-9_-]{1,32}$/`.
- **GAP:** `allowedRoleIds` is stored on the row but NOT enforced at runtime — only the
  channel allowlist + cooldown are enforced by the slash dispatcher.
- `auditEvents` metadata: `['custom-command.created']`, but the module never calls
  `audit.record` — that event is emitted by the admin route, not the bot module.
- Cooldown map is per-process in-memory.

---

## 16. Server Stats — `server-stats` (package `server-stats-module`)

- **Package:** `packages/server-stats-module`
- **Purpose:** Message-activity stats (counts only, no message content) with `/serverstats`,
  `/myactivity` and a scheduled weekly highlights recap.
- **Default enabled:** off — `seed.ts`.

**Commands** (3; all `guildOnly`):

| Command | Gate | Description |
|---|---|---|
| `/serverstats` | — | Server activity stats (today + 7d totals, active members, top 5 chatters, top 3 channels) |
| `/myactivity [user]` | — | Your/another member's activity (today/week/all-time + weekly rank) |
| `/statsconfig channel day(0-6, 0=Sun) hour(0-23 UTC) enabled` | `ManageGuild` | Configure the weekly recap |

**Events:** `message.create` — records into an in-memory accumulator, skipping bot authors
and DMs (`e.author.bot || !e.guild`); keyed by guild/user/channel external ids.

**Scheduler jobs** (both registered in `main.ts:210` via a loop over `schedulerJobs[]`):
- `server-stats.flush` — interval 60s; drains the in-memory `ActivityAccumulator` into
  batched per-day upserts (skips if empty).
- `server-stats.weekly-recap` — interval 5 min; `deliverWeeklyRecaps` posts a "Weekly
  Highlights" embed to guilds where `isRecapDue` (enabled + channel + matching UTC dow + hour
  + not posted today); advances `last_recap_date` even on send failure.

**DB tables:**
- `activity_user_daily` (PK bigserial; `guild_id` → `guilds` cascade, `user_external_id`,
  `date` text YYYY-MM-DD UTC, `messages` default 0; unique `(guild_id,user_external_id,date)`;
  index `(guild_id,date)`).
- `activity_channel_daily` (PK bigserial; `guild_id`, `channel_id`, `date`, `messages`;
  unique `(guild_id,channel_id,date)`; index `(guild_id,date)`).
- `serverstats_settings` (PK `guild_id` → `guilds` cascade; `recap_channel_id`,
  `recap_enabled` default false, `recap_dow` default 1=Mon, `recap_hour_utc` default 12,
  `last_recap_date`, `updated_at`).

**Required permissions:** `SendMessages`, `EmbedLinks`. **Required intents:** `Guilds`.

**Admin route:** **none — gap.**

**Caveats:**
- Counts only — no message content stored.
- The accumulator is in-memory only — lost on restart before flush.

---

## 17. Trivia — `trivia` (package `trivia-module`)

- **Package:** `packages/trivia-module`
- **Purpose:** Channel trivia rounds answered via buttons using a bundled 41-question in-repo
  bank, with a per-guild win leaderboard and optional auto-trivia on an interval.
- **Default enabled:** off — `seed.ts:122-126`.

**Commands** (3; all `guildOnly`):

| Command | Gate | Description |
|---|---|---|
| `/trivia` | — | Start a trivia round in the current channel |
| `/trivia-leaderboard` | — | Show the win leaderboard (top 10) |
| `/triviaconfig channel interval(min, 5..10080) enabled` | `ManageGuild` | Configure auto-trivia (all three options required each call) |

**Events:** `component.interaction` → `service.handleAnswer` (`trivia:ans:` ids only).

**Interactions:** `trivia:ans:<roundId>:<choiceIndex>` → record one answer per user/round
(unique-index enforced), atomic first-correct claim via `resolveIfOpen`, reveal answer +
increment `triviaScores.wins` for the winner.

**Scheduler jobs** (both registered in `main.ts:211` via a loop over `schedulerJobs[]`):
- `trivia.resolve-expired` @ 30000ms (reveal rounds open past 45s `ROUND_TIMEOUT_SEC`, edit
  to time's-up).
- `trivia.auto` @ 60000ms (start auto-trivia where `isAutoDue` and no open round).

**DB tables:** `trivia_rounds`, `trivia_answers`, `trivia_scores`, `trivia_settings`.

**Required permissions:** `SendMessages`, `EmbedLinks`. **Required intents:** `Guilds`.

**Admin route:** **none — gap.** No admin route file and not in `placeholders.ts`.

**Caveats:**
- The question bank is static in-repo (`src/bank.ts`), 41 questions, no external API.
- Non-repeat ring capped at `RECENT_RING_CAP=20` (`logic.ts`).

---

## 18. Mini-games — `minigames` (package `minigames-module`)

- **Package:** `packages/minigames-module`
- **Purpose:** Head-to-head Tic-Tac-Toe and Connect Four played with buttons: challenge →
  accept/decline → board moves, with win/draw detection.
- **Default enabled:** off — `seed.ts:128-132`.

**Commands** (2; all `guildOnly`):

| Command | Description |
|---|---|
| `/tictactoe opponent` | Challenge a user to Tic-Tac-Toe |
| `/connect4 opponent` | Challenge a user to Connect Four |

**Events:** `component.interaction` → `service.handleInteraction` (`mg:` ids only).

**Interactions:**
- `mg:accept:<id>` / `mg:decline:<id>` — only the challenged player (playerO) may respond;
  sets status active or finished.
- `mg:ttt:<id>:<cell 0-8>` — Tic-Tac-Toe move (turn-gated to the current player, validates
  the square is free).
- `mg:c4:<id>:<col 0-6>` — Connect Four move (validates the column isn't full); win/draw via
  `ttt.ts`/`connect4.ts`.

**Scheduler jobs:** `minigames.expire-stale` @ 60000ms (expire pending > 5 min
`PENDING_MAX_AGE_SEC=300`, active idle > 15 min `ACTIVE_IDLE_SEC=900`; edit the message to
Expired). Registered in `main.ts:212` as `minigamesHandle.schedulerJob` (singular).

**DB tables:** `minigame_sessions` (board stored as jsonb int[] 0/1/2).

**Required permissions:** `SendMessages`. **Required intents:** `Guilds`.

**Admin route:** **none — gap.** No admin route file and not in `placeholders.ts`.

**Caveats:**
- `MAX_ACTIVE_PER_USER=3` concurrent pending/active games per challenger (counted across both
  player roles).
- Cannot challenge yourself (`UserFacingError`).
- No win/loss leaderboard or persisted stats beyond the per-session row.

---

# Economy & levels

## 19. Economy — `economy` (package `economy-module`)

- **Package:** `packages/economy-module`
- **Purpose:** Per-guild virtual currency (no real money): balances, daily/streak rewards,
  member-to-member transfers, a role shop, admin grant/take, and an append-only transaction
  ledger.
- **Default enabled:** off — `seed.ts:134-138`.

**Commands** (8; all `guildOnly`):

| Command | Gate | Description |
|---|---|---|
| `/balance [user]` | — | Check a balance (default self) |
| `/give user amount` | — | Transfer currency to another member; atomic |
| `/daily` | — | Claim daily reward (UTC-day + streak via `computeDaily`) |
| `/baltop` | — | Paginated richest members |
| `/shop` | — | Browse paginated active shop items |
| `/buy item` | — | Buy a shop item by short id; grants the role, refunds on grant failure |
| `/economy [grant \| take \| config]` | `ManageGuild` | Admin: grant/take; config currency name/emoji/starting/daily/bonus/cap (partial patch) |
| `/shopadmin [add \| remove]` | `ManageGuild` | Manage shop catalog: add (role + price, optional label) / remove (item) |

**Events:** `component.interaction` → `service.handleInteraction` (`eco:baltop:` /
`eco:shop:` ids).

**Interactions:**
- `eco:baltop:<page>` → re-render the richest-members page (PAGE_SIZE=10).
- `eco:shop:<page>` → re-render the shop page (Prev/Next buttons).

**Scheduler jobs:** none (handle is `{module, service}`; nothing registered in `main.ts`).

**DB tables:** `economy_accounts`, `economy_transactions`, `economy_settings`, `shop_items`,
`shop_purchases`.

**Required permissions:** `SendMessages`, `ManageRoles` (shop purchases grant Discord roles).
**Required intents:** `Guilds`.

**Admin route:** **none — gap.** No admin route file and not in `placeholders.ts`.

**Caveats:**
- Balances clamp at 0 (`applyDelta`); transfers/debits are SQL-transaction atomic;
  `tryDebit` prevents overdraft.
- Buy flow: `tryDebit` → `addRole` → on failure `applyDelta` refund + throw `ADAPTER_ERROR`;
  checks role ownership and bot hierarchy (`canManageRole`) first.
- `findItemByShortId` matches a full uuid or a prefix among up to 200 rows; prefix collisions
  are theoretically possible (first match wins).
- `MAX_AMOUNT = 1_000_000_000` (`logic.ts`); `economy_settings` defaults: coins, 🪙,
  starting 0, daily 100, streak bonus 10, streak cap 30.

---

## 20. Levels — `levels` (package `levels-module`)

- **Package:** `packages/levels-module`
- **Purpose:** Earn XP from chat activity (MEE6-style curve `5l² + 50l + 100`), level up with
  optional reward roles, and compete on a leaderboard with a per-member rank card. XP is
  activity/count-based, not content-based.
- **Default enabled:** off — `seed.ts:140-144` **AND** `level_settings.enabled` defaults
  false in the schema, so leveling is off by default twice; an admin must run
  `/levelconfig enabled:true` to award XP.

**Commands** (5; all `guildOnly`):

| Command | Gate | Description |
|---|---|---|
| `/rank [user]` | — | Level, XP progress bar and rank # (default self) |
| `/levels` | — | Paginated XP leaderboard |
| `/levelconfig …` | `ManageGuild` | Configure (partial patch): enabled, channel, message (`{user}`/`{level}`), xp_min, xp_max, cooldown |
| `/levelnoxp channel add` | `ManageGuild` | Toggle a channel in/out of the no-XP list |
| `/levelrewards [add \| remove \| list]` | `ManageGuild` | Manage level-reward roles |

**Events:**
- `message.create` → `service.handleMessage` (award XP; respects the `enabled` flag,
  cooldown, no-XP channels; uses in-memory caches).
- `component.interaction` → `service.handleInteraction` (`lvl:lb:` ids).

**Interactions:** `lvl:lb:<page>` → re-render the XP leaderboard page (Prev/Next; PAGE_SIZE=10).

**Scheduler jobs:** none (level-up announcements + reward-role grants happen inline on
`message.create`).

**DB tables:** `level_members`, `level_rewards`, `level_settings` (defaults: xp_min 15,
xp_max 25, cooldown 60s, levelUpMessage `🎉 {user} reached level **{level}**!`,
announceChannelId null = same channel).

**Required permissions:** `SendMessages`, `ManageRoles` (for level-reward roles; rewards
granted for all levels in `(oldLevel, newLevel]` on level-up). **Required intents:** `Guilds`.

**Admin route:** **none — gap.** No admin route file and not in `placeholders.ts`.

**Caveats:**
- *Deduced:* metadata declares only the `Guilds` intent yet subscribes to `message.create`;
  the gateway intent for message events is owned by `discord-adapter` (the module uses only
  message metadata, not content) — possible under-declaration, verify against the adapter.
- *Deduced:* in-memory caches (settings 30s TTL, guildId, per-user cooldown map) are
  per-process; not multi-replica-safe and reset on restart.

---

## Admin-route coverage summary (verified gap)

`apps/admin/src/routes/index.ts` registers exactly these module plugins (plus the
`/commands` reference page in `commands.ts` and the trailing `placeholders.ts`):

1. announcements · 2. cards (dynamic-cards) · 3. welcome · 4. role-menus ·
5. scheduled-messages · 6. custom-commands · 7. birthdays · 8. automod.

Two more modules have a real admin page defined **inline in
`apps/admin/src/server.ts`** (not as a `routes/` plugin): `audio-player` (`/audio`,
`server.ts:282`) and `moderation` (`/moderation`, `server.ts:386`). So **10 of 20 modules
have a real admin page**.

**10 of 20 modules have no real admin page:**
- *Older module:* `reminders` (read-only placeholder page only, no CRUD).
- *The 9 newest modules:* `raise-hand`, `fun-commands`, `engagement-prompts`, `giveaways`,
  `server-stats`, `trivia`, `minigames`, `economy`, `levels`.

These are configured exclusively via Discord slash commands / button panels.
