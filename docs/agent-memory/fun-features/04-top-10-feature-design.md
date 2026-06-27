# 04 — TOP 10 Feature Design

> Agent: **AGENT 4 — TOP 10 FEATURE DESIGN** · Date: 2026-06-27
> Canonical design for all 10 features (per-feature spec sheets in
> `docs/fun-features/features/feature-01..10.md` mirror this). Designed against the
> verified module pattern, contracts, scheduler, and Drizzle conventions.

## New modules (8 modules → 10 features)

| Order | Feature | Module key | New tables |
|---:|---|---|---|
| 1 | Random Fun Commands | `fun-commands` | (none) |
| 2 | Engagement Prompts | `engagement-prompts` | prompt_settings |
| 3 | Giveaways | `giveaways` | giveaways, giveaway_entries |
| 4 | Server Stats | `server-stats` | activity_user_daily, activity_channel_daily, serverstats_settings |
| 5 | Trivia | `trivia` | trivia_rounds, trivia_answers, trivia_scores |
| 6 | Mini-games | `minigames` | minigame_sessions |
| 7 | Economy core | `economy` | economy_accounts, economy_transactions, economy_settings |
| 8 | Daily/Streak | `economy` | (+columns on economy_accounts) |
| 9 | Shop | `economy` | shop_items, shop_purchases |
| 10 | Levels | `levels` | level_members, level_rewards, level_settings |

New `MODULE_KEYS`: `funCommands, engagementPrompts, giveaways, serverStats, trivia, minigames, economy, levels`.

## Shared design rules (apply to every feature)

- **Module shape:** `create<Name>Module(opts) → { module, repo?, schedulerJob? }`, copy the announcements/reminders modules.
- **Guild resolution:** `guilds.upsertByExternalId({adapterKey:'discord', externalId: ctx.guildId})` → internal `guildId` uuid; members keyed by `userExternalId` text (birthdays/reminders convention).
- **Interactions:** buttons/selects only, routed by `customId` prefix (`<feature>:...`); use `event.reply()` (ephemeral) + `event.update()`.
- **Mass-mention safety:** always pass `allowMentions` (default no @everyone/role).
- **Errors:** throw `UserFacingError` for user-visible failures; `truncate()` all echoed text.
- **Anti-spam:** per-user cooldowns (in-memory for stateless, DB timestamp for XP/daily); output caps; farming guards on XP/economy; unique indexes for one-per-user entries.
- **Admin:** every module appears on `/modules` (enable/disable) via its seed row; mutating admin commands gated by Discord `ManageGuild`/`ManageRoles`.
- **Validation gate (per feature):** typecheck + lint clean, `db:generate`+`db:migrate` clean, new unit tests + all prior green, register-commands collects new commands.

---

## Feature 01 — Random Fun Commands  (module `fun-commands`)

**Scope.** Instant, no-state RNG fun commands: magic 8-ball, dice roller, coin flip, random chooser, and rock-paper-scissors vs the bot. Zero persistence — the de-risking first build that exercises the whole new-module pipeline.

**Commands.**
- `/8ball question:string` — random magic-8-ball answer (question echoed, truncated).
- `/roll notation:string?` — dice notation `NdM(+/-K)`, default `1d6`; clamps N≤100, M 2..1000; shows rolls + total.
- `/flip` — heads or tails.
- `/choose options:string` — pick one from a comma/`|`-separated list (≤20 items).
- `/rps move:string` — rock/paper/scissors vs bot; reports win/lose/draw.

**Interactions.** None (no buttons/selects).

**Data.** None. No tables, no migration.

**Permissions.** None beyond default slash usage + `SendMessages`. Not guild-gated (works in DMs too).

**Cooldown / anti-spam.** Per-user in-memory cooldown (~3s) keyed by `userId:command` to stop spam. Output caps: question/choose items truncated; dice/choose counts clamped. Pure logic takes an injectable `rng` for deterministic tests.

**Key edge cases.** Empty `/8ball` question → still answers (question optional in effect).; `/choose` with <2 items → friendly error.; Invalid dice notation → friendly error with example.; Oversized dice (e.g. 9999d9999) → clamped, noted in reply.; `/rps` invalid move → friendly error listing valid moves.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove the module from `apps/bot/src/main.ts` + `register-commands.ts`, the `MODULE_KEYS` entry, and the seed row. No migration to revert. Or disable via the admin `/modules` page.

---

## Feature 02 — Engagement Prompts (QOTD / WYR / Party Games)  (module `engagement-prompts`)

**Scope.** Rotating conversation prompts from bundled banks — Question of the Day, Would-You-Rather, Truth-or-Dare, Never-Have-I-Ever, Most-Likely-To — on demand and as an optional daily auto-post, with an 'Ask another' button.

**Commands.**
- `/qotd` — post a Question of the Day.
- `/wyr` — Would You Rather (two options).
- `/truthordare kind:string?` — truth, dare, or random.
- `/neverhaveiever` — a Never-Have-I-Ever prompt.
- `/mostlikelyto` — a 'Most likely to…' prompt.
- `/promptconfig channel hour enabled` — (ManageGuild) configure daily QOTD.

**Interactions.** `prompt:another:<category>` button → `event.update()` with a new prompt from the same category (avoids repeats via a recent-id ring buffer; per-user cooldown).

**Data.** `prompt_settings` (one row per guild): `guildId` PK, `qotdChannelId`, `qotdEnabled`, `qotdHourUtc`, `lastQotdDate`, plus per-category recent-id ring buffers (jsonb) to avoid repeats. Prompt banks are bundled in-repo (TS data), not in the DB.

**Permissions.** `SendMessages`. `/promptconfig` gated by Discord `ManageGuild`.

**Cooldown / anti-spam.** Per-user cooldown on each command + the 'Another' button (~5s). Recent-id ring buffer prevents repeating the last N prompts per category per guild. Output is fixed-length embeds.

**Key edge cases.** Daily QOTD with no channel configured → daily stays off.; Configured channel deleted/forbidden → catch, skip, log (don't crash the tick).; Bank exhausted within the recent window → fall back to full bank.; `/truthordare` invalid kind → defaults to random.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove module from wiring + drop the `prompt_settings` table migration, or disable via `/modules`.

---

## Feature 03 — Giveaways  (module `giveaways`)

**Scope.** Run giveaways with a one-tap 'Enter' button and an automatic scheduled draw, plus end-early, reroll, list and cancel.

**Commands.**
- `/giveaway start prize:string duration:string winners:integer? channel:channel?` — (ManageGuild) start a giveaway.
- `/giveaway end id:string` — (ManageGuild) end early and draw now.
- `/giveaway reroll id:string` — (ManageGuild) draw new winners.
- `/giveaway cancel id:string` — (ManageGuild) cancel without drawing.
- `/giveaway list` — list active giveaways.

**Interactions.** `giveaway:enter:<id>` button → record one entry per user (unique index), ephemeral confirm.

**Data.** `giveaways` (id, guildId, channelId, messageId, prize, winnersCount, hostExternalId, endsAt, status[active|ended|canceled], createdAt). `giveaway_entries` (id, giveawayId FK, userExternalId, createdAt; unique(giveawayId,userExternalId)).

**Permissions.** `SendMessages`, `EmbedLinks`. Admin subcommands gated by `ManageGuild`.

**Cooldown / anti-spam.** One entry per user (DB unique). Winners clamped 1..20. Duration parsed + clamped (min 10s, max 30d). Entry button has a light per-user cooldown to avoid double-tap races.

**Key edge cases.** Fewer entrants than winners → all entrants win.; Zero entrants at draw → announce 'no valid entrants', mark ended.; Giveaway message deleted → post results as a new message.; Reroll on a non-ended giveaway → friendly error.; End/cancel an already-ended giveaway → friendly error.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove module from wiring + drop the two tables, or disable via `/modules`.

---

## Feature 04 — Server Stats & Weekly Highlights  (module `server-stats`)

**Scope.** Count message activity (counts only — never message text) per guild/channel/member/day and surface it via `/serverstats`, `/myactivity`, and an optional weekly highlights recap post.

**Commands.**
- `/serverstats` — server activity overview (today, this week, top members/channels).
- `/myactivity user:user?` — a member's message counts + rank.
- `/statsconfig channel:channel dow:integer hour:integer enabled:boolean` — (ManageGuild) weekly recap config.

**Interactions.** None required (overview is an embed). Optional Prev/Next buttons on long top-lists (deferred).

**Data.** `activity_user_daily` (guildId, userExternalId, date, messages; unique(guildId,user,date)). `activity_channel_daily` (guildId, channelId, date, messages; unique). `serverstats_settings` (guildId PK, recapChannelId, recapEnabled, recapDow, recapHourUtc, lastRecapDate).

**Permissions.** `SendMessages`, `EmbedLinks`, `ViewChannel` in counted channels. `/statsconfig` gated by `ManageGuild`.

**Cooldown / anti-spam.** No user-facing spam (read-only). Bots excluded from counts. Writes are batched: an in-memory accumulator flushes via a 60s scheduler job using upserts, so a busy server is not one DB write per message.

**Key edge cases.** No activity yet → zeros, friendly empty state.; Recap channel missing/forbidden → skip + log.; Date rollover handled in UTC.; Accumulator lost on restart → at most ~60s of counts lost (documented, acceptable).

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove module + drop the three tables, or disable via `/modules`.

---

## Feature 05 — Trivia / Quiz  (module `trivia`)

**Scope.** Channel trivia rounds with a bundled question bank: a question embed + four answer buttons, first-correct-wins, a wins leaderboard, and optional scheduled auto-trivia.

**Commands.**
- `/trivia category:string? difficulty:string?` — start a round in this channel.
- `/trivia-leaderboard` — top trivia winners (button paginated).
- `/triviaconfig channel:channel interval:integer enabled:boolean` — (ManageGuild) auto-trivia.

**Interactions.** `trivia:ans:<roundId>:<optionIndex>` buttons → record answer (one per user/round, unique), ephemeral feedback; first correct resolves the round and reveals via `event.update()`/edit.

**Data.** Bundled question bank in-repo (`bank.ts`: category, difficulty, question, options[4], correctIndex). `trivia_rounds` (id, guildId, channelId, messageId, questionId, correctIndex, status[open|resolved], startedAt, winnerExternalId). `trivia_answers` (roundId FK, userExternalId, correct; unique(roundId,user)). `trivia_scores` (guildId, userExternalId, wins; unique).

**Permissions.** `SendMessages`, `EmbedLinks`. `/triviaconfig` gated by `ManageGuild`.

**Cooldown / anti-spam.** One open round per channel at a time; one answer per user per round; per-user cooldown on `/trivia` start. Recent-question ring buffer per guild to avoid repeats.

**Key edge cases.** Start while a round is open → 'a round is already running here'.; No correct answer before timeout → reveal answer, no winner.; User answers twice → blocked by unique index, ephemeral note.; Message deleted mid-round → resolve in DB, post result as new message.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove module + drop the three tables, or disable via `/modules`.

---

## Feature 06 — Mini-games (PvP: Tic-Tac-Toe, Connect Four)  (module `minigames`)

**Scope.** Head-to-head button-board games — Tic-Tac-Toe (3×3) and Connect Four (7 columns) — with challenge/accept, turn enforcement, win/draw detection, and stale-game expiry.

**Commands.**
- `/tictactoe opponent:user` — challenge to Tic-Tac-Toe.
- `/connect4 opponent:user` — challenge to Connect Four.

**Interactions.** `mg:accept:<gameId>` / `mg:decline:<gameId>` — opponent accepts/declines.; `mg:ttt:<gameId>:<cell>` — place a mark (Tic-Tac-Toe).; `mg:c4:<gameId>:<col>` — drop a disc (Connect Four).

**Data.** `minigame_sessions` (id, guildId, channelId, messageId, game[ttt|c4], playerX, playerO, board[jsonb], turn, status[pending|active|finished|expired], winner, createdAt, updatedAt). Persisted so an in-flight game survives a restart.

**Permissions.** `SendMessages`. No special permissions.

**Cooldown / anti-spam.** Only the two players can interact (and only on their turn) — enforced server-side. Self-challenge and bot-challenge rejected. Cap concurrent games per user. Stale games expire.

**Key edge cases.** Non-player clicks → ephemeral 'this isn't your game'.; Out-of-turn click → ephemeral 'not your turn'.; Occupied cell / full column → ignored with ephemeral note.; Draw (board full, no winner) → declared draw.; Challenge not accepted in 5 min → auto-expire; idle active game > 15 min → expire.; Opponent is a bot or self → rejected at command time.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove module + drop the table, or disable via `/modules`.

---

## Feature 07 — Economy — Currency Core  (module `economy`)

**Scope.** A per-server virtual currency (no real money): balances, member-to-member transfers, a richest-members leaderboard, and admin grant/remove. The ledger that Daily (8) and Shop (9) build on.

**Commands.**
- `/balance user:user?` — show a balance.
- `/give user:user amount:integer` — transfer coins to another member.
- `/baltop` — richest-members leaderboard (button paginated).
- `/economy grant user amount` / `/economy take user amount` — (ManageGuild) adjust balances.
- `/economy config name emoji starting` — (ManageGuild) currency cosmetics + starting balance.

**Interactions.** `eco:baltop:<page>` buttons for leaderboard pagination.

**Data.** `economy_accounts` (id, guildId, userExternalId, balance bigint, lastDailyDate, streak [added in F8]; unique(guildId,user); index(guildId,balance)). `economy_transactions` (id, guildId, userExternalId, delta bigint, reason, createdAt) — audit trail. `economy_settings` (guildId PK, currencyName, currencyEmoji, startingBalance).

**Permissions.** `SendMessages`. Admin subcommands gated by `ManageGuild`.

**Cooldown / anti-spam.** `/give`: positive integer only, sender ≠ recipient, recipient not a bot, sufficient balance, per-transfer cap + per-user cooldown to throttle laundering. All balance changes recorded in `economy_transactions` for traceability.

**Key edge cases.** Account auto-created at starting balance on first touch.; Give more than you have → friendly error.; Give to self/bot → rejected.; Negative/zero amount → rejected.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove the Daily/Shop commands first, then the module + drop economy tables. Disable via `/modules`.

---

## Feature 08 — Economy — Daily / Streak  (module `economy`)

**Scope.** A once-per-day `/daily` claim that pays currency and tracks a consecutive-day streak with a (capped) streak bonus. Extends the economy module.

**Commands.**
- `/daily` — claim the daily reward (shows amount, streak, time until next).

**Interactions.** None.

**Data.** Adds `lastDailyDate` (date) and `streak` (int) columns to `economy_accounts` (migration on top of F7). Daily config values live in `economy_settings`.

**Permissions.** `SendMessages`.

**Cooldown / anti-spam.** One claim per UTC day (enforced by `lastDailyDate`). `computeDaily(now, lastClaimDate, streak, config)` is a pure function returning `{canClaim, amount, newStreak}`.

**Key edge cases.** Already claimed today → 'come back in Xh'.; Claimed yesterday → streak +1; gap >1 day → streak resets to 1.; Streak bonus capped to avoid runaway payouts.; First-ever claim → streak 1.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove the `/daily` command; the two columns can stay (nullable/defaulted) or be dropped via a down migration. Disable via `/modules`.

---

## Feature 09 — Economy — Shop (buy roles/perks)  (module `economy`)

**Scope.** A per-server shop where members spend currency to buy roles/perks. Admins define items; purchases debit the balance and grant the role (with the same hierarchy guard role-menus uses). Extends the economy module.

**Commands.**
- `/shop` — list purchasable items + prices (paginated).
- `/buy item:string` — purchase an item (debits balance, grants role).
- `/shop add role:role price:integer label:string?` — (admin) add a role item.
- `/shop remove item:string` — (admin) remove an item.

**Interactions.** `eco:shop:<page>` buttons for catalog pagination.

**Data.** `shop_items` (id, guildId, kind['role'], roleId, label, price bigint, active; index(guildId)). `shop_purchases` (id, guildId, userExternalId, itemId FK, pricePaid, createdAt).

**Permissions.** `SendMessages`; `ManageRoles` (to grant purchased roles); admin subcommands gated by `ManageGuild`. Bot's top role must sit above any purchasable role (hierarchy footgun — same as role-menus; guarded by `canManageRole`).

**Cooldown / anti-spam.** Buying a role you already own → blocked. Insufficient funds → blocked. Price must be >0. Purchase is transactional (debit + grant + purchase row). Per-user buy cooldown.

**Key edge cases.** Role above the bot in hierarchy → block with a clear admin-facing error (don't debit).; Item inactive/removed between `/shop` and `/buy` → friendly error.; Role manually removed later → re-buyable (documented).; Adding a managed/@everyone role → rejected.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove the `/shop` + `/buy` commands + drop the two shop tables. Disable via `/modules`.

---

## Feature 10 — Levels — XP & Leaderboards  (module `levels`)

**Scope.** Count-based XP from message activity (no message content read), levels via a curve, optional level-reward roles and level-up announcements, plus `/rank` and a button-paginated XP leaderboard.

**Commands.**
- `/rank user:user?` — level, XP, progress to next level, leaderboard position.
- `/levels` — XP leaderboard (button paginated).
- `/levelconfig …` — (ManageGuild) XP settings + no-XP channels + announcements.
- `/levelrewards add level:integer role:role` / `remove level:integer` / `list` — (ManageGuild) reward roles.

**Interactions.** `lvl:lb:<page>` buttons for leaderboard pagination.

**Data.** `level_members` (id, guildId, userExternalId, xp bigint, level int, messages int, lastAwardAt; unique(guildId,user); index(guildId,xp)). `level_rewards` (id, guildId, level, roleId; unique(guildId,level)). `level_settings` (guildId PK, enabled, announceChannelId, levelUpMessage, noXpChannelIds[jsonb], xpMin, xpMax, cooldownSeconds).

**Permissions.** `SendMessages`; `ManageRoles` (only if level-reward roles are enabled). `/levelconfig` + `/levelrewards` gated by `ManageGuild`.

**Cooldown / anti-spam.** Per-user XP cooldown (default 60s) via `lastAwardAt`; randomized xpMin..xpMax per award; no-XP channel denylist; bots excluded; output caps. This is the anti-farm core.

**Key edge cases.** Cooldown not elapsed → no XP (silent).; Channel in no-XP list → skip.; Reward role above bot in hierarchy → skip + log (no crash).; Multiple level-ups in one award → grant all reward roles up to the new level.; XP only ever increases (no decay/level-down) unless an admin resets.

**Acceptance criteria.** Commands register; happy-path works; each edge case handled with a friendly message; unit tests for pure logic green; migration applies; module toggles from `/modules`.

**Rollback.** Remove module + drop the three tables, or disable via `/modules`.

---

## Checkpoint

Status: PASS

### Validat
- All 10 features have a complete design (scope, commands, interactions, data,
  permissions, cooldown, edge cases, acceptance, rollback), consistent with the
  verified codebase pattern. Per-feature spec sheets generated.
- Dependencies explicit (economy core → daily/shop); each feature implementable
  and testable in isolation; no privileged intents/modals/reactions.
### Nevalidat
- No code written yet (implementation is Agents 6–15).
### Probleme
- Economy delivers 3 features in 1 module across 3 migrations — must be applied in order.
### Următorul agent poate continua?
Da. The implementation plan (05) sequences these into waves with per-step gates.
