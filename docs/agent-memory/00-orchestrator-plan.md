# 00 — Orchestrator Plan (Raise Hand / Speaker Queue)

> Agent: **AGENT 0 — ORCHESTRATOR**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)
> Feature: **Raise Hand / speaking order / speaking priority** for the Discord bot.

> Note: the previous occupant of this filename (the read-only *documentation
> pass* plan, Agents 0–9) is archived verbatim at
> [`00-orchestrator-plan.docpass-archive.md`](00-orchestrator-plan.docpass-archive.md).
> The inventory + architecture analyses it produced
> ([`01-project-inventory.md`](01-project-inventory.md),
> [`03-architecture-analysis.md`](03-architecture-analysis.md)) are reused below.

This file is the single source of truth for the raise-hand orchestration: what
was verified about the existing project, the **locked** design decisions (so every
later agent elaborates the *same* design), the agent ordering, and the per-stage
validation criteria.

---

## 1. Project facts established (verified by reading source this session)

The existing repo is the **`botplatform`** monorepo (Docker-first modular Discord
bot platform).

| Topic | Verified fact | Source |
|---|---|---|
| Language / runtime | TypeScript 5.9, ESM, Node 24, pnpm workspaces | `package.json`, `tsconfig.base.json` |
| Discord library | **discord.js `^14.26`** + `@discordjs/voice ^0.19` | `pnpm-workspace.yaml` catalog |
| Host | **No Node on host — Docker-first.** Build/test/lint run via `docker compose exec app pnpm …` | memory `botplatform-build`, `scripts/dev-entry.sh` |
| Module pattern | `create<Name>Module(opts) → { module: BotModule, … }`; uniform across 11 modules | `packages/*-module/src/index.ts` |
| Commands | Adapter-neutral `CommandDefinition[]` on `module.commands`; supports `subcommands`, `guildOnly`, `defaultMemberPermissions`, typed `options` | `packages/core/src/contracts/commands.ts` |
| Events | `PlatformEvent` union = **only** `member.join`, `member.leave`, `message.create`, `component.interaction`. **No voice event exists yet.** | `packages/core/src/contracts/events.ts` |
| Buttons/Selects | Arrive as `component.interaction` with `customId`, `values`, `userRoleIds`, `reply()`, `update()`. Routed by `customId` prefix. | `discord-adapter/src/adapter.ts`, role-menus module |
| Voice intent | Adapter **already requests `GatewayIntentBits.GuildVoiceStates` by default** — voice-state data needs **no privileged intent**. | `adapter.ts:71-76` |
| Voice at command time | `CommandContext.voice.getUserVoiceChannel()` → caller's current VC `{id,name}` | `contracts/voice.ts`, `adapter.ts:412` |
| GuildService | Send/edit/delete msg, DMs, roles, moderation primitives, `botHasPermission`, `getMemberRoleIds`, `isGuildOwner`. **No per-member permission check yet.** | `core/src/contracts/guild-service.ts` |
| Persistence | Drizzle + Postgres, **single** `schema.ts`, migrations via drizzle-kit. Repos per module. | `database/src/schema.ts`, role-menus `repo.ts` |
| Permissions (RBAC) | `permission_mappings` table + moderation `PermissionService` (role→permission key). Slash gating also via Discord `defaultMemberPermissions`. | `moderation-module/src/services/permission-service.ts` |
| New-module wiring | 5 touchpoints: `MODULE_KEYS` (shared), `schema.ts`+migration, `seed.ts`, `apps/bot/src/main.ts`, `apps/bot/src/register-commands.ts` | architecture analysis |

**Docker status at orchestration start:** `docker compose ps` shows `db`, `app`,
`bot`, `admin` all **Up / healthy**. The `app` service (`sleep infinity`) is the
validation workbench → **local validation IS possible** (typecheck, lint, unit,
migrate, integration, build). Live Discord smoke test depends on a valid
`DISCORD_TOKEN` (historically malformed in this repo — see §6).

---

## 2. Discord capability reality check (drives the design)

(Detailed in [`02-discord-raise-hand-research.md`](02-discord-raise-hand-research.md)
and [`04-permissions-and-discord-capabilities.md`](04-permissions-and-discord-capabilities.md).)

- ✅ **Read voice state** (who is in which VC, join/leave/move) — via
  `GuildVoiceStates` (already on). This is how we detect "user left the VC".
- ✅ **Slash commands, buttons, select menus, ephemeral replies, embeds** — fully
  supported and already used by the codebase.
- ✅ **Server mute/deafen, move members between VCs** — *possible* with `Mute
  Members` / `Move Members`, but **deliberately out of MVP scope** (too invasive;
  changes the social contract). Documented as optional roadmap.
- ❌ **Auto-detect who is *speaking*** — NOT reliably available. Discord only
  exposes a "speaking" signal over a **voice-receive** connection (bot must join
  the VC and use `@discordjs/voice` receiver), which is unreliable, discouraged,
  and privacy-invasive. → The queue is an **explicit, managed raise-hand queue**,
  never voice-activity-driven.

A method depending on speaking-detection or forced muting would violate the
"don't invent behaviours the API can't support / don't require invasive perms"
rules, so both are excluded from MVP.

---

## 3. LOCKED design decisions (every later agent elaborates THIS)

**Feature / module key:** `Speaker Queue` / `raise-hand` (added as
`MODULE_KEYS.raiseHand = 'raise-hand'`). New package `packages/raise-hand-module`
(mirrors the role-menus structure: `index/commands/service/logic/repo` + panel).

**Chosen UX = hybrid: slash commands (primary) + a button control panel +
self-managed queue with moderator controls.** Why (full comparison in research doc):
- Slash commands are the project's first-class, testable, permission-gateable
  primitive (every module uses them).
- A button panel mirrors the existing role-menus / audio now-playing pattern
  (`component.interaction`) → one-tap raise/lower + a live, auto-refreshing queue.
- Reactions rejected: not in the `PlatformEvent` union (no reaction handling),
  unordered, easy to desync — worse for an ordered queue and a bigger change.

**Queue scope = per `(guild, voice channel)`.** A raise-hand is tied to the VC the
user is in at the time. Different VCs are independent rooms.

**State = persistent (Postgres/Drizzle)**, like every other DB module. Survives
restart. New tables:
- `speaker_queues` — one row per `(guild, voice channel)`; holds panel
  channel/message ids + the announce channel.
- `speaker_queue_entries` — one row per raised hand (FK → `speaker_queues`):
  `userExternalId`, `displayName`, `status` (`waiting`|`active`|`done`),
  `priority` (int), `raisedAt`. Ordered by `(priority DESC, raisedAt ASC)`.

**Voice-leave handling = add a `voice.state.update` platform event** (additive,
non-breaking) to `contracts/events.ts` + the adapter (`Events.VoiceStateUpdate`),
using the already-enabled `GuildVoiceStates` intent. Handler removes a user from
the queue of the VC they left/moved away from + refreshes the panel.

**Duplicate prevention** = partial unique index on `(queue_id, user_external_id)`
for non-`done` entries; `/raise-hand` is idempotent (re-raise reports your
current position).

**Priority** = `/promote-speaker @user` (mod) sets priority above current max
→ jumps to front of `waiting`. Role-based auto-priority deferred to roadmap.

**Permissions:**
- Everyone: `/raise-hand`, `/lower-hand`, `/speaker-queue` (guildOnly; raise
  requires being in a VC).
- Moderators: `/next-speaker`, `/remove-speaker`, `/clear-speaker-queue`,
  `/promote-speaker`, `/speaker-panel` — Discord `defaultMemberPermissions:
  ['MuteMembers']` (natural "manage who speaks"; does NOT force the bot to mute).
  Guild owner always allowed.
- Panel moderator buttons re-checked server-side → add additive
  `memberHasPermission(userExternalId, permission)` to `GuildService` (Discord
  impl: `member.permissions.has(PermissionFlagsBits[name])`). Raise/Lower/Show
  buttons open to everyone.

**Announce next speaker** = on advance, edit the panel + post
"🎤 @user is next to speak" in the panel channel (allowed-mentions = that user
only). No DMs in MVP.

**No new runtime dependencies** — uses discord.js, drizzle-orm, zod (all present).

---

## 4. Agent ordering & deliverables

| # | Agent | Deliverable(s) | Depends on |
|---|---|---|---|
| 0 | Orchestrator | `00-orchestrator-plan.md` (this file) | — |
| 1 | Interaction analysis | `01-current-bot-interaction-analysis.md` | inventory+arch memory |
| 2 | Discord research | `02-discord-raise-hand-research.md`, `raise-hand/raise-hand-overview.md` | web verification |
| 3 | Feature design | `03-feature-design.md`, `raise-hand/{user-flows,moderator-flows,queue-and-priority-rules}.md` | 1,2 + §3 brief |
| 4 | Permissions/capabilities | `04-permissions-and-discord-capabilities.md`, `raise-hand/permissions.md` | 2 + §3 brief |
| 5 | Implementation plan | `05-implementation-plan.md`, `raise-hand/future-roadmap.md` | 1–4 |
| 6 | Implementation | code + `06-implementation-validation.md`, `raise-hand/commands-and-interactions.md` | 5 |
| 7 | Testing & regression | `07-regression-validation.md`, `raise-hand/{testing,troubleshooting}.md` | 6 |
| 8 | Documentation & handoff | `99-final-orchestrator-report.md`; reconcile all docs | 1–7 |

**Orchestration refinement (documented deviation):** Agents 1–5 (research +
design *spec* docs) run as a parallel fan-out workflow seeded with the §3 locked
brief (distinct output files → conflict-free). Implementation (Agent 6) is done
**inline and sequentially** by the orchestrator because it co-edits shared files
(`schema.ts`, `events.ts`, `adapter.ts`, `guild-service.ts`, `main.ts`,
`register-commands.ts`, seed, shared types) that cannot be safely parallel-edited.
The *reality-dependent* docs (`commands-and-interactions.md` final, `testing.md`,
`troubleshooting.md`) are finalized **after** implementation to avoid drift;
Agent 8 reconciles everything against the shipped code.

---

## 5. Per-stage validation criteria (PASS / PARTIAL / FAIL)

| Stage | Scope | Validation gate |
|---|---|---|
| 1 | Queue core (schema, migration, repo, pure logic, unit tests) | `pnpm test:unit` (new logic tests green) + `db:generate` emits a migration + typecheck clean |
| 2 | Slash commands + wiring (MODULE_KEYS, main.ts, register-commands, seed) | typecheck + lint clean; module loads; register-commands collects new commands |
| 3 | `voice.state.update` event (core + adapter) + leave handler | typecheck clean; adapter build green; event unit test |
| 4 | Control panel buttons + `/speaker-panel` + `memberHasPermission` | typecheck + lint + unit clean |
| 5 | Priority / `/promote-speaker` | unit tests for ordering |
| 6 | Full regression | full `pnpm test`, lint, typecheck, build, `db:migrate` + integration in Docker; `bot` container still healthy |

**Global gates (Agent 7):** `docker compose exec app pnpm typecheck`, `… lint`,
`… test`, `… build`, `db:migrate`. Document anything that cannot be validated
locally (e.g. live slash-command registration / real VC behaviour without a valid
Discord token).

**Definition of "validated":** only what was actually run (build/test/lint/
migrate) or directly observed. Assumptions are labelled as such.

---

## 6. Known risks / constraints

1. **No host Node** → every command runs in Docker (`docker compose exec app pnpm
   …`). Host `node`/`pnpm` fail.
2. **Discord token** historically malformed in `.env` → live registration + real
   VC behaviour may be untestable; document as PARTIAL if so.
3. **Three-place module agreement** (`MODULE_KEYS` + factory key + seed row) must
   stay in sync.
4. **`register-commands.ts` is a manual mirror** — must add the new module there
   or its slash commands never register.
5. **Migration discipline** — schema edits require `db:generate` (drizzle-kit) to
   emit a new migration; never hand-edit applied migrations.
6. Adapter/core are shared by all modules → the additive `voice.state.update`
   event + `memberHasPermission` must not break existing flows.

---

## Checkpoint

Status: PASS

### Validat
- Existing architecture, module pattern, command/event/voice/guild-service
  contracts, persistence + migration flow, permission model, and the 5 new-module
  wiring touchpoints — re-verified by reading source this session.
- `GuildVoiceStates` intent already enabled (voice-state read needs no privileged
  intent) — verified in `adapter.ts`.
- Docker dev stack confirmed Up/healthy → local validation is available.
- Design fully locked (§3) and consistent with verified Discord capabilities (§2).

### Nevalidat
- No code built yet (Agent 6 not started).
- Live Discord behaviour (token validity not checked this session).
- `discord-adapter/src/guild-service.ts` impl not yet read (read before Stage 4).

### Probleme
- Token risk for live smoke test (§6.2).
- Adapter/core are shared surfaces — additive changes must be regression-checked.

### Următorul agent poate continua?
**Da.** The plan, verified facts, and locked design give Agents 1–5 an unambiguous
brief and Agent 6 an exact wiring map. Proceed to the research + design fan-out,
then inline incremental implementation with Docker validation per stage.
