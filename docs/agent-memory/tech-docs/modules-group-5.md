# Tech Docs — Module Group 5 (trivia, minigames, economy, levels)

Scope: the four newest "game / progression" community modules. All facts below are **verified in code** (read 2026-06-27) unless tagged otherwise. Repo-root-relative paths are used throughout.

Common platform facts (verified):
- Each module is a factory `create<Name>Module(options)` returning `{ module: BotModule, service, ... }`. Wired in `apps/bot/src/main.ts` (imports lines 7–18; handle creation lines 120–137; `module` registration lines 189–192; scheduler registration lines 211–212).
- All four ship a seed row in `packages/database/src/seed.ts` with **`defaultEnabled: false`** (lines 121–144).
- **None** of the four has a dedicated admin route in `apps/admin/src/routes/`. They are also **not** listed in `placeholders.ts` (which only covers `/reminders` and `/permissions`). So they have **no admin UI at all** (not even a placeholder page) — a real, documentable gap. Admin route status = "none".
- DB tables for all four live in `packages/database/src/schema.ts` lines 977–1216.
- `defaultMemberPermissions` on a command maps to Discord's command-level gate. Commands without it are usable by everyone (gameplay commands); admin/config commands gate on `ManageGuild`.

---

## 1. trivia (`trivia-module`, key `trivia`)

- **Package dir:** `packages/trivia-module`
- **Purpose:** Channel trivia rounds answered with buttons; bundled in-repo question bank (41 questions, `src/bank.ts`); per-guild win leaderboard; optional auto-trivia on an interval.
- **Metadata:** `requiredPermissions: ['SendMessages','EmbedLinks']`, `requiredIntents: ['Guilds']` (`src/index.ts` 47–50).

### Slash commands (`src/commands.ts`)
| Command | Subcommands | Gate | Notes |
|---|---|---|---|
| `/trivia` | — | none (guildOnly) | Starts a round in the current channel. |
| `/trivia-leaderboard` | — | none (guildOnly) | Top 10 by wins. |
| `/triviaconfig` | — | `ManageGuild` | Options: `channel` (channel, req), `interval` (int min, req, clamped 5..10080 via `clampInterval`), `enabled` (bool, req). Configures auto-trivia. |

### Events
- `component.interaction` → `service.handleAnswer` (only acts on `trivia:ans:` ids).

### Interaction handlers
- `trivia:ans:<roundId>:<choiceIndex>` — record answer (1 per user/round, unique-index enforced), reveal + declare winner on first correct. Atomic claim via `resolveIfOpen` (race-safe: "someone beat you to it"). Increments `triviaScores.wins`.

### Scheduler jobs (`src/index.ts`)
- `trivia.resolve-expired` — every **30 000 ms**. Reveals answers for rounds open past 45 s timeout (`ROUND_TIMEOUT_SEC=45`), edits message to "Time's up".
- `trivia.auto` — every **60 000 ms**. Starts auto-trivia rounds where `isAutoDue` (interval elapsed) and no open round in the channel.
- Both registered in `main.ts` via `for (const job of triviaHandle.schedulerJobs)`.

### DB tables
- `trivia_rounds` (status `open`|`resolved`, questionIndex, correctIndex, winnerExternalId, startedAt)
- `trivia_answers` (unique on round_id+user_external_id → re-answer prevention)
- `trivia_scores` (unique on guild_id+user_external_id; `wins`)
- `trivia_settings` (PK guild_id; auto_channel_id, auto_enabled, auto_interval_min default 360, last_auto_at, `recent` jsonb ring for non-repeating questions)

### Caveats
- Question bank is static in-repo (no external API). Non-repeat ring capped at `RECENT_RING_CAP=20`.
- `triviaconfig` requires all three options each call (no partial update).

---

## 2. minigames (`minigames-module`, key `minigames`)

- **Package dir:** `packages/minigames-module`
- **Purpose:** Head-to-head Tic-Tac-Toe and Connect Four played via buttons (challenge → accept/decline → board moves).
- **Metadata:** `requiredPermissions: ['SendMessages']`, `requiredIntents: ['Guilds']` (`src/index.ts` 46–49).

### Slash commands (`src/commands.ts`)
| Command | Subcommands | Gate | Notes |
|---|---|---|---|
| `/tictactoe` | — | none (guildOnly) | Option `opponent` (user, req). Sends a challenge. |
| `/connect4` | — | none (guildOnly) | Option `opponent` (user, req). Sends a challenge. |

### Events
- `component.interaction` → `service.handleInteraction` (only acts on `mg:` ids).

### Interaction handlers (customId patterns)
- `mg:accept:<id>` / `mg:decline:<id>` — only the challenged player (`playerO`) may respond; sets status active/finished.
- `mg:ttt:<id>:<cell 0-8>` — TTT move (turn-gated to current player; validates square free).
- `mg:c4:<id>:<col 0-6>` — Connect-Four move (validates column not full). Win/draw detection from `ttt.ts`/`connect4.ts`.

### Scheduler jobs (`src/index.ts`)
- `minigames.expire-stale` — every **60 000 ms**. Expires pending challenges older than 5 min (`PENDING_MAX_AGE_SEC=300`) and active games idle > 15 min (`ACTIVE_IDLE_SEC=900`); edits message to "Expired". Single job — registered in `main.ts` as `minigamesHandle.schedulerJob` (singular).

### DB tables
- `minigame_sessions` (game `ttt`|`c4`; playerX/playerO; `board` jsonb int[] 0/1/2; turn `X`|`O`; status `pending`|`active`|`finished`|`expired`; winner `X`|`O`|`draw`|null)

### Caveats
- `MAX_ACTIVE_PER_USER=3` concurrent pending/active games per challenger (counted across both roles).
- Cannot challenge yourself. No win/loss leaderboard or stats persistence beyond the session row.

---

## 3. economy (`economy-module`, key `economy`)

- **Package dir:** `packages/economy-module`
- **Purpose:** Per-guild virtual currency (no real money): balances, daily/streak rewards, member-to-member transfers, role shop, admin grant/take, append-only transaction ledger.
- **Metadata:** `requiredPermissions: ['SendMessages','ManageRoles']`, `requiredIntents: ['Guilds']` (`src/index.ts` 38–41). `ManageRoles` needed because shop purchases grant roles.

### Slash commands (`src/commands.ts`)
| Command | Subcommands | Gate | Notes |
|---|---|---|---|
| `/balance` | — | none (guildOnly) | Option `user` (default self). |
| `/give` | — | none (guildOnly) | `user` (req), `amount` (int, req). Atomic transfer. |
| `/daily` | — | none (guildOnly) | Claim daily reward; UTC-day + streak logic (`computeDaily`). |
| `/baltop` | — | none (guildOnly) | Paginated richest members. |
| `/shop` | — | none (guildOnly) | Paginated active shop items. |
| `/buy` | — | none (guildOnly) | `item` (short id from /shop, req). Buys role; refunds on role-grant failure. |
| `/economy` | `grant`, `take`, `config` | `ManageGuild` | `config` options: name, emoji, starting, daily, bonus, cap (all optional, partial patch). |
| `/shopadmin` | `add`, `remove` | `ManageGuild` | `add`: role(req), price(req), label(opt). `remove`: item(req). |

### Events
- `component.interaction` → `service.handleInteraction` (acts on `eco:baltop:` / `eco:shop:` ids).

### Interaction handlers (customId patterns)
- `eco:baltop:<page>` — re-render richest-members page.
- `eco:shop:<page>` — re-render shop page. (Prev/Next buttons; PAGE_SIZE=10.)

### Scheduler jobs
- **None.** Module handle is `{ module, service }` only; nothing registered in `main.ts`.

### DB tables
- `economy_accounts` (balance, last_daily_date `YYYY-MM-DD`, streak; unique guild+user)
- `economy_transactions` (bigserial; append-only ledger: delta, reason)
- `economy_settings` (PK guild; currency_name `coins`, currency_emoji 🪙, starting_balance 0, daily_amount 100, daily_streak_bonus 10, daily_streak_cap 30)
- `shop_items` (kind default `role`, role_id, label, price, active)
- `shop_purchases` (bigserial; item_id FK set-null on delete, price_paid)

### Caveats
- Balances clamp at 0 (`applyDelta`); transfers/debits are SQL-transaction atomic; conditional `tryDebit` prevents overdraft.
- Buy flow: debit → addRole → on failure `applyDelta` refund + throws ADAPTER_ERROR (verified). Checks role ownership and bot hierarchy (`canManageRole`) before charging.
- Short-id lookup (`findItemByShortId`) matches full uuid or prefix among up to 200 rows — prefix collisions theoretically possible (first match wins).
- Max single amount `MAX_AMOUNT = 1_000_000_000` (`logic.ts`).

---

## 4. levels (`levels-module`, key `levels`)

- **Package dir:** `packages/levels-module`
- **Purpose:** Earn XP from chat activity (MEE6-style curve), level up with optional reward roles, leaderboard + per-member rank card. XP is from message *count/activity*, not content.
- **Metadata:** `requiredPermissions: ['SendMessages','ManageRoles']`, `requiredIntents: ['Guilds']` (`src/index.ts` 43–46). `ManageRoles` for level-reward roles.
- **NOTE on intents (deduced):** metadata declares only `Guilds`, but the module subscribes to `message.create`. Reading message content / message events at the gateway normally needs the MessageContent / GuildMessages intent. The module only uses message *metadata* (author, channel, guild) — not content — so `Guilds` may be sufficient for the platform's event abstraction; the actual gateway intent is owned by the discord-adapter, not declared here. Flagged as a possible under-declaration to verify against the adapter.

### Slash commands (`src/commands.ts`)
| Command | Subcommands | Gate | Notes |
|---|---|---|---|
| `/rank` | — | none (guildOnly) | Option `user` (default self). Shows level, XP bar, rank #. |
| `/levels` | — | none (guildOnly) | Paginated XP leaderboard. |
| `/levelconfig` | — | `ManageGuild` | Options (all optional, partial patch): enabled, channel, message (`{user}`/`{level}`), xp_min, xp_max, cooldown. |
| `/levelnoxp` | — | `ManageGuild` | channel(req), add(bool req). Toggle a channel in/out of the no-XP list. |
| `/levelrewards` | `add`, `remove`, `list` | `ManageGuild` | `add`: level(req)+role(req). `remove`: level(req). `list`: shows mappings. |

### Events
- `message.create` → `service.handleMessage` (awards XP, respects cooldown + no-XP channels + enabled flag; in-memory caches for guildId, settings (30 s TTL), and per-user cooldown).
- `component.interaction` → `service.handleInteraction` (acts on `lvl:lb:` ids).

### Interaction handlers (customId patterns)
- `lvl:lb:<page>` — re-render leaderboard page (Prev/Next; PAGE_SIZE=10).

### Scheduler jobs
- **None.** Handle is `{ module, service }`; nothing registered in `main.ts`. Level-up announcements and role grants happen inline on `message.create`.

### DB tables
- `level_members` (xp, level, messages count, last_award_at; unique guild+user)
- `level_rewards` (guild+level unique → role_id; granted for all levels in `(oldLevel, newLevel]` on level-up)
- `level_settings` (PK guild; enabled default **false**, announce_channel_id null=same channel, level_up_message default `🎉 {user} reached level **{level}**!`, no_xp_channel_ids jsonb, xp_min 15, xp_max 25, cooldown_seconds 60)

### Caveats
- Leveling is OFF by default twice over: module `defaultEnabled:false` in seed AND `level_settings.enabled` default false — admin must `/levelconfig enabled:true` to actually award XP.
- In-memory caches (settings TTL 30 s, guildId, cooldown map) are per-process — not shared across multiple bot replicas; cooldown resets on restart.
- XP curve `xpToNext(l) = 5l² + 50l + 100`; `levelForXp` loops cumulatively (fine for normal levels).

---

## Cross-cutting gaps / caveats (verified)
1. **No admin UI** for any of the four (no route file, not even a placeholder). Everything is Discord-slash-command driven only.
2. **All four default-disabled** in seed (`defaultEnabled:false`).
3. Economy + Levels have **no scheduler jobs**; Trivia has 2; Minigames has 1.
4. Levels metadata may under-declare gateway intents for `message.create` (deduced — verify against discord-adapter).
5. In-memory state in levels (caches/cooldown) is not multi-replica-safe (deduced).

## Checkpoint

Status: PASS

### Validat
- Read every `src/` file (index, commands, service, repo, logic, plus trivia `bank.ts`) for all 4 modules — verified in code.
- DB tables read directly from `packages/database/src/schema.ts` (lines 977–1216).
- `defaultEnabled:false` for all 4 confirmed in `packages/database/src/seed.ts` (121–144).
- Module + scheduler wiring confirmed in `apps/bot/src/main.ts` (trivia 2 jobs, minigames 1 job, economy/levels 0 jobs).
- Confirmed NO admin route file and NO placeholder entry for any of the 4.
- Trivia bank size = 41 questions (counted).

### Nevalidat
- Actual Discord gateway intents requested by the discord-adapter for `message.create` (levels) — not cross-checked here; flagged as deduced.
- Runtime behavior (no container run); analysis is static-read only.

### Probleme
- Possible intent under-declaration in levels metadata (`Guilds` only vs message events) — needs adapter cross-check.
- Economy short-id prefix lookup could collide on prefixes (low risk).

### Următorul agent poate continua?
Da. To extend: cross-reference levels' `message.create` against `packages/discord-adapter` intent computation; and if building admin UIs, these 4 modules are greenfield (no existing route to mirror except generic patterns in `apps/admin/src/routes/`).
