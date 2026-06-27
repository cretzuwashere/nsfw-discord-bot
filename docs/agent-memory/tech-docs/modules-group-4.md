# Tech Docs — Module Group 4

Scope: 4 community modules, all verified in code on 2026-06-27. None ships
default-enabled; none has a dedicated admin route (see Gaps).

Modules covered:

- `fun-commands` — `packages/fun-commands-module/`
- `engagement-prompts` — `packages/engagement-prompts-module/`
- `giveaways` — `packages/giveaways-module/`
- `server-stats` — `packages/server-stats-module/`

All four are wired in `apps/bot/src/main.ts` (imports, `.module` registration,
and scheduler-job registration). All four have `defaultEnabled: false` in
`packages/database/src/seed.ts`. `MODULE_KEYS` values come from
`packages/shared/src/types.ts` (lines 15-18).

Legend: (V) = verified in code, (D) = deduced, (U) = documented-elsewhere-unverified.

---

## 1. fun-commands (key `fun-commands`)

Factory: `createFunCommandsModule` in `packages/fun-commands-module/src/index.ts`.
Stateless — **no DB, no scheduler, no events** (V). Pure logic lives in
`logic.ts` (deterministic via injectable `rng`/`now`).

Metadata (V): `requiredPermissions: ['SendMessages']`, `requiredIntents: ['Guilds']`.

Commands — built by `buildFunCommands` in `commands.ts` (V). Five top-level
commands, **none** with `defaultMemberPermissions` (no gate); none `guildOnly`:

| Command | Options | Gate |
|---|---|---|
| `/8ball` | `question` (string, required) | none |
| `/roll` | `dice` (string, optional; default `1d6`) | none |
| `/flip` | — | none |
| `/choose` | `options` (string, required; comma/pipe separated, max 20) | none |
| `/rps` | `move` (string, required: rock/paper/scissors) | none |

Anti-spam: in-memory per-user-per-command cooldown, default 3000 ms
(`createCooldownStore` + `hitCooldown`, keyed `${user.id}:${name}`) (V).
Dice clamped to safe limits (`DICE_LIMITS`: maxCount 100, sides 2..1000,
modifier ±100000) (V).

DB tables: none. Scheduler jobs: none. Interaction handlers: none. Admin route: none.

---

## 2. engagement-prompts (key `engagement-prompts`)

Factory: `createEngagementPromptsModule` in
`packages/engagement-prompts-module/src/index.ts`. Has service, repo, pure logic,
and bundled SFW prompt banks (`banks.ts`, in-repo data, no external API) (V).

Metadata (V): `requiredPermissions: ['SendMessages']`, `requiredIntents: ['Guilds']`.

Commands — `buildPromptCommands` in `commands.ts` (V). All `guildOnly: true`:

| Command | Options | Gate |
|---|---|---|
| `/qotd` | — | none |
| `/wyr` | — | none |
| `/neverhaveiever` | — | none |
| `/mostlikelyto` | — | none |
| `/truthordare` | `kind` (string, optional: truth/dare/random) | none |
| `/promptconfig` | `channel` (channel, req), `hour` (int, req), `enabled` (bool, req) | **ManageGuild** |

Prompt categories (`banks.ts`): `qotd`, `wyr`, `truth`, `dare`, `nhie`,
`mostlikely`. `/truthordare` resolves truth/dare (random via rng). Per-user
cooldown default 5000 ms (V). Non-repeating selection via per-category recent
ring buffer (cap 12), persisted in `prompt_settings.recent` jsonb (V).

Platform events handled (V): `component.interaction` → `service.handleInteraction`.

Interaction handlers (V):
- customId `prompt:another:<category>` → re-pick a non-recent prompt for that
  category and `event.update(...)` the message in place (falls back to
  `event.reply` if no `update`). Unknown category / no guild → "no longer
  available" reply.

Scheduler jobs (V):
- `engagement-prompts.daily-qotd`, interval **5 min** (TICK_MS = 5 * 60_000).
  `service.deliverDailyQotd(now)` posts the daily QOTD to every guild that is
  due (`isQotdDue`: enabled + channel set + matching UTC hour + not already
  posted today). On send failure it still advances `lastQotdDate` so a
  permission/channel error does not retry every tick (V).

DB tables (V, `schema.ts`):
- `prompt_settings` (PK `guild_id` → guilds, cascade): `qotd_channel_id`,
  `qotd_enabled` (default false), `qotd_hour_utc` (default 12),
  `last_qotd_date`, `recent` jsonb (default `{}`), `updated_at`.

Admin route: none.

---

## 3. giveaways (key `giveaways`)

Factory: `createGiveawaysModule` in `packages/giveaways-module/src/index.ts`.
Service + repo + pure logic (`drawWinners` partial Fisher–Yates, duration parse,
clamps) (V).

Metadata (V): `requiredPermissions: ['SendMessages', 'EmbedLinks']`,
`requiredIntents: ['Guilds']`, `auditEvents: []`.

Commands — `buildGiveawayCommands` in `commands.ts`. Single top-level command
`giveaway`, `guildOnly: true`, **`defaultMemberPermissions: ['ManageGuild']`**
(the whole command + all subcommands are ManageGuild-gated) (V):

| Subcommand | Options |
|---|---|
| `start` | `prize` (string, req), `duration` (string, req — `1h`/`1d`/`1d 6h`), `winners` (int, opt; 1-20 default 1), `channel` (channel, opt; default here) |
| `end` | `id` (string, req) |
| `reroll` | `id` (string, req) |
| `cancel` | `id` (string, req) |
| `list` | — |

`id` accepts the 8-char short id shown in `/giveaway list` (matched by exact or
prefix via `findByShortId`) (V). Duration parsed by `parseDuration`
(s/m/h/d/w + combos), clamped 10 s .. 30 days; winners clamped 1..20 (V).

Platform events handled (V): `component.interaction` → `service.enter`.

Interaction handlers (V):
- customId `giveaway:enter:<giveawayId>` → adds a unique entry
  (`giveaway_entries`, dedup via unique index). Ephemeral-style reply: entered /
  already entered / ended.

Scheduler jobs (V):
- `giveaways.draw-due`, interval **30 s** (TICK_MS = 30_000).
  `service.drawDue(now)` finds active giveaways past `ends_at`, draws unique
  winners, marks `ended`, edits the original message + posts a congrats
  announcement (best-effort) (V).

DB tables (V, `schema.ts`):
- `giveaways` (PK uuid): `guild_id`→guilds cascade, `channel_id`, `message_id`,
  `prize`, `winners_count` (default 1), `host_external_id`, `status`
  (default `'active'`; values active/ended/canceled), `winners` jsonb string[],
  `ends_at`, `ended_at`, `created_at`. Indexes: `giveaways_guild_idx`,
  `giveaways_due_idx (status, ends_at)`.
- `giveaway_entries` (PK uuid): `giveaway_id`→giveaways cascade,
  `user_external_id`, `created_at`. Unique index
  `giveaway_entries_unique_idx (giveaway_id, user_external_id)`.

Admin route: none.

---

## 4. server-stats (key `server-stats`)

Factory: `createServerStatsModule` in `packages/server-stats-module/src/index.ts`.
Service + repo + pure logic incl. an in-memory `ActivityAccumulator` (V).
**Counts only — no message content stored** (V).

Metadata (V): `requiredPermissions: ['SendMessages', 'EmbedLinks']`,
`requiredIntents: ['Guilds']`.

Commands — `buildServerStatsCommands` in `commands.ts`. All `guildOnly: true`:

| Command | Options | Gate |
|---|---|---|
| `/serverstats` | — | none |
| `/myactivity` | `user` (user, optional; default caller) | none |
| `/statsconfig` | `channel` (channel, req), `day` (int 0-6, req), `hour` (int 0-23, req), `enabled` (bool, req) | **ManageGuild** |

Platform events handled (V): `message.create` → records into the accumulator,
**skipping bot authors and DMs** (`e.author.bot || !e.guild` guard). Keyed by
guild/user/channel external ids (V).

Interaction handlers: none (V).

Scheduler jobs (V) — **two** (returned as `schedulerJobs[]`, both registered in main.ts):
- `server-stats.flush`, interval **60 s** (FLUSH_MS = 60_000). Drains the
  accumulator into batched per-day upserts (skips when accumulator empty) (V).
- `server-stats.weekly-recap`, interval **5 min** (RECAP_TICK_MS = 5 * 60_000).
  `deliverWeeklyRecaps(now)` posts a "Weekly Highlights" embed to due guilds
  (`isRecapDue`: enabled + channel + matching UTC day-of-week + hour + not
  posted today). Advances `last_recap_date` even on send failure (V).

DB tables (V, `schema.ts`):
- `activity_user_daily` (PK bigserial): `guild_id`→guilds cascade,
  `user_external_id`, `date` (text YYYY-MM-DD UTC), `messages` (default 0).
  Unique `(guild_id, user_external_id, date)`; index `(guild_id, date)`.
- `activity_channel_daily` (PK bigserial): `guild_id`, `channel_id`, `date`,
  `messages`. Unique `(guild_id, channel_id, date)`; index `(guild_id, date)`.
- `serverstats_settings` (PK `guild_id`→guilds cascade): `recap_channel_id`,
  `recap_enabled` (default false), `recap_dow` (default 1=Mon), `recap_hour_utc`
  (default 12), `last_recap_date`, `updated_at`.

`/serverstats` shows today + 7-day totals, active members, top 5 chatters, top 3
channels. `/myactivity` shows today/week/all-time counts + weekly rank.
Admin route: none.

---

## Gaps / Caveats

- **No admin UI for any of the 4 modules** (V). `apps/admin/src/routes/` has no
  route file for fun-commands, engagement-prompts, giveaways, or server-stats,
  and `routes/placeholders.ts` only registers `/reminders` and `/permissions`.
  `routes/index.ts` has no nav entry for them either. Configuration is
  Discord-only (`/promptconfig`, `/statsconfig`; giveaways via `/giveaway`).
- Scheduler jobs are tick-poll style (compare current UTC hour/dow), so they
  rely on the scheduler firing within the matching hour. On a missed hour the
  daily/weekly post is skipped for that period (D).
- `voice.state.update` platform event exists but none of these 4 modules use it.
- giveaways/engagement-prompts/server-stats resolve the internal guild id via
  `guilds.upsertByExternalId` on demand; server-stats also resolves per drain
  batch (V).
- fun-commands cooldown and engagement-prompts/server-stats accumulator state
  are in-memory only — reset on bot restart, not shared across processes (D).

## Checkpoint

Status: PASS

### Validat
- All 4 module factories, command builders, services, repos, pure logic read in full.
- DB tables read directly from `packages/database/src/schema.ts` (lines 858-975).
- Seed `defaultEnabled: false` for all 4 confirmed (`seed.ts` lines 97-120).
- MODULE_KEYS values confirmed (`shared/src/types.ts` lines 15-18).
- main.ts wiring (imports, module list, scheduler registration) confirmed.
- Absence of admin routes confirmed by directory listing + placeholders.ts + index.ts grep.

### Nevalidat
- Runtime behaviour not executed (no Node/container run); behaviour deduced from source.

### Probleme
- None blocking. Documented gap: no admin UI for these 4 modules.

### Următorul agent poate continua?
Yes. Source is self-contained; remaining groups (trivia, minigames, economy,
levels, raise-hand) follow the same factory/service/repo/logic + seed + schema
pattern.
