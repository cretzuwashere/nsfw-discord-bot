# Commands & Events Reference

> **Scope:** complete reference for slash commands, platform events, interaction
> handlers (component customIds), gateway intents, and scheduler jobs across all
> **20 modules** of the botplatform Discord bot. Verified on disk **2026-06-27**.
>
> **Verification legend:** every row/claim below is tagged where it matters:
> `[verified-in-code]` = read directly from source this pass; `[deduced]` =
> inferred from code behaviour; `[documented-elsewhere-unverified]` = taken from
> another doc and NOT re-confirmed against source. Untagged tables are backed by
> the verified module data set plus spot-checks of the files cited.
>
> **Primary sources spot-checked this pass:**
> - `apps/bot/src/main.ts` — module wiring + scheduler registration
> - `apps/bot/src/register-commands.ts` — what actually registers with Discord
> - `packages/core/src/contracts/events.ts` — the 5 platform event shapes
> - `packages/discord-adapter/src/command-mapper.ts` — option-type mapping
> - `packages/discord-adapter/src/adapter.ts` (lines 64–85) — gateway intent set
> - `packages/database/src/seed.ts` — `defaultEnabled` per module
> - `packages/shared/src/types.ts` — `MODULE_KEYS` (the 20 keys)
> - `packages/audio-module/src/index.ts`, `packages/raise-hand-module/src/index.ts` — metadata spot-check

---

## 0. Module roster (the 20)

`MODULE_KEYS` (`packages/shared/src/types.ts`) defines exactly 20 module keys.
All 20 are wired into the kernel in `apps/bot/src/main.ts` (modules array, lines
172–193). Seed names + `defaultEnabled` from `packages/database/src/seed.ts`.

| # | Module key | Package dir | Seed name | defaultEnabled | Owns slash commands? |
|---|---|---|---|---|---|
| 1 | `audio-player` | `packages/audio-module` | Audio Player | **on** | yes |
| 2 | `moderation` | `packages/moderation-module` | Moderation | off | yes |
| 3 | `announcements` | `packages/announcements-module` | Announcements | **on** | yes |
| 4 | `welcome` | `packages/welcome-module` | Welcome / Leave | off | **NO** |
| 5 | `dynamic-cards` | `packages/cards-module` | Dynamic Cards | off | **NO** |
| 6 | `role-menus` | `packages/role-menus-module` | Reaction Roles | off | yes |
| 7 | `birthdays` | `packages/birthdays-module` | Birthdays | off | yes |
| 8 | `reminders` | `packages/reminders-module` | Reminders | off | yes |
| 9 | `scheduled-messages` | `packages/scheduled-messages-module` | Scheduled Messages | off | **NO** |
| 10 | `automod` | `packages/automod-module` | Auto-Moderation | off | **NO** |
| 11 | `custom-commands` | `packages/custom-commands-module` | Custom Commands | off | yes |
| 12 | `raise-hand` | `packages/raise-hand-module` | Speaker Queue | off | yes |
| 13 | `fun-commands` | `packages/fun-commands-module` | Fun Commands | off | yes |
| 14 | `engagement-prompts` | `packages/engagement-prompts-module` | Engagement Prompts | off | yes |
| 15 | `giveaways` | `packages/giveaways-module` | Giveaways | off | yes |
| 16 | `server-stats` | `packages/server-stats-module` | Server Stats | off | yes |
| 17 | `trivia` | `packages/trivia-module` | Trivia | off | yes |
| 18 | `minigames` | `packages/minigames-module` | Mini-games | off | yes |
| 19 | `economy` | `packages/economy-module` | Economy | off | yes |
| 20 | `levels` | `packages/levels-module` | Levels | off | yes |

**Only two modules are on by default:** `audio-player` and `announcements`
(seed.ts lines 29, 36). `[verified-in-code]`

**Four modules own NO slash commands** (event/scheduler/service-only): `welcome`,
`dynamic-cards` (cards), `scheduled-messages`, `automod`. `[verified-in-code]`

> **Important distinction — seed `defaultEnabled` vs. per-row defaults.** Module
> `defaultEnabled` (seed.ts) controls whether the *module* loads. Some modules
> have a *second* enable flag at the row level: e.g. `custom_commands.enabled`
> defaults **TRUE** per command, and `level_settings.enabled` defaults **false**
> — meaning leveling is off "twice" and an admin must run `/levelconfig
> enabled:true` even after enabling the module. `[verified-in-code]`

---

## 1. Slash command catalog (all modules)

Notes that apply to the whole table:
- **Gate** = `defaultMemberPermissions` (Discord `default_member_permissions`
  bitfield). `none` = no gate at the Discord level (any member may invoke; some
  commands then re-check server-side or are self-service/ephemeral).
- **guildOnly** = `contexts:[0]` (no DMs). Marked per command group.
- Command/option-type mapping comes from
  `packages/discord-adapter/src/command-mapper.ts`: option types supported are
  `subcommand(1) / string(3) / integer(4) / boolean(5) / user(6) / channel(7) /
  role(8)`; descriptions are truncated at 100 chars at registration time.
- **Registration:** all 16 command-owning modules' commands are concatenated and
  registered in `apps/bot/src/register-commands.ts` (run via `docker compose exec
  app pnpm discord:register-commands`). The 4 command-less modules are correctly
  absent from that file. `[verified-in-code]`

### 1.1 audio-player (`packages/audio-module`) — 12 top-level commands, all guildOnly, all gate `none`

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/join` | — | none | Join your current voice channel |
| `/leave` | — | none | Leave the voice channel |
| `/play` | — | none | Play from YouTube/SoundCloud/Spotify or a direct link (or queue it); `url` (string, req) |
| `/playlist` | — | none | Add every track from a YouTube playlist link; `url` (string, req) |
| `/queue` | — | none | Show the current queue (first 10) |
| `/skip` | — | none | Skip the current track |
| `/pause` | — | none | Pause playback |
| `/resume` | — | none | Resume paused playback |
| `/stop` | — | none | Stop playback and clear the queue (stays in channel) |
| `/nowplaying` | — | none | Show current track with a visual progress bar |
| `/controls` | — | none | Show audio player controls + live status |
| `/radio` | `list [category]`, `play <station:string,req>`, `stop`, `nowplaying` | none | Play online radio stations on the active session |

### 1.2 moderation (`packages/moderation-module`) — 12 commands, all guildOnly, every command gated

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/warn` | — | `ModerateMembers` | Warn a member; `user`(req), `reason`(req); writes a warnings row AND a warn case |
| `/warnings` | — | `ModerateMembers` | List a member's warnings; `user`(req); ephemeral |
| `/clearwarnings` | — | `ModerateMembers` | Clear active warnings (records an 'other' case; history retained); `user`(req) |
| `/timeout` | — | `ModerateMembers` | Time out a member; `user`(req), `minutes`(int req 1–40320), `reason`; protects owner |
| `/untimeout` | — | `ModerateMembers` | Remove a member's timeout; `user`(req), `reason` |
| `/kick` | — | `KickMembers` | Kick a member; `user`(req), `reason`; protects owner |
| `/ban` | — | `BanMembers` | Ban a member; `user`(req), `reason`, `delete_days`(int 0–7); protects owner |
| `/unban` | — | `BanMembers` | Unban a user by ID; `user_id`(string req), `reason` |
| `/purge` | — | `ManageMessages` | Bulk-delete recent messages; `amount`(int req 1–100); ephemeral |
| `/slowmode` | — | `ManageChannels` | Set channel slowmode; `seconds`(int req 0–21600) |
| `/lock` | — | `ManageChannels` | Lock this channel; `reason` |
| `/unlock` | — | `ManageChannels` | Unlock this channel; `reason` |

### 1.3 announcements (`packages/announcements-module`) — 1 command, guildOnly, gate `none`

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/announcement` | `list`, `preview <id>`, `send <id>`, `cancel <id>` | none | Manage server announcements. `list`=recent 10 (ephemeral); `send` defers + immediate `deliverById`; `cancel` sets status `canceled` (refuses if already sent). `id` accepts first-8-chars |

> No Discord gate — the admin panel is the primary UI.

### 1.4 role-menus (`packages/role-menus-module`) — 1 command, guildOnly, gate `none`

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/roles` | `list`, `menu <id:string,req>`, `refresh <id:string,req>`, `remove <id:string,req>` | none | List role menus; publish a menu to current channel; re-publish (delete old + re-send); disable a menu |

> **Gating caveat:** neither the command nor any subcommand sets
> `defaultMemberPermissions`. Any member can invoke `menu`/`refresh`/`remove`;
> replies are ephemeral but `publish` posts a real public message. The handler
> does NOT use `memberHasPermission` — the only access control on the published
> buttons/selects is the per-menu *constraint roles* (maxSelections /
> requiredRoleId / blockedRoleId).

### 1.5 birthdays (`packages/birthdays-module`) — 1 command, guildOnly, gate `none`

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/birthday` | `set <month:int,req> <day:int,req> [year:int] [timezone:string]`, `view`, `remove`, `upcoming` | none | Self-service opt-in: set/update; view yours; hard-delete (privacy); list upcoming (excludes `visibility=private`, max 15). All subcommands ephemeral |

### 1.6 reminders (`packages/reminders-module`) — 1 command, guildOnly, gate `none`

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/reminder` | `create <message:string,req> <when:string,req> [here:boolean] [repeat:string]`, `list`, `remove <id:string,req>` | none | `create` parses durations (`30m`/`2h`/`1d 6h`/bare-number=minutes; clamped 60s..365d; `here`=channel else DM; MAX_PER_USER=25); `list` active (max 50); `remove` by id-prefix scoped to caller. All ephemeral |

### 1.7 custom-commands (`packages/custom-commands-module`) — 1 dispatcher command, guildOnly, gate `none`

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/custom` | — | none | Run a stored custom command; `name`(string, req). Enforces `enabled`, `allowedChannelIds` allowlist, per-(command,user) in-memory cooldown; renders via `renderCustomResponse`, increments `useCount` |

> A single `/custom` dispatcher avoids dynamic slash registration; the catalog is
> managed in the admin panel. **GAP:** `allowedRoleIds` is stored but NOT enforced
> at runtime (only channel allowlist + cooldown).

### 1.8 raise-hand (`packages/raise-hand-module`) — 8 top-level commands, all guildOnly

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/raise-hand` | — | none | Join the speaking queue for your current voice channel |
| `/lower-hand` | — | none | Lower hand and leave the queue |
| `/speaker-queue` | — | none | Show the current speaking order for your VC |
| `/next-speaker` | — | `MuteMembers` | Moderator: advance the queue to the next speaker |
| `/remove-speaker` | — | `MuteMembers` | Moderator: remove a member (`user`, req) from the queue |
| `/clear-speaker-queue` | — | `MuteMembers` | Moderator: clear the entire queue for your VC |
| `/promote-speaker` | — | `MuteMembers` | Moderator: move a member (`user`, req) to the front of the queue |
| `/speaker-panel` | — | `MuteMembers` | Moderator: post the persistent speaker-queue button control panel |

> The 8 commands are intentionally NOT grouped under one parent so each can carry
> its own `default_member_permissions` (3 open + 5 gated by `MuteMembers`). The
> module never mutes anyone — `MuteMembers` is used purely to identify moderators.
> `[verified-in-code: raise-hand index.ts]`

### 1.9 fun-commands (`packages/fun-commands-module`) — 5 commands, gate `none`, **not guildOnly**

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/8ball` | — | none | Magic 8-ball; `question`(string, req) |
| `/roll` | — | none | Roll dice e.g. `1d20`/`2d6+3` (default `1d6`); `dice`(string, opt), clamped to DICE_LIMITS |
| `/flip` | — | none | Flip a coin; no options |
| `/choose` | — | none | Pick one of comma/pipe-separated options (max 20); `options`(string, req) |
| `/rps` | — | none | Rock-paper-scissors vs the bot; `move`(string, req: rock/paper/scissors) |

> The only module whose commands are **not** `guildOnly` and set no gate — fully
> stateless, in-memory per-user cooldown (default 3000ms).

### 1.10 engagement-prompts (`packages/engagement-prompts-module`) — 6 commands, all guildOnly

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/qotd` | — | none | Post a Question of the Day |
| `/wyr` | — | none | Would You Rather |
| `/neverhaveiever` | — | none | A Never Have I Ever prompt |
| `/mostlikelyto` | — | none | Who's most likely to… |
| `/truthordare` | — | none | Get a truth or a dare; `kind`(string, opt: truth/dare/random) |
| `/promptconfig` | — | `ManageGuild` | Configure the daily QOTD; `channel`(channel, req), `hour`(int 0–23 UTC, req), `enabled`(bool, req) |

### 1.11 giveaways (`packages/giveaways-module`) — 1 command, guildOnly, **whole command gated**

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/giveaway` | `start`, `end`, `reroll`, `cancel`, `list` | `ManageGuild` | Run server giveaways. `start`: `prize`(str,req), `duration`(str,req e.g. `1h`/`1d 6h`), `winners`(int 1–20 default 1), `channel`(opt, default here). `end`/`reroll`/`cancel`: `id`(str,req, 8-char short id, prefix match). `list`: none |

### 1.12 server-stats (`packages/server-stats-module`) — 3 commands, all guildOnly

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/serverstats` | — | none | Server activity stats (today + 7d totals, active members, top 5 chatters, top 3 channels) |
| `/myactivity` | — | none | Your or another member's message activity (today/week/all-time + weekly rank); `user`(user, opt, default caller) |
| `/statsconfig` | — | `ManageGuild` | Configure the weekly recap; `channel`(req), `day`(int 0–6, 0=Sun, req), `hour`(int 0–23 UTC, req), `enabled`(bool, req) |

### 1.13 trivia (`packages/trivia-module`) — 3 commands, all guildOnly

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/trivia` | — | none | Start a trivia round in the current channel |
| `/trivia-leaderboard` | — | none | Show the trivia win leaderboard (top 10) |
| `/triviaconfig` | — | `ManageGuild` | Configure auto-trivia; `channel`(req), `interval`(int min, req, clamped 5..10080), `enabled`(bool, req) |

### 1.14 minigames (`packages/minigames-module`) — 2 commands, all guildOnly

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/tictactoe` | — | none | Challenge a user to Tic-Tac-Toe; `opponent`(user, req) |
| `/connect4` | — | none | Challenge a user to Connect Four; `opponent`(user, req) |

### 1.15 economy (`packages/economy-module`) — 8 commands, all guildOnly

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/balance` | — | none | Check a balance; `user`(opt, default self) |
| `/give` | — | none | Transfer currency; `user`(req), `amount`(int, req); atomic |
| `/daily` | — | none | Claim daily reward (UTC-day + streak via `computeDaily`) |
| `/baltop` | — | none | Paginated richest members |
| `/shop` | — | none | Browse paginated active shop items |
| `/buy` | — | none | Buy a shop item by short id; `item`(req); grants role, refunds on grant failure |
| `/economy` | `grant`, `take`, `config` | `ManageGuild` | Admin: grant/take currency; config name/emoji/starting/daily/bonus/cap (partial patch) |
| `/shopadmin` | `add`, `remove` | `ManageGuild` | Manage shop catalog: `add` (role req, price req, label opt) / `remove` (item req) |

### 1.16 levels (`packages/levels-module`) — 5 commands, all guildOnly

| Command | Subcommands | Gate | Description |
|---|---|---|---|
| `/rank` | — | none | Show level, XP progress bar and rank #; `user`(opt, default self) |
| `/levels` | — | none | Paginated XP leaderboard |
| `/levelconfig` | — | `ManageGuild` | Configure leveling (partial patch): enabled, channel, message(`{user}`/`{level}`), xp_min, xp_max, cooldown |
| `/levelnoxp` | — | `ManageGuild` | Toggle a channel in/out of the no-XP list; `channel`(req), `add`(bool req) |
| `/levelrewards` | `add`, `remove`, `list` | `ManageGuild` | Manage level-reward roles: `add` (level+role req) / `remove` (level req) / `list` |

### 1.17 Modules that own NO slash commands

| Module | Why no commands | Configured / driven by |
|---|---|---|
| `welcome` | Fully event-driven | member.join / member.leave events + admin panel |
| `dynamic-cards` (cards) | Pure rendering service | Consumed by welcome (renderCard bridge, main.ts:80) + admin preview |
| `scheduled-messages` | Scheduler-only | Scheduler tick + admin panel |
| `automod` | Event-only | message.create + admin panel |

---

## 2. Platform events (5) and subscribers

The platform exposes exactly **5** adapter-neutral events
(`packages/core/src/contracts/events.ts`, `PlatformEvent` union). The Discord
adapter translates gateway events into these; modules subscribe via
`BotModule.events`. `[verified-in-code]`

| Event | Payload highlights | Subscribing modules |
|---|---|---|
| `member.join` | guild ref, user ref, memberCount | **welcome** |
| `member.leave` | guild ref, user ref, memberCount | **welcome** |
| `message.create` | guild ref (nullable), channelId, author, `content` (empty unless MessageContent intent), mentionCount, hasAttachments, authorRoleIds | **automod**, **server-stats**, **levels** |
| `component.interaction` | customId, values[], user, userRoleIds, `reply()`, optional `update()` | **audio-player**, **role-menus**, **raise-hand**, **engagement-prompts**, **giveaways**, **trivia**, **minigames**, **economy**, **levels** |
| `voice.state.update` | guild ref, user ref, oldChannelId, newChannelId | **raise-hand** |

Notes:
- `voice.state.update` is the newest event; it rides the **already-enabled
  non-privileged** `GuildVoiceStates` intent (NOT privileged). Mute/deafen-only
  changes keep old/new channel ids equal. `[verified-in-code: events.ts:80–94]`
- `component.interaction.update?()` is optional; adapters that can't edit the
  carrying message in place omit it. `[verified-in-code: events.ts:71–78]`
- `message.create.content` is the empty string when the **MessageContent**
  privileged intent is not granted (events.ts:49). server-stats and levels are
  **count-based** and work without content; automod's content rules degrade.
- **levels** subscribes to BOTH `message.create` (award XP) and
  `component.interaction` (leaderboard paging).
- **DEDUCED caveat (levels):** the levels module's metadata declares only the
  `Guilds` intent yet it subscribes to `message.create`. The gateway intent for
  message events (`GuildMessages`) is owned by the adapter's base set, so this is
  a possible metadata under-declaration, not a runtime bug. `[deduced]`

### 2.1 Event → module subscription matrix

| Module | member.join | member.leave | message.create | component.interaction | voice.state.update |
|---|---|---|---|---|---|
| audio-player | | | | ✅ | |
| moderation | | | | | |
| announcements | | | | | |
| welcome | ✅ | ✅ | | | |
| dynamic-cards | | | | | |
| role-menus | | | | ✅ | |
| birthdays | | | | | |
| reminders | | | | | |
| scheduled-messages | | | | | |
| automod | | | ✅ | | |
| custom-commands | | | | | |
| raise-hand | | | | ✅ | ✅ |
| fun-commands | | | | | |
| engagement-prompts | | | | ✅ | |
| giveaways | | | | ✅ | |
| server-stats | | | ✅ | | |
| trivia | | | | ✅ | |
| minigames | | | | ✅ | |
| economy | | | | ✅ | |
| levels | | | ✅ | ✅ | |

Modules subscribing to **no** events: moderation, announcements, dynamic-cards,
birthdays, reminders, scheduled-messages, custom-commands, fun-commands. (Of
these, announcements/birthdays/reminders/scheduled-messages are scheduler-driven;
moderation/custom-commands/fun-commands are command-driven; dynamic-cards is a
service.) `[verified-in-code via module data]`

---

## 3. Interaction handlers — customId patterns per module

All component interactions arrive as a single `component.interaction` event; each
module's handler inspects `customId` and **ignores ids it doesn't own**. Prefixes
are the de-facto routing namespace.

| Module | customId pattern(s) | Behaviour |
|---|---|---|
| audio-player | `audio:pause\|resume\|skip\|stop\|leave\|refresh` (prefix `audio:`, `AUDIO_BUTTON_PREFIX`) | Performs action via PlayerManager, then edits the now-playing panel in place (`event.update`) or replies |
| audio-player | `radio:select` select-menu (`RADIO_SELECT_ID`, prefix `radio:`) | Plays chosen station on the ACTIVE session; if bot not connected, instructs the user to run `/radio play` |
| role-menus | Button `rolemenu:<menuId>:<roleId>` | Toggles/sets a single role per menu mode |
| role-menus | Select `rolemenu:<menuId>` | `values` = full desired set; `computeRoleChanges` honours mode (add_only/remove_only/single/unique/multiple\|toggle) + constraints; calls `addRole`/`removeRole`; logs to `role_assignment_logs`. Rejects non-`rolemenu:` ids |
| raise-hand | `rh:<action>:<voiceChannelId>` actions `raise\|lower\|show\|next\|clear` (panel = 5 buttons) | `MODERATOR_ACTIONS={next,clear}` re-checked server-side via `isModerator()` = guild owner OR `memberHasPermission(user,'MuteMembers')`; non-mods get a refusal |
| engagement-prompts | `prompt:another:<category>` | Re-pick a non-recent prompt for the category and `event.update()` in place (falls back to `reply`). Unknown category/no guild → "no longer available" |
| giveaways | `giveaway:enter:<giveawayId>` | Add a unique entry (dedup via unique index); replies entered / already entered / ended |
| trivia | `trivia:ans:<roundId>:<choiceIndex>` | Record one answer per user/round (unique-index); atomic first-correct claim via `resolveIfOpen`; reveal answer + increment `trivia_scores.wins` for winner |
| minigames | `mg:accept:<id>` / `mg:decline:<id>` | Only the challenged player (playerO) may respond; set status active or finished |
| minigames | `mg:ttt:<id>:<cell 0-8>` | Tic-Tac-Toe move (turn-gated, validates square free) |
| minigames | `mg:c4:<id>:<col 0-6>` | Connect Four move (validates column not full); win/draw detection |
| economy | `eco:baltop:<page>` | Re-render richest-members page (PAGE_SIZE=10) |
| economy | `eco:shop:<page>` | Re-render shop page (Prev/Next) |
| levels | `lvl:lb:<page>` | Re-render XP leaderboard page (Prev/Next; PAGE_SIZE=10) |

> **audio-player wiring detail:** the module registers ONE
> `component.interaction` subscription whose handler fans out to BOTH the audio
> button handler and the radio select handler; each ignores customIds it doesn't
> own (`packages/audio-module/src/index.ts:90–98`). `[verified-in-code]`

> **Server-side per-member gating** (`GuildService.memberHasPermission`) is used
> by **raise-hand** panel buttons only — Discord's `default_member_permissions`
> does not apply to component clicks, so moderator buttons re-check at runtime.

> Modules with NO interaction handlers: moderation, announcements, welcome,
> dynamic-cards, birthdays, reminders, scheduled-messages, automod,
> custom-commands, fun-commands, server-stats. (Note: announcements renders
> button JSON via the `announcements.buttons` jsonb column but has **no**
> interaction handler — those buttons are decorative from the bot's side.)

---

## 4. Gateway intents

Declared in `packages/discord-adapter/src/adapter.ts` (lines 73–84). The adapter
requests a fixed **non-privileged base set** plus up to two **privileged**
intents gated behind config flags. `[verified-in-code]`

### 4.1 Base non-privileged set (always requested)

| Intent | Enables | Used by |
|---|---|---|
| `Guilds` | Core guild/channel/role/interaction lifecycle, slash commands, component interactions | All modules |
| `GuildVoiceStates` | `voice.state.update` event; voice-channel membership | audio-player, raise-hand |
| `GuildMessages` | `message.create` delivery (metadata only without MessageContent) | automod, server-stats, levels |
| `GuildModeration` | Ban/audit gateway events | moderation |

These four require **zero portal toggles** — the default audio bot connects with
no privileged intents at all. `[verified-in-code: adapter.ts:64–78]`

### 4.2 Privileged flags (opt-in; must be enabled in the Discord developer portal AND via env)

| Config flag | Env var | Intent added | If OFF (default) — what breaks |
|---|---|---|---|
| `discord.enableGuildMembers` | `DISCORD_ENABLE_GUILD_MEMBERS` | `GuildMembers` | `member.join` / `member.leave` events do not fire → **welcome** messages, leave messages, auto-roles, and any member-on-join behaviour are silent |
| `discord.enableMessageContent` | `DISCORD_ENABLE_MESSAGE_CONTENT` | `MessageContent` | `message.create.content` is empty → **automod** content rules (banned_words, links, caps, etc.) silently DEGRADE (module logs a DEGRADED warning at load and still loads); count-based modules (server-stats, levels) are unaffected |

> **Hard failure mode:** requesting a privileged intent here that is NOT enabled
> in the portal makes the gateway reject the connection with close code **4014
> "Disallowed intents"** — the bot won't connect at all. Enable the flag only
> after enabling the matching intent in the portal. `[verified-in-code: adapter.ts:64–70]`

> The `GuildMembers` opt-in flag corresponds to commit `4ee8b66` (gate the
> privileged GuildMembers intent behind an opt-in flag). `[deduced from git log + config]`

### 4.3 Module-declared `requiredIntents` (metadata) vs. adapter reality

Modules declare `metadata.requiredIntents` for documentation/admin display, but
the **actual** gateway intents are owned solely by the adapter's set above. Notable
declarations:
- `welcome` → `['GuildMembers']` (privileged) `[verified-in-code: welcome index.ts:48]`
- `automod` → `['Guilds','GuildMessages','MessageContent']` `[verified-in-code: automod index.ts:177]`
- `raise-hand` → `['Guilds','GuildVoiceStates']` `[verified-in-code: raise-hand index.ts:53]`
- **audio-player declares NO metadata block at all** → its `requiredIntents` and
  `requiredPermissions` are **undefined** (gap for admin-panel display).
  `[verified-in-code: audio index.ts — no metadata key]`
- `levels` declares only `['Guilds']` despite needing message delivery — see the
  DEDUCED caveat in §2. `[deduced]`

---

## 5. Scheduler jobs

Modules contribute jobs that `apps/bot/src/main.ts` registers with
`kernel.scheduler` (lines 204–212). Jobs that aren't registered there never run.
`[verified-in-code]`

| Job id | Module | Interval | What it does | Registered (main.ts) |
|---|---|---|---|---|
| `announcements.deliver-due` | announcements | 30 s (`DELIVERY_TICK_MS`) | `service.deliverDue(now)` delivers due/scheduled announcements | line 204 |
| `scheduled-messages.deliver-due` | scheduled-messages | 30 s (`TICK_MS`) | Drains ≤50 due rows; advances next-run; one-offs paused; failures 5 min backoff | line 205 |
| `reminders.deliver-due` | reminders | 30 s (`TICK_MS`) | Channel or DM delivery; recurring reschedule, one-offs deactivate; offline → retry | line 206 |
| `birthdays.announce` | birthdays | 5 min (`TICK_MS`) | Per-announce-hour UTC gate + per-(guild,user,date) dedup; sends then records; optional role | line 207 |
| `engagement-prompts.daily-qotd` | engagement-prompts | 5 min | Posts QOTD where `isQotdDue`; advances `lastQotdDate` even on send failure | line 208 |
| `giveaways.draw-due` | giveaways | 30 s | Finds active giveaways past `ends_at`, draws unique winners (Fisher-Yates), edits message + congrats | line 209 |
| `server-stats.flush` | server-stats | 60 s | Drains in-memory `ActivityAccumulator` into batched per-day upserts (skips if empty) | line 210 (loop) |
| `server-stats.weekly-recap` | server-stats | 5 min | Posts "Weekly Highlights" where `isRecapDue`; advances `last_recap_date` even on failure | line 210 (loop) |
| `trivia.resolve-expired` | trivia | 30 s | Reveal rounds open past 45 s (`ROUND_TIMEOUT_SEC`); edit to time's-up | line 211 (loop) |
| `trivia.auto` | trivia | 60 s | Start auto-trivia where `isAutoDue` and no open round | line 211 (loop) |
| `minigames.expire-stale` | minigames | 60 s | Expire pending >5 min, active idle >15 min; edit message to Expired | line 212 |

**Registration shapes** (`[verified-in-code]`):
- Single-job modules expose `handle.schedulerJob` (announcements, scheduled-messages,
  reminders, birthdays, engagement-prompts, giveaways, minigames).
- Multi-job modules expose `handle.schedulerJobs[]` registered via a `for` loop
  (server-stats = 2 jobs, line 210; trivia = 2 jobs, line 211).

Modules with **NO** scheduler jobs (11): audio-player, moderation, welcome,
dynamic-cards, role-menus, automod, custom-commands, raise-hand, fun-commands,
economy, levels.

> **welcome is NOT a scheduler module** despite its delayed-message feature: the
> delay uses an in-process `setTimeout(delaySeconds*1000).unref()`, not the kernel
> scheduler. Auto-roles fire immediately on join (independent of the delay and of
> the welcome-message toggle). `[verified-in-code via module data + commit 695be76]`

---

## 6. Module → commands / events / scheduler matrix

`C` = owns ≥1 slash command · `E` = subscribes ≥1 platform event ·
`I` = handles ≥1 component interaction · `S` = ≥1 scheduler job · `—` = none.

| Module | Commands | Events | Interactions | Scheduler | Admin route |
|---|---|---|---|---|---|
| audio-player | C (12) | E | I | — | **real** (inline `/audio`, server.ts:282) |
| moderation | C (12) | — | — | — | **real** (inline `/moderation`, server.ts:386) |
| announcements | C (1) | — | — | S (1) | **real** (announcements.ts) |
| welcome | — | E | — | — | **real** (welcome.ts) |
| dynamic-cards | — | — | — | — | **real** (cards.ts) |
| role-menus | C (1) | E | I | — | **real** (role-menus.ts) |
| birthdays | C (1) | — | — | S (1) | **real** (birthdays.ts) |
| reminders | C (1) | — | — | S (1) | **placeholder-only, no CRUD (GAP)** |
| scheduled-messages | — | — | — | S (1) | **real** (scheduled-messages.ts) |
| automod | — | E | — | — | **real** (automod.ts) |
| custom-commands | C (1) | — | — | — | **real** (custom-commands.ts) |
| raise-hand | C (8) | E | I | — | none (GAP) |
| fun-commands | C (5) | — | — | — | none |
| engagement-prompts | C (6) | E | I | S (1) | none |
| giveaways | C (1) | E | I | S (1) | none |
| server-stats | C (3) | E | — | S (2) | none |
| trivia | C (3) | E | I | S (2) | none |
| minigames | C (2) | E | I | S (1) | none |
| economy | C (8) | E | I | — | none |
| levels | C (5) | E (×2) | I | — | none |

### 6.1 Admin-route coverage gap (verified)

`apps/admin/src/routes/index.ts` registers exactly **9 real** route plugins +
1 placeholder (which "MUST stay last and only covers paths no real module owns
yet"): `announcements, cards, welcome, role-menus, scheduled-messages,
custom-commands, birthdays, automod, commands`. `[verified-in-code:
routes/index.ts:18–29]`

Modules with **NO dedicated `routes/` admin plugin**: `audio-player`,
`moderation`, `reminders`, `raise-hand`, `fun-commands`, `engagement-prompts`,
`giveaways`, `server-stats`, `trivia`, `minigames`, `economy`, `levels`.

**However, two of those still have a real admin page defined inline in
`apps/admin/src/server.ts`** (not as a `routes/` plugin): `audio-player`
(`GET /audio`, `server.ts:282`) and `moderation` (`GET /moderation`,
`server.ts:386`). So the modules with **no real admin page at all** are
`reminders` plus the 9 newest (raise-hand → levels) — **10 modules** (matches
`architecture.md` §7.2 and `modules.md`). The `reminders` gap is the most notable
because the `reminders` table has a `createdByAdmin` column with no panel to reach
it — the placeholder plugin serves only a static, read-only `/reminders` info page
(and `/permissions`) with NO CRUD (`apps/admin/src/routes/placeholders.ts:8–11`);
the 9 newest modules have no admin presence at all (not in `PLACEHOLDER_PAGES`).
`[verified-in-code]`

---

## 7. Cross-cutting notes & GAPS (verified)

- **Registration parity:** `register-commands.ts` imports all **16**
  command-owning modules; the 4 command-less modules (welcome, cards,
  scheduled-messages, automod) are correctly absent. No command-owning module is
  missing from registration. `[verified-in-code]`
- **audio-player metadata gap:** no `metadata` block → `requiredPermissions` /
  `requiredIntents` undefined (admin panel can't display them). `[verified-in-code]`
- **automod non-functional rule types:** `repeated_messages` and `raid` are
  declared rule types but `matchesRule` returns NO_MATCH (stubs). `[verified-in-code via module data]`
- **custom-commands `allowedRoleIds`** stored but not enforced at runtime. `[verified-in-code via module data]`
- **birthdays `cardTemplateId` / `roleDurationHours`** stored but the scheduler
  neither renders a card nor auto-removes the role. `[deduced]`
- **reminders `timezone`** column stored but unused by delivery (absolute
  `dueAt`). `[deduced]`
- **In-memory state is per-process** (not multi-replica-safe; lost on restart):
  automod spam window, custom-commands & fun-commands & engagement-prompts
  cooldowns, levels caches/cooldown, server-stats accumulator. `[verified-in-code via module data]`

---

## 8. Quick command reference (run inside Docker)

```bash
# Register every module's slash commands with Discord (guild-scoped = instant).
docker compose exec app pnpm discord:register-commands
```

```bash
# Re-seed built-in modules (idempotent; sets defaultEnabled per seed.ts).
docker compose exec app pnpm db:seed
```

Secrets such as `<DISCORD_BOT_TOKEN>`, `<DISCORD_CLIENT_ID>` and
`<DISCORD_GUILD_ID>` live in `.env` and are never printed here.
