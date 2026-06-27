# 00 — Orchestrator Plan (Fun / Engagement Features)

> Agent: **AGENT 0 — ORCHESTRATOR**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths relative to repo root)
> Goal: research → analyze → select **TOP 10 fun/engagement features** → implement
> them **incrementally** with real validation, for a **large** Discord community.

## 0. Why this file lives here

The project already runs the agent-memory directory with **per-orchestration
namespacing** (`docs/agent-memory/music/…`, plus a prior `raise-hand`
orchestration that owns the flat `docs/agent-memory/00..05` files). To honor the
task's required file list **without destroying** the prior raise-hand /
documentation-pass memory, this orchestration's memory is namespaced under
**`docs/agent-memory/fun-features/`** using the exact filenames the brief
requested (`00-orchestrator-plan.md` … `99-final-orchestrator-report.md`). The
user-facing feature docs live in the already-existing top-level
**`docs/fun-features/`** (and `docs/fun-features/features/`). This satisfies "if
the project already has a documentation structure, respect existing conventions,
but keep all required information easy to find."

---

## 1. Project facts established (verified by reading source this session)

The repo is the **`botplatform`** monorepo — a Docker-first, modular Discord bot
platform that already ships **11 modules**.

| Topic | Verified fact | Source |
|---|---|---|
| Language / runtime | TypeScript 5.9, ESM, Node 24, pnpm 10 workspaces | `package.json`, `tsconfig.base.json` |
| Discord lib | discord.js `^14.26` + `@discordjs/voice ^0.19` | `pnpm-workspace.yaml` catalog |
| Host | **No Node on host — Docker-first.** All build/test/lint via `docker compose exec app pnpm …` | memory `botplatform-build`, `scripts/dev-entry.sh` |
| Docker status | `db`, `app` (sleep-infinity workbench), `bot`, `admin` all **Up/healthy** at start → **local validation IS possible** | `docker compose ps` |
| Module pattern | `create<Name>Module(opts) → { module: BotModule, … }`, uniform across 11 modules | `packages/*-module/src/index.ts` |
| Commands | Adapter-neutral `CommandDefinition[]` on `module.commands`; supports `subcommands`, `guildOnly`, `defaultMemberPermissions`, typed `options` (string/integer/boolean/user/channel) | `packages/core/src/contracts/commands.ts` |
| Events | `PlatformEvent` union = **only** `member.join`, `member.leave`, `message.create`, `component.interaction` | `packages/core/src/contracts/events.ts` |
| Buttons/Selects | Arrive as `component.interaction` (`customId`, `values`, `userRoleIds`, `reply()`, `update()`), routed by `customId` prefix. **No emoji-reaction listener; no modals.** | `discord-adapter/src/adapter.ts`, docs/technical |
| Message content | `message.create.content` is **empty** unless privileged **MessageContent** intent enabled (OFF by default). Message *count* works without it. | `events.ts:49`, adapter |
| Member join/leave | Only fire with privileged **GuildMembers** intent (OFF by default) | adapter intents |
| Persistence | Drizzle + Postgres, **single** `packages/database/src/schema.ts`; migrations via `drizzle-kit generate`; one repo per module | `database/src/schema.ts`, reminders `repo.ts` |
| Scheduler | `kernel.scheduler.register(job)` with interval jobs; used by announcements/reminders/birthdays/scheduled-messages | `apps/bot/src/main.ts` |
| GuildService | send/edit/delete msg, DMs, roles (`canManageRole`/`addRole`/`removeRole`), moderation primitives, `botHasPermission`, `getMemberRoleIds`, `isGuildOwner`. Mass-mention is gated by `allowMentions`. | `core/src/contracts/guild-service.ts` |
| Admin panel | Fastify SSR; per-module route plugin = one file in `apps/admin/src/routes/<m>.ts` + one entry in `routes/index.ts`; modules enable/disable per server | `apps/admin/src/routes/index.ts`, `context.ts` |

### New-module wiring map (the touchpoints every feature must update)

1. `packages/<name>-module/` — new package (`package.json`, `tsconfig.json`,
   `src/index.ts` factory + `repo.ts` + logic/`service.ts` + `commands.ts` + `*.test.ts`).
2. `packages/database/src/schema.ts` — add tables/enums → run `pnpm db:generate`
   (drizzle-kit) to emit a migration; never hand-edit applied migrations.
3. `packages/shared/src/types.ts` — add the key to `MODULE_KEYS`.
4. `packages/database/src/seed.ts` — add the built-in module row.
5. `apps/bot/src/main.ts` — instantiate the handle, add `module` to the kernel,
   `kernel.scheduler.register(handle.schedulerJob)` if it has one.
6. `apps/bot/src/register-commands.ts` — add the module's `commands` (else its
   slash commands never register).
7. `apps/admin/src/routes/<name>.ts` + `routes/index.ts` — optional admin page.
8. Catalog deps: any new lib goes in `pnpm-workspace.yaml` `catalog:`.

---

## 2. Discord capability reality check (drives selection & design)

- ✅ Slash commands, subcommands, ephemeral replies, embeds, **buttons**,
  **string select menus** — fully supported and already used.
- ✅ Scheduler (interval jobs) for daily resets / weekly recaps / draws.
- ✅ Postgres persistence + per-module repos — cheap and well-trodden.
- ✅ Message *activity* (count-based) without privileged intent (`message.create`
  fires; only `.content` is gated).
- ✅ Server-side **image rendering** (cards module, resvg) — reusable for profile cards.
- ⚠️ **No emoji-reaction handling / no modals** → features needing them cost extra
  adapter+intent work → **prefer button/select designs** or accept the cost explicitly.
- ⚠️ **MessageContent** (counting game, word triggers) & **GuildMembers**
  (join-based features) are privileged → avoid for the TOP 10 where possible.
- ⚠️ **No voice-state platform event yet** → voice-activity XP needs adapter work →
  defer unless that event is added.

**Selection bias that follows:** favor features that are (a) button/select +
slash + scheduler based, (b) need no privileged intent, (c) reinforce each other
(XP → leaderboard → profile; economy → daily → shop), (d) have natural anti-spam
(cooldowns) and moderator on/off control.

---

## 3. Agent ordering, deliverables & strategy

| # | Agent | Deliverable(s) | Mode |
|---|---|---|---|
| 0 | Orchestrator | `00-orchestrator-plan.md` (this) | inline |
| 1 | Current-bot inventory | `01-current-bot-feature-inventory.md`, `docs/fun-features/overview.md` | inline (reuse prior inventory + technical docs) |
| 2 | Fun-feature research | `02-community-fun-feature-research.md`, `docs/fun-features/research-summary.md` | **workflow fan-out** (6 researchers + web) |
| 3 | Ranking | `03-candidate-feature-ranking.md`, `docs/fun-features/selected-top-10.md` | workflow synthesis + orchestrator review |
| 4 | Design | `04-top-10-feature-design.md`, `docs/fun-features/features/feature-01..10.md`, `commands-and-interactions.md`, `permissions.md` | inline (needs deep codebase fit) |
| 5 | Implementation plan | `05-implementation-plan.md`, `docs/fun-features/future-roadmap.md` | inline |
| 6–15 | Feature 01..10 implementation | code + `06..15-feature-XX-implementation-validation.md`, update each `feature-XX.md` + `testing.md` + `troubleshooting.md` | **inline, sequential**, Docker-validated, checkpoint per feature |
| 16 | Regression & integration | `16-regression-validation.md` | inline |
| 17 | Documentation review | `17-documentation-review.md` | inline (or fresh-eyes subagent) |
| 18 | Final report | `99-final-orchestrator-report.md` | inline |

**Why implementation is inline & sequential, not a parallel workflow:** every
feature co-edits **shared files** (`schema.ts`, `shared/types.ts`, `seed.ts`,
`apps/bot/src/main.ts`, `register-commands.ts`, `routes/index.ts`). Parallel edits
to these would conflict. The brief also mandates incremental, one-at-a-time
implementation with a checkpoint after each — sequential satisfies both. Research
and design (independent output files) are safe to fan out.

**Stop rule:** if a feature becomes too risky/blocked mid-implementation, stop it,
record the blocker in its validation file, mark it `BLOCKED`, and continue with the
next independent feature (do not block the whole pipeline). Promote the next-best
deferred candidate if a slot frees up.

---

## 4. Per-feature validation gate (PASS / PARTIAL / FAIL)

Each feature must pass, in the Docker `app` workbench, as applicable:

1. `docker compose exec -T app pnpm typecheck` — clean.
2. `docker compose exec -T app pnpm lint` — clean (or only pre-existing warnings).
3. `docker compose exec -T app pnpm db:generate` — emits a migration when schema changed; then `db:migrate` applies cleanly.
4. `docker compose exec -T app pnpm test:unit` — new pure-logic tests green + all prior green.
5. `docker compose exec -T app pnpm build` — both apps build (periodically, not necessarily every feature).
6. Bot container still **healthy** after wiring; `register-commands` (dry, without live token) collects the new commands.

**Definition of "validated":** only what was actually run or directly observed.
Live Discord behaviour (real slash invocation, button clicks in a guild) cannot
be exercised without a valid `DISCORD_TOKEN` and is documented as **NOT VALIDATED
(needs live token)** where relevant. Everything else is validated via
build/test/lint/migrate.

---

## 5. Known risks / constraints

1. **No host Node** → everything via `docker compose exec app pnpm …`.
2. **Discord token** historically malformed in `.env` → live smoke tests may be
   impossible → those steps documented as PARTIAL.
3. **Three-place module agreement** (`MODULE_KEYS` + factory `key` + seed row) must stay in sync.
4. **`register-commands.ts` is a manual mirror** — new slash modules must be added there.
5. **Migration discipline** — schema edits require `db:generate`; never hand-edit applied migrations. Migrations accumulate; integration tests build a fresh DB from them.
6. **Shared-surface edits** (core/adapter) must be additive & regression-checked; prefer to avoid them entirely for the TOP 10.
7. **Anti-spam is mandatory** — every interactive fun feature needs per-user
   (and where relevant per-channel/guild) cooldown + output length caps + farming
   guards (esp. XP/economy/leaderboards).

---

## Checkpoint

Status: PASS

### Validat
- Architecture, module pattern, command/event/guild-service contracts,
  persistence + migration flow, scheduler, admin routing, and the 8 new-module
  wiring touchpoints — verified by reading source this session.
- Docker dev stack Up/healthy → local validation available (`app` workbench).
- Capability constraints (no reactions/modals, privileged-intent gating) verified
  against `events.ts` + adapter + technical docs → drives selection toward
  button/select + slash + scheduler features needing no privileged intent.
- Naming/namespacing collision with prior orchestrations identified and resolved
  (this orchestration writes under `docs/agent-memory/fun-features/`).

### Nevalidat
- No fun-feature code written yet.
- Research/ranking workflow (`wf_9cfb208f-07d`) still running at time of writing.
- Live Discord behaviour (token validity not checked).

### Probleme
- Token risk for live smoke tests (§5.2).
- Filename collision in flat agent-memory namespace (resolved via subdir).

### Următorul agent poate continua?
**Da.** The verified facts + wiring map + validation gate give the inventory,
research, design, and implementation agents an unambiguous brief. Proceed:
inventory (Agent 1) inline, then consume the research/ranking workflow output.
