# 06 — Implementation Validation (Raise Hand / Speaker Queue)

> Agent: **AGENT 6 — IMPLEMENTATION**
> Date: 2026-06-27
> All commands were run inside the Docker `app` workbench
> (`docker compose exec -T app pnpm …`); the Windows host has no Node.

This file records the actual implementation per stage and the **real** validation
output (only what was executed is marked validated). The locked design is in
[`00-orchestrator-plan.md`](00-orchestrator-plan.md) §3; the staged plan is
[`05-implementation-plan.md`](05-implementation-plan.md).

## New + changed files (whole feature)

**New package `packages/raise-hand-module/`:**
- `package.json`, `tsconfig.json`
- `src/logic.ts` — pure functions (ordering, dedupe position, promote priority,
  customId encode/parse, panel/embed rendering) + `MODERATOR_PERMISSION`.
- `src/logic.test.ts` — 14 unit tests.
- `src/repo.ts` — Drizzle persistence (`getOrCreateQueue`, `getQueue`, `setPanel`,
  `listEntries`, idempotent `addEntry`, `removeEntry`, `clearQueue`, `advance`,
  `promote`).
- `src/service.ts` — orchestration (raise/lower/show/next/remove/clear/promote,
  `postPanel`, `refreshPanel`, `announce`, `handleInteraction`, `handleVoiceState`,
  `isModerator`).
- `src/commands.ts` — 8 slash commands.
- `src/index.ts` — `createRaiseHandModule()` factory + re-exports.

**Shared files edited (additive, non-breaking):**
- `packages/shared/src/types.ts` — `MODULE_KEYS.raiseHand = 'raise-hand'`.
- `packages/database/src/schema.ts` — `speakerQueues` + `speakerQueueEntries` tables.
- `packages/database/migrations/0002_blue_cannonball.sql` (+ snapshot/journal) — generated.
- `packages/database/src/seed.ts` — built-in module row ('Speaker Queue', default OFF).
- `packages/core/src/contracts/events.ts` — new `VoiceStateUpdateEvent` + union member.
- `packages/core/src/contracts/guild-service.ts` — new `memberHasPermission(...)`.
- `packages/discord-adapter/src/adapter.ts` — `Events.VoiceStateUpdate` listener +
  `emitVoiceStateUpdate()` (uses the already-enabled `GuildVoiceStates` intent).
- `packages/discord-adapter/src/guild-service.ts` — `memberHasPermission()` impl.
- `apps/bot/src/main.ts` — build `raiseHandHandle`, add to `modules[]`.
- `apps/bot/src/register-commands.ts` — collect the new commands.
- `apps/bot/package.json` — `@botplatform/raise-hand-module` workspace dep.

> **Out of scope / not mine:** `packages/audio-module/src/resolver/*` and
> `docs/{music,fun-features}/` were already modified in the working tree by a
> concurrent effort at session start (the initial git snapshot was clean except
> `docs/agent-memory/`). These are unrelated to raise-hand — see Stage 6 note.

---

## Checkpoint — Stage 1: Queue core (schema, migration, repo, logic, tests)

Status: PASS

### Modificări făcute
- `MODULE_KEYS.raiseHand`; two Drizzle tables; `repo.ts` + `logic.ts` + 14 tests.

### Comenzi rulate
- `pnpm db:generate` → emitted `migrations/0002_blue_cannonball.sql`.
- `pnpm exec vitest run --project unit packages/raise-hand-module` → **14 passed**.
- `pnpm --filter @botplatform/raise-hand-module typecheck` → clean.

### Validat efectiv
- Generated SQL contains the **partial unique index**
  `... WHERE status <> 'done'` (dedupe) and FK cascade — verified by reading the
  migration and by `\d speaker_queue_entries` in Postgres after migrate.
- Pure logic (ordering `priority DESC, raisedAt ASC`; promote priority; customId
  round-trip; positions; rendering) covered by 14 green tests.

### Nevalidat
- DB repo functions exercised only indirectly (no DB-backed repo test written;
  covered at runtime via the live bot, not an automated DB test).

### Probleme
- None.

### Următoarea etapă poate continua?
Da.

---

## Checkpoint — Stage 2: Slash commands + module wiring

Status: PASS

### Modificări făcute
- 8 commands in `commands.ts`; wired into `main.ts`, `register-commands.ts`,
  `seed.ts`; bot workspace dep added; `pnpm install` to link.

### Comenzi rulate
- `docker compose exec app pnpm install` → linked the new package (done in 2m34s).
- `pnpm --filter @botplatform/bot typecheck` → clean.
- `pnpm exec eslint <my files>` → exit 0 (clean).

### Validat efectiv
- The bot app + new module typecheck clean; lint clean.
- Command shapes validated against Discord's live API — see Stage 6 /
  `pnpm discord:register-commands` (36 commands registered, 8 new).

### Nevalidat
- Per-command runtime behaviour (raise/lower/etc.) in a live VC — needs manual
  multi-user testing (documented in `07-regression-validation.md`).

### Probleme
- None.

### Următoarea etapă poate continua?
Da.

---

## Checkpoint — Stage 3: Voice-state integration (`voice.state.update`)

Status: PASS

### Modificări făcute
- `VoiceStateUpdateEvent` added to `core/contracts/events.ts` + the `PlatformEvent`
  union; adapter listens to `Events.VoiceStateUpdate` and emits the neutral event
  (ignores pure mute/deafen toggles where `channelId` is unchanged; ignores bots).
- Module event handler `handleVoiceState` removes a user from the queue of the
  channel they left/moved away from and refreshes the panel.

### Comenzi rulate
- `pnpm --filter @botplatform/core typecheck` → clean.
- `pnpm --filter @botplatform/discord-adapter typecheck` → clean.
- Full unit suite (below) → no regressions.

### Validat efectiv
- Core + adapter typecheck clean with the additive event.
- No new privileged intent: the adapter already requests `GuildVoiceStates`
  unconditionally (verified `adapter.ts`).

### Nevalidat
- The actual leave→auto-remove path firing on a real voice disconnect — needs a
  live VC test.

### Probleme
- None.

### Următoarea etapă poate continua?
Da.

---

## Checkpoint — Stage 4: Control panel + `memberHasPermission`

Status: PASS

### Modificări făcute
- `/speaker-panel` posts a persistent embed + 5 buttons (Raise/Lower/Show/Next/
  Clear); `customId = rh:<action>:<voiceChannelId>`. `handleInteraction` routes
  clicks; Next/Clear re-checked server-side via the new
  `GuildService.memberHasPermission('MuteMembers')` + `isGuildOwner`.

### Comenzi rulate
- typecheck (core + discord-adapter + raise-hand-module) → clean.
- lint (my files) → clean.

### Validat efectiv
- The additive `memberHasPermission` exists on the contract + Discord impl;
  every existing GuildService **test mock** uses `as unknown as GuildService`, so
  the interface addition does not break them (verified by grep + full unit run).

### Nevalidat
- Actual button clicks / server-side gate rejection in Discord — manual test.

### Probleme
- Known limitation: the panel **Raise** button does not verify the clicker is
  physically in the bound VC (the slash `/raise-hand` does, via
  `getUserVoiceChannel`). Documented in `commands-and-interactions.md` +
  `troubleshooting.md`.

### Următoarea etapă poate continua?
Da.

---

## Checkpoint — Stage 5: Priority / `/promote-speaker`

Status: PASS

### Modificări făcute
- `/promote-speaker @user` sets the target's `priority` to `max(waiting)+1`
  (jumps to front). `repo.promote` + `logic.promotedPriority` + tests.

### Comenzi rulate
- Unit tests cover `promotedPriority` + ordering (`sortWaiting`).

### Validat efectiv
- Ordering & promotion logic covered by green unit tests.

### Nevalidat
- Live promote in a real queue — manual test.

### Probleme
- None.

### Următoarea etapă poate continua?
Da.

---

## Checkpoint — Stage 6: Persistence + runtime smoke (no admin UI in MVP)

Status: PASS

### Modificări făcute
- State is DB-backed from Stage 1 (survives restart). No admin-panel page in MVP
  (optional, on the roadmap) — the module is enable/disable-able via the existing
  `modules` table + `/modules` toggle (seeded default OFF).

### Comenzi rulate (real validation)
- `pnpm db:migrate` → `migrations applied`.
- `psql \d speaker_queue_entries` → table + partial unique index present.
- `pnpm test:unit` → **35 files, 346 tests, ALL PASS** (incl. 14 raise-hand).
- `pnpm test:integration` → **7 files, 37 tests, ALL PASS** (incl. `migrations`
  applying 0002 to a fresh test DB).
- `pnpm build` → both `apps/bot` + `apps/admin` build clean (tsup); new module
  bundled into `apps/bot/dist/main.js`.
- `docker compose restart bot` → logs show **`raise-hand module ready`**, `bot
  kernel started`, `adapter started`, `discord connected` (identity
  `MokokoBotV2#7402`, 1 guild). No load errors.
- `pnpm discord:register-commands` → **Registered 36 slash commands** for the
  guild (instant). The 8 new commands' shapes + `defaultMemberPermissions:
  ['MuteMembers']` are therefore valid (Discord rejects invalid permission names).

### Validat efectiv
- Migration applies (dev + integration test DB); tables/index correct in Postgres.
- Whole test suite green; no regressions from the additive core/adapter/shared/db
  changes.
- Real bot process loads the module and connects to Discord.
- Slash command shapes accepted by Discord's live API.

### Nevalidat
- End-to-end **behaviour** in a live voice channel with real members (raising via
  command + button, voice-leave auto-removal, moderator advance + announcement,
  promote). Cannot be automated locally (needs multiple humans in a VC). See
  `07-regression-validation.md` + `raise-hand/testing.md` for the manual script.

### Probleme găsite
- **Pre-existing / concurrent (NOT raise-hand):** the full-monorepo
  `pnpm typecheck` fails only in `packages/audio-module` test mocks
  (`flatPlaylist` missing on `YtDlpRunner`) — those files were modified by a
  concurrent effort, not by this feature. Every package raise-hand touches
  typechecks clean in isolation. Documented so it is not attributed to this work.

### Următoarea etapă poate continua?
Da — proceed to regression validation (Agent 7) and final report (Agent 8).
