# Modules — Group 1 (audio-player, moderation, announcements, welcome)

> Verified-in-code on 2026-06-27 against `packages/*/src`, `packages/database/src/{schema.ts,seed.ts}`,
> `apps/bot/src/main.ts` and `apps/admin/src/routes/index.ts`.
> Legend: **[V]** verified-in-code · **[D]** deduced · **[U]** documented-elsewhere-unverified.

All four modules are wired in `apps/bot/src/main.ts` (kernel `modules` array). Slash command
contracts live in `packages/core/src/contracts/commands.ts`; platform events in
`packages/core/src/contracts/events.ts`; module metadata shape in
`packages/core/src/contracts/module.ts` (`requiredPermissions`, `requiredIntents`, `configSchema`,
`auditEvents`).

---

## 1. audio-player (`audio-module`)  — key `audio-player`

- Factory: `packages/audio-module/src/index.ts` → `createAudioModule(...)`.
- Seed (`seed.ts`): name **"Audio Player"**, `defaultEnabled: **true**` (one of only two modules on by default). **[V]**

### Slash commands **[V]**
Flat audio commands (`commands.ts` `buildAudioCommands`), all `guildOnly: true`, **no `defaultMemberPermissions`** (gate = "none") on any of them:

| Command | Options | Notes |
|---|---|---|
| `/join` | – | join caller's voice channel |
| `/leave` | – | disconnect |
| `/play` | `url` (string, req) | YouTube/SoundCloud/Spotify/direct link; pure playlist links auto-expand |
| `/playlist` | `url` (string, req) | expand a whole YouTube playlist |
| `/queue` | – | show queue (first 10) |
| `/skip` | – | |
| `/pause` | – | |
| `/resume` | – | |
| `/stop` | – | stop + clear queue, stay connected |
| `/nowplaying` | – | visual progress panel |
| `/controls` | – | control panel / cheat-sheet |

Plus the radio command (`radio/commands.ts` `buildRadioCommand`), `guildOnly: true`, **gate "none"**, with subcommands:
`/radio list [category]`, `/radio play <station>`, `/radio stop`, `/radio nowplaying`.

### Events **[V]**
One subscription: `component.interaction`. The single handler fans out to BOTH the audio button handler and the radio select handler; each ignores customIds it does not own.

### Interaction handlers (customId patterns) **[V]**
- `audio:` prefix (`now-playing.ts`, `AUDIO_BUTTON_PREFIX = 'audio:'`). Controls: `audio:pause`, `audio:resume`, `audio:skip`, `audio:stop`, `audio:leave`, `audio:refresh`. After acting, edits the now-playing panel in place (`event.update`) or replies.
- `radio:` prefix. Select menu `radio:select` (`RADIO_SELECT_ID`); plays the chosen station on the guild's ACTIVE session (components carry no voice capability — bot must already be connected, else it guides the user to `/radio play`).

### Scheduler jobs **[V]**
None. (Audio module is NOT registered with `kernel.scheduler` in `main.ts`.)

### DB tables **[V]**
Via `createPlaybackRepo` (`repositories/playback.ts`): `playback_history`, `queue_items`. (Per-guild audio overrides live in `guild_settings.{allowedAudioDomains,maxQueueSize,maxTrackDurationSeconds}` but the module package itself only touches the two playback tables; persistence is optional — `playback: null` disables it.)

### Metadata **[V]**
**The module sets NO `metadata` block** in `index.ts` — so `requiredPermissions` and `requiredIntents` are UNDECLARED (`undefined`). (Functionally it needs `Connect`/`Speak` + the `GuildVoiceStates` intent, but that is not declared in code.) **GAP.**

### Admin route **[V]**
**none/placeholder** — not in `apps/admin/src/routes/index.ts`. Audio is controlled through the bot's internal API (`audioHandle` → `buildInternalApi`), not a dedicated admin route plugin.

### Caveats
- Streaming sources (yt-dlp) are gated behind `config.audio.enableStreamingSources`; on load it warns if yt-dlp is unavailable. **[V]**
- Rich panels require `ctx.replyRich`/`event.update`; there are plain-text fallbacks. **[V]**

---

## 2. moderation (`moderation-module`) — key `moderation`

- Factory: `packages/moderation-module/src/index.ts` → `createModerationModule(...)`.
- Seed: name **"Moderation"**, `defaultEnabled: **false**`. **[V]**
- Commands are only built when `db` AND `guildServiceProvider` AND services AND cases are all present (`main.ts` passes all). **[V]**

### Slash commands **[V]**
All flat (no subcommands), all `guildOnly: true`, each with a `defaultMemberPermissions` gate:

| Command | Gate (`defaultMemberPermissions`) | Options |
|---|---|---|
| `/warn` | `ModerateMembers` | `user` (req), `reason` (req) |
| `/warnings` | `ModerateMembers` | `user` (req) |
| `/clearwarnings` | `ModerateMembers` | `user` (req) — records a clear action; history retained |
| `/timeout` | `ModerateMembers` | `user` (req), `minutes` (int req, clamped 1–40320), `reason` |
| `/untimeout` | `ModerateMembers` | `user` (req), `reason` |
| `/kick` | `KickMembers` | `user` (req), `reason` |
| `/ban` | `BanMembers` | `user` (req), `reason`, `delete_days` (int 0–7) |
| `/unban` | `BanMembers` | `user_id` (string req), `reason` |
| `/purge` | `ManageMessages` | `amount` (int req, 1–100) |
| `/slowmode` | `ManageChannels` | `seconds` (int req, 0–21600) |
| `/lock` | `ManageChannels` | `reason` |
| `/unlock` | `ManageChannels` | `reason` |

Shared `runAction` scaffolding: optional owner protection (`protectOwner`), records a numbered moderation case, optional best-effort DM-on-action and mod-log message (from `moderation_settings`), audit record `moderation.<actionType>`.

### Events **[V]**
None.

### Interaction handlers **[V]**
None.

### Scheduler jobs **[V]**
None.

### DB tables **[V]**
Via `createModerationRepo` + `createModerationCasesRepo` + `createPermissionsRepo`: `moderation_cases`, `moderation_settings`, `warnings`, `moderation_actions`, `moderation_rules`, `permission_mappings`. (Cases/settings are the primary path used by `commands.ts`; the other repos back the exported services.)

### Metadata **[V]**
- `requiredPermissions`: `ModerateMembers`, `KickMembers`, `BanMembers`, `ManageMessages`, `ManageChannels`.
- `requiredIntents`: `Guilds`, `GuildModeration`.
- `auditEvents`: `moderation.warn`, `moderation.mute`, `moderation.kick`, `moderation.ban`, `moderation.purge`.

### Admin route **[V]**
**none/placeholder** — not registered in `apps/admin/src/routes/index.ts` (covered only by the trailing placeholder plugin). **GAP** (despite rich DB schema + services).

### Caveats
- `/warn` writes BOTH a `warnings` row (via `WarningService`) AND a `warn` moderation case. **[V]**
- `/clearwarnings` does NOT delete warnings; it only records an `other` case (foundation). **[V]**

---

## 3. announcements (`announcements-module`) — key `announcements`

- Factory: `packages/announcements-module/src/index.ts` → `createAnnouncementsModule(...)`.
- Seed: name **"Announcements"**, `defaultEnabled: **true**`. **[V]**

### Slash commands **[V]**
One parent command `/announcement`, `guildOnly: true`, **gate "none"** (no `defaultMemberPermissions`; the admin panel is the primary UI). Subcommands:
- `/announcement list` — recent (10), ephemeral.
- `/announcement preview <id>` — id, first-8-chars ok, ephemeral.
- `/announcement send <id>` — defers, delivers immediately via `service.deliverById`.
- `/announcement cancel <id>` — sets status `canceled` (refuses if already `sent`).

### Events **[V]**
None.

### Interaction handlers **[V]**
None. (Announcement messages MAY carry buttons — `announcements.buttons` jsonb — but the module declares no `component.interaction` handler.)

### Scheduler jobs **[V]**
One: name **`announcements.deliver-due`**, interval **30000 ms** (`DELIVERY_TICK_MS`). Registered in `main.ts` via `kernel.scheduler.register(announcementsHandle.schedulerJob)`. Calls `service.deliverDue(now)` (sends due scheduled announcements; the admin app has no Discord connection).

### DB tables **[V]**
Via `createAnnouncementRepo`: `announcements`. (Optional `card_template_id` references `card_templates` owned by the cards module.)

### Metadata **[V]**
- `requiredPermissions`: `SendMessages`, `EmbedLinks`.
- `requiredIntents`: `Guilds`.
- `auditEvents`: `announcement.sent`, `announcement.failed`, `announcement.created`.
- `configSchema`: one field `defaultChannelId` (type `channel`, label "Default channel").

### Admin route **[V]**
`apps/admin/src/routes/announcements.ts` (`registerAnnouncementRoutes`, registered first in `index.ts`). GET `/announcements`, plus create/edit/schedule POSTs. "Send now" schedules for immediate delivery (worker delivers within ~30s).

---

## 4. welcome (`welcome-module`) — key `welcome`

- Factory: `packages/welcome-module/src/index.ts` → `createWelcomeModule(...)`.
- Seed: name **"Welcome / Leave"**, `defaultEnabled: **false**`. **[V]**
- Bridged to the cards module in `main.ts`: `renderCard: (id, data) => cardsHandle.service.renderById(id, data)`. **[V]**

### Slash commands **[V]**
**None** (`commands: []`). Fully event-driven; configured via the admin panel.

### Events **[V]**
- `member.join` → `service.handleJoin`.
- `member.leave` → `service.handleLeave`.

### Interaction handlers **[V]**
None.

### Scheduler jobs **[V]**
None registered. (Delayed welcome messages use an in-process `setTimeout(... delaySeconds*1000)` with `unref()`, NOT the kernel scheduler.) **[V]**

### DB tables **[V]**
Via `createWelcomeRepo`: `welcome_settings`. (Optional card render uses `card_templates` from the cards module.)

### Metadata **[V]**
- `requiredPermissions`: `SendMessages`, `ManageRoles`, `AttachFiles`.
- `requiredIntents`: `GuildMembers` (privileged — see caveat).
- `auditEvents`: `welcome.sent`, `welcome.leave`, `welcome.autorole`.

### Admin route **[V]**
`apps/admin/src/routes/welcome.ts` (`registerWelcomeRoutes`, in `index.ts`). GET `/welcome`, POST `/welcome/save`. Reads card templates for the welcome-card dropdown.

### Behaviour / caveats **[V]**
- **Auto-roles fire on EVERY join, independent of the welcome-message toggle and immediately (not subject to `delaySeconds`)** — matches recent commit `695be76`. Per-role failures are logged and don't break the join; emits a single `welcome.autorole` audit when ≥1 role assigned.
- Welcome message/card/DM are gated on `welcomeEnabled`; the service is re-resolved at send time so a delayed message survives a brief disconnect.
- Join dedup: in-memory `recentJoins` map, 60s TTL (`DEDUP_TTL_MS`).
- DM failures are best-effort (user may block DMs).
- Requires the **privileged `GuildMembers` intent** for join/leave; recall the platform gates that intent behind an opt-in flag (commit `4ee8b66`) — so welcome events only fire when that intent is enabled. **[D]**

---

## Cross-cutting notes

- **Default-enabled modules in this group:** only `audio-player` and `announcements` (`true`); `moderation` and `welcome` are `false`. **[V]**
- **Admin-route gaps:** `audio-player` and `moderation` have NO dedicated admin route (only the trailing placeholder plugin). Confirms the brief's "newest 9 + others missing routes" observation extends to two of the OLDER modules too. **[V]**
- **Metadata gap:** `audio-player` declares no `metadata` at all (no `requiredPermissions`/`requiredIntents`). **[V]**

## Checkpoint

Status: PASS

### Validat
- Slash commands, options, subcommands and `defaultMemberPermissions` gates for all 4 modules (read from each `commands.ts`).
- Platform event subscriptions (welcome join/leave; audio component.interaction).
- Interaction customId patterns: `audio:*`, `radio:select`/`radio:*`.
- Scheduler job: `announcements.deliver-due` @ 30000ms (only scheduler job in this group); confirmed audio/moderation/welcome register none.
- DB tables per module (cross-checked `schema.ts` + each repo).
- `metadata.requiredPermissions`/`requiredIntents`/`auditEvents` (read from each `index.ts`).
- Admin routes (cross-checked `apps/admin/src/routes/index.ts`): announcements ✔, welcome ✔, audio ✘, moderation ✘.
- `defaultEnabled` per module from `seed.ts`.

### Nevalidat
- Exact runtime behaviour of yt-dlp streaming (depends on container image / config at runtime).
- Whether `GuildMembers` intent is actually enabled in a given deployment (env-driven).

### Probleme
- `audio-module` ships no `metadata` block — admin panel cannot show its required permissions/intents.
- `audio-player` and `moderation` lack dedicated admin routes despite full feature sets.

### Următorul agent poate continua?
Yes. Pattern for the remaining 16 modules: read `<pkg>/src/index.ts` (factory + `BotModule` metadata + events), `commands.ts` (commands/subcommands/gates), service/handler files (customId patterns, scheduler jobs), then cross-check `schema.ts`, `seed.ts` and `apps/admin/src/routes/index.ts`.
