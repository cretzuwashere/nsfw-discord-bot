# 03 — Architecture (Remake)

> **Agent:** ARCHITECTURE · **Date:** 2026-06-27 · **Repo root:** `C:/Projects/Mods/Fable - Mod`
> **Output:** `docs/technical/architecture.md` (rewritten from stale 11-module version).
> **Method:** read the inventory note (`01-inventory.md`) then verified by reading the
> actual source. Every claim in the deliverable is tagged verified/deduced.

---

## What I read this pass (all `[verified in code]`)

- `packages/core/src/kernel.ts` — startup order, error boundary, adapter
  isolation, scheduler/health ownership, `installProcessHandlers` (SIGINT/SIGTERM
  10s force-exit, uncaughtException → stop+exit, unhandledRejection log-only),
  reverse-order shutdown.
- `packages/core/src/registry.ts` — duplicate module-key + command-name collision
  guards (throw `PlatformError('INTERNAL')`); `createDispatcher` (command error
  boundary, `moduleState.isEnabled` gate, audit success/error with safe message
  only); `createEventDispatcher` (filter by type, `Promise.all`, per-handler
  try/catch isolation, enabled-gate). Subcommand routing in `runCommand`.
- `packages/core/src/scheduler.ts` — in-process periodic runner; per-job overlap
  guard (`inFlight`), `intervalMs`, failures logged not fatal, `register` throws
  on duplicate name, `runNow` for tests, `timer.unref`.
- `packages/core/src/health.ts` — `HealthAggregator.run()` → degraded if any error.
- `packages/core/src/module-state.ts` — `CachedModuleState` 10s TTL, fallback to
  last-known (default enabled) on lookup failure.
- `packages/core/src/contracts/*` — module.ts (BotModule, ModuleMetadata,
  ConfigFieldSchema, ModuleEventHandler), commands.ts (CommandContext incl.
  voice + replyRich, CommandDefinition incl. defaultMemberPermissions),
  adapter.ts (ChannelAdapter + AdapterContext), events.ts (the **5** events incl.
  voice.state.update), guild-service.ts (GuildService incl. `memberHasPermission`
  + full moderation primitives; GuildServiceProvider.forGuild/isReady), ports.ts
  (AuditLogPort never-throw, ModuleStatePort, HealthIndicator), voice.ts
  (AudioStreamSource, VoiceSession, VoiceCapability).
- `packages/shared/src/errors.ts` — PlatformError / UserFacingError.safeMessage /
  toSafeUserMessage / GENERIC_USER_ERROR.
- `packages/shared/src/types.ts` — `MODULE_KEYS` (20 keys), ADAPTER_KEYS,
  TrackSummary/QueueSnapshot.
- `packages/discord-adapter/src/{adapter,command-mapper,register-commands,index}.ts`
  — gateway↔core translation, intent gating (privileged opt-in flags, close-code
  4014 reasoning), component dispatch + deferUpdate fallback, voice.state.update
  drops bot/mute-deafen, GuildServiceProvider impl, commandsToDiscordJson,
  registerSlashCommands.
- `apps/bot/src/main.ts` — composition root: 20 module handles, kernel modules
  array, scheduler jobs (L204–212; serverStats/trivia plural), health (db +
  always-ok discord), internal API listen.
- `apps/bot/src/internal-api.ts` — `/healthz` + token-guarded `/internal/{status,
  audio/:guildId/...}` with `timingSafeEqualStrings`.
- `apps/bot/src/register-commands.ts` — the manual command mirror (16 modules
  spread; NOOP_GUILD_PROVIDER).
- `apps/bot/src/seed.ts` + `packages/database/src/seed.ts` — all 20 modules in
  `builtInModules`; idempotent admin/e2e user bootstrap.
- `apps/admin/src/server.ts` — Fastify SSR assembly, guards (requireAuth /
  requireMutatingRole), error boundary, core pages incl. `/audio` + `/moderation`
  inline, COMMUNITY_ROUTE_PLUGINS loop.
- `apps/admin/src/routes/{index,context,welcome,placeholders}.ts` — plugin
  registry (9 module plugins + placeholder), AdminRouteContext/AdminRoutePlugin,
  reference module route, placeholder pages (`/reminders`, `/permissions`).
- `apps/admin/src/bot-client.ts` — never-throws HTTP client (3s timeout, null on
  failure).
- `apps/admin/src/command-catalog.ts` — 11 module keys only (gap corroboration).
- `apps/admin/views/` listing — no views for the 9 newest modules.

---

## Key architectural facts established

1. **Hexagonal/ports-and-adapters confirmed by imports:** `core` imports only
   config/logger/shared; modules import core+database+shared, never
   discord-adapter; discord-adapter + database implement core ports.
2. **5 platform events** incl. newest `voice.state.update` (non-privileged
   GuildVoiceStates; adapter drops mute/deafen-only + bot users).
3. **`GuildService.memberHasPermission`** exists specifically for server-side
   re-checking of moderator gating on **button** interactions (Discord can't gate
   components by permission).
4. **THREE/FOUR-PLACE module wiring** is the headline fragility: MODULE_KEYS +
   main.ts + seed.ts + register-commands.ts, none derived from the others.
5. **9 of 20 modules have zero admin UI** (raise-hand, fun-commands,
   engagement-prompts, giveaways, server-stats, trivia, minigames, economy,
   levels) — no route, no view, not in command-catalog. reminders is a
   placeholder-only half-case. Triple-corroborated.
6. **Fault isolation** is consistent: adapter-start, scheduler-job, and
   per-handler event failures are all caught.
7. **Internal-API seam** is token-guarded (constant-time compare) and the admin
   client never throws (renders "bot offline").

---

## Discrepancies / corrections vs the brief & inventory

- **Package count:** the brief says "26 packages (19 module packages)". On-disk
  reality (and `01-inventory.md`) is **20 module packages → 27 total packages**
  (6 infra + discord-adapter + 20 `*-module`). I did not re-run
  `pnpm -r list` (no Docker access in my pass), so I document **20 modules** as
  the load-bearing fact (verified via MODULE_KEYS + main.ts + seed.ts) and leave
  the exact "31 projects" derivation to the RUNTIME/DOCKER agent.
- **moderation events:** `01-inventory.md` did not assert moderation events; I
  initially deduced one and removed it from the deliverable table (left blank) to
  avoid inventing behaviour — automod owns the `message.create` content filtering.
  MODULES agent should verify each module's `events` array.

---

## Checkpoint

Status: PASS

### Validat
- All 7 core contract files read; BotModule/ModuleRegistry/BotKernel/
  CommandContext/ChannelAdapter/5 PlatformEvents/GuildService(+memberHasPermission)/
  VoiceCapability+VoiceSession+AudioStreamSource/AuditLogPort+ModuleStatePort/
  UserFacingError boundary all documented from source.
- Module lifecycle (load→register→onLoad→adapter start→scheduler→audit) verified
  against `kernel.ts:56–111`; shutdown reverse-order verified.
- Dependency flow (inward to core) verified by import lines.
- bot↔admin internal-API seam verified (internal-api.ts + bot-client.ts).
- THREE/FOUR-place wiring verified across types.ts/main.ts/seed.ts/register-commands.ts.
- 9-module admin gap triple-corroborated (routes/index.ts, command-catalog.ts 11
  keys, views/ listing).
- "Add module / command / admin page" guides written against real reference files
  (welcome-module, welcome.ts route, register-commands.ts).
- ASCII layer diagram + 20-module table included.

### Nevalidat
- Per-module `events`/`commands` detail beyond what main.ts/register-commands.ts
  reveal (only welcome-module + custom-commands inferred); marked `[deduced]`.
- Exact pnpm "31 projects" number (no Docker in this pass).
- discord-adapter `guild-service.ts` and `voice-session.ts` bodies not fully read
  (contract-level behavior taken from the core port + adapter.ts usage).
- `packages/database/src/schema.ts` / repos / migrate-cli internals (only seed.ts
  read).

### Probleme
- Package-count discrepancy persists (brief 26 vs disk 27); documented, not fatal
  — the load-bearing number is **20 modules**, which is fully verified.
- The FOUR-PLACE manual wiring + hand-curated `command-catalog.ts` are genuine
  drift hazards; flagged in §7.1/§7.3 of the deliverable for the MODULES agent.

### Următorul agent poate continua?
Da. Architecture is complete and source-verified. MODULES agent should: (a) open
each of the 20 module `src/index.ts` to confirm the per-module commands/events
columns and the `metadata.requiredIntents`; (b) scope the 9-module admin-UI gap
(§7.2) as concrete work. RUNTIME/DOCKER agent should settle the canonical
package/project count and re-read the Dockerfiles + compose.
