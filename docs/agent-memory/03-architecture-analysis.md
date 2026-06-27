# 03 — Architecture Analysis

> Agent: **AGENT 3 — ARCHITECTURE**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)

## Agent purpose

Verify and document the *architecture* of the `botplatform` monorepo from the
actual source: the layered structure (adapter → kernel/registry → modules →
services → persistence/config), the core contracts in `packages/core`, the
module lifecycle, the cross-package dependency flow, the bot↔admin coupling via
the internal HTTP API, the design patterns in use, the high-risk/high-coupling
areas, and a concrete "where do I add a feature" guide. The polished output is
`docs/technical/architecture.md`; this file is the working memory + checkpoint.

## Files analyzed (verified by reading)

Core contracts and engine:
- `packages/core/src/index.ts`
- `packages/core/src/contracts/module.ts` (BotModule, ModuleContext, ModuleMetadata, ModuleEventHandler, ConfigFieldSchema)
- `packages/core/src/contracts/commands.ts` (CommandDefinition, CommandContext, SubcommandDefinition, CommandDispatcher)
- `packages/core/src/contracts/adapter.ts` (ChannelAdapter, AdapterContext, AdapterStatus)
- `packages/core/src/contracts/voice.ts` (VoiceCapability, VoiceSession, AudioStreamSource, PlaybackEvent)
- `packages/core/src/contracts/ports.ts` (AuditLogPort, ModuleStatePort, HealthIndicator, AuditEntry)
- `packages/core/src/contracts/events.ts` (PlatformEvent union + handlers)
- `packages/core/src/contracts/guild-service.ts` (GuildService, GuildServiceProvider, OutgoingMessage)
- `packages/core/src/kernel.ts` (BotKernel)
- `packages/core/src/registry.ts` (ModuleRegistry, dispatchers, error boundary)
- `packages/core/src/scheduler.ts` (Scheduler, ScheduledJob)
- `packages/core/src/module-state.ts` (CachedModuleState)
- `packages/core/src/health.ts` (HealthAggregator)

Shared contracts:
- `packages/shared/src/errors.ts` (PlatformError, UserFacingError, toSafeUserMessage)
- `packages/shared/src/internal-api.ts` (INTERNAL_API_PATHS, InternalBotStatus, …)
- `packages/shared/src/types.ts` (MODULE_KEYS, ADAPTER_KEYS, QueueSnapshot, TrackSummary)

Config:
- `packages/config/src/index.ts` (AppConfig, loadConfig, env schema)

Persistence ports:
- `packages/database/src/ports.ts` (createDbAuditLog, createDbModuleState, createDbHealthIndicator)

Adapter:
- `packages/discord-adapter/src/index.ts` (barrel)
- `packages/discord-adapter/src/adapter.ts` (DiscordAdapter — ChannelAdapter + GuildServiceProvider)

Representative modules:
- `packages/audio-module/src/index.ts` (createAudioModule → AudioModuleHandle)
- `packages/announcements-module/src/index.ts` (reference DB/community module + scheduler job)
- `packages/welcome-module/src/index.ts` (event-driven module, no commands)

App wiring & integration seam:
- `apps/bot/src/main.ts` (composition root)
- `apps/bot/src/internal-api.ts` (internal HTTP API)
- `apps/bot/src/register-commands.ts` (slash-command registration CLI)
- `apps/admin/src/server.ts` (Fastify SSR server, guards, core pages)
- `apps/admin/src/bot-client.ts` (HTTP client to bot internal API)
- `apps/admin/src/routes/index.ts` (community route plugin list)
- `apps/admin/src/routes/context.ts` (AdminRouteContext / AdminRoutePlugin)
- `apps/admin/src/routes/announcements.ts` (reference admin route plugin)
- `apps/admin/src/routes/placeholders.ts` (catch-all placeholder pages)

`package.json` deps (to confirm the dependency graph):
- `packages/core/package.json`, `packages/shared/package.json`,
  `packages/database/package.json`, `packages/discord-adapter/package.json`,
  `packages/announcements-module/package.json`, `apps/bot/package.json`,
  `apps/admin/package.json`.

Also read first: `docs/agent-memory/01-project-inventory.md` (file map).

## Commands run

**None — read-only analysis.** Only Read/Glob were used. No pnpm/node/npm/
build/test/docker commands executed (host has no Node; another process owns
real validation).

## What was discovered (high level)

1. **Clean hexagonal / ports-and-adapters layering.** `packages/core` defines
   only interfaces and a thin engine (kernel, registry, scheduler, health,
   module-state cache). It depends **only** on `config`, `logger`, `shared`
   (verified `packages/core/package.json`) — it has **no** dependency on
   discord.js, the database, or any module. Discord lives entirely in
   `packages/discord-adapter`; persistence lives entirely in
   `packages/database`. Core talks to both only through the port interfaces in
   `contracts/ports.ts` and `contracts/adapter.ts`.

2. **The bot app (`apps/bot/src/main.ts`) is the composition root.** It is the
   only place that imports concrete implementations (DiscordAdapter, the
   database factories, all 11 module factories) and wires them together by
   constructor injection into `BotKernel`. Modules and the kernel never import
   each other's concretions.

3. **Module pattern is uniform and verified across 3 modules:**
   `create<Name>Module(options) → { module: BotModule, … }`. Options always
   carry the *dependencies the module needs* (config, logger, and for DB
   modules `db` + `audit` + `guildServiceProvider`). The returned handle exposes
   the `BotModule` plus extras the app needs (e.g. `schedulerJob` for
   announcements; `service` for welcome's card bridge; audio admin actions).

4. **The kernel owns lifecycle, error boundary, and graceful shutdown.**
   `BotKernel.start()` registers modules → builds command + event dispatchers →
   calls `module.onLoad` → starts adapters (adapter failure is **caught and
   audited**, never fatal) → starts the scheduler → records `system.startup`.
   `stop()` reverses it (scheduler → adapters → modules in reverse → audit →
   `onShutdown`). `installProcessHandlers()` wires SIGINT/SIGTERM with a 10s
   forced-exit timeout. (`packages/core/src/kernel.ts`.)

5. **Two error boundaries, both centered on `UserFacingError.safeMessage`.**
   - Command dispatch boundary in `ModuleRegistry.createDispatcher`
     (`registry.ts`): unknown command, guild-only check, disabled-module check,
     `try/catch` around execute, success/error audit, and **only**
     `toSafeUserMessage(error)` ever reaches the user. Raw error text is never
     put into the audit metadata or the reply.
   - Admin boundary in `apps/admin/src/server.ts` `setErrorHandler` /
     `setNotFoundHandler`: friendly EJS error pages, real error only to logs.

6. **Event boundary mirrors the command boundary.**
   `ModuleRegistry.createEventDispatcher` routes a `PlatformEvent` to all
   subscribed handlers of enabled modules, isolating each handler in a
   `try/catch` so one module's failure can't break others or the adapter
   (`registry.ts` lines 68-89). The Discord adapter translates gateway events
   (`GuildMemberAdd`, `MessageCreate`, button/select interactions) into the
   adapter-neutral `PlatformEvent` union (`adapter.ts`).

7. **Scheduler is a DB-backed in-process ticker, not a cron daemon.** Modules
   register named `ScheduledJob`s (`intervalMs` + `run`); each job queries the
   DB for due work. An overlap guard (`inFlight` set) skips a tick if the prior
   run is still going, preventing double-send; a failing job is caught and
   retried next tick (`scheduler.ts`). The bot registers 4 jobs: announcements,
   scheduled-messages, reminders, birthdays (`apps/bot/src/main.ts` 143-146).

8. **Bot↔admin coupling is a single, narrow, token-guarded HTTP seam.** The
   contract is `packages/shared/src/internal-api.ts` (paths, header name,
   `InternalBotStatus` shape). The bot serves it in
   `apps/bot/src/internal-api.ts` on `HEALTH_PORT` (8081); the admin calls it
   via `apps/admin/src/bot-client.ts` using `BOT_INTERNAL_URL`. Auth is a shared
   secret `INTERNAL_API_TOKEN` in header `x-internal-token`, compared with
   `timingSafeEqualStrings`. **The admin has no Discord connection** — it writes
   to the DB (announcements, settings) and the bot's scheduler delivers; live
   audio control is the only thing it does through the internal API.

9. **Module enable/disable is data-driven and cached.** `CachedModuleState`
   wraps the DB-backed `ModuleStatePort` with a 10s TTL and a "last known value
   / default enabled" fallback so a DB hiccup never silences the bot
   (`module-state.ts`). The admin's `/modules` toggle flips a `modules` table
   row; the dispatcher re-checks `isEnabled` on every command/event.

10. **Discord connectivity is intentionally non-fatal to container health.**
    `apps/bot/src/main.ts` (149-160) registers a `discord` health indicator that
    **always reports `ok`** and carries the real state as `detail`, so an
    expired token can't trigger a Docker restart loop. The real state surfaces
    on the admin dashboard.

## Layer-by-layer responsibilities (verified)

| Layer | Package / dir | Responsibility | Knows about… |
|---|---|---|---|
| Cross-cutting | `packages/shared` | Error types + the golden rule, `MODULE_KEYS`/`ADAPTER_KEYS`, internal-API contract, DTOs (`QueueSnapshot`, `TrackSummary`), util | nothing (zero workspace deps) |
| Config | `packages/config` | zod-validated `AppConfig` from env; never logs secret values | `shared` |
| Logging | `packages/logger` | pino factory | (none verified here) |
| Core / kernel | `packages/core` | Contracts + `BotKernel`, `ModuleRegistry`, `Scheduler`, `HealthAggregator`, `CachedModuleState`. The error boundary. | `config`, `logger`, `shared` only |
| Security | `packages/security` | argon2, token compare (`timingSafeEqualStrings`), SSRF URL validation + safe stream | (used by db + admin + bot) |
| Persistence | `packages/database` | Drizzle client + single schema, migrations, seed, repositories, and **port implementations** (`createDbAuditLog`, `createDbModuleState`, `createDbHealthIndicator`) | `core` (for port types), `logger`, `security`, `shared` |
| Adapter | `packages/discord-adapter` | The only place discord.js lives. Implements `ChannelAdapter` + `GuildServiceProvider`; maps gateway↔core contracts; voice sessions | `core`, `config`, `logger`, `shared`, discord.js |
| Modules | `packages/*-module` | Feature logic; speak only core contracts. Each: `index.ts` factory + `commands.ts`/`service.ts`/`repo.ts` | `core`, `config`, `logger`, `shared`, `database` (DB modules) |
| Bot app | `apps/bot` | Composition root; wires everything; serves internal API | every package |
| Admin app | `apps/admin` | Fastify SSR panel; reads/writes DB; calls bot internal API; per-module route plugins | `core`, `config`, `database`, `logger`, `security`, `shared`, module packages (for repos/validation), Fastify plugins |

## Dependency flow (confirmed via package.json)

- `shared` → (nothing).
- `config` → `shared`.
- `core` → `config`, `logger`, `shared`. **No db, no discord, no modules.**
- `database` → `core`, `logger`, `security`, `shared`.
- `discord-adapter` → `core`, `config`, `logger`, `shared`, discord.js, @discordjs/voice.
- module (announcements) → `core`, `config`, `database`, `logger`, `shared`, drizzle-orm.
- `apps/bot` → ALL packages + the 11 module packages + discord.js/voice/opus + fastify.
- `apps/admin` → `core`, `config`, `database`, `logger`, `security`, `shared` +
  10 module packages (for their repos/validation/case-repo) + fastify plugins +
  ejs. **`apps/admin` does NOT depend on `discord-adapter`** — confirming it has
  no Discord connection.

Direction is acyclic and points inward toward `shared`/`core`. The dependency
inversion is real: `database` depends on `core` (to implement `core`'s port
*interfaces*), not the reverse.

## Patterns in use (verified)

- **Ports & adapters / hexagonal.** Ports: `ChannelAdapter`, `GuildService(Provider)`,
  `VoiceCapability/VoiceSession/AudioStreamSource`, `AuditLogPort`,
  `ModuleStatePort`, `HealthIndicator`. Adapters: `DiscordAdapter`, the `db*`
  port factories, `CachedModuleState`.
- **Dependency injection via factories + constructor.** No DI container — plain
  factory functions return handles; the bot app injects everything into
  `new BotKernel({...})`.
- **Module registry + dispatcher.** `ModuleRegistry` indexes modules, commands,
  and event handlers; rejects duplicate module keys and command-name collisions
  at registration (fail-fast `PlatformError('INTERNAL', …)`).
- **Error boundary.** `UserFacingError.safeMessage` is the only text crossing to
  users (`toSafeUserMessage`). Audit metadata also gets only safe text.
- **Repository pattern.** Each DB module owns a `repo.ts`/`repositories/*`; the
  admin imports the same repo factories so panel and bot share one data access
  layer.
- **Plugin architecture (admin).** Each community module contributes one
  `AdminRoutePlugin` registered in `routes/index.ts`; `placeholders.ts` is the
  catch-all kept last.
- **Capability objects.** `CommandContext.voice` is a per-invocation
  `VoiceCapability` scoped to the calling user+guild — voice is null when the
  adapter has none or the command isn't in a guild.

## High-coupling / risky areas

1. **`apps/bot/src/main.ts` is a large composition root** (~190 lines) that must
   wire each new module by hand (build handle → add to `modules[]` → register
   scheduler job). It also hand-builds a "discord always-ok" health indicator
   inline — easy to forget the rationale; well-commented today.
2. **`register-commands.ts` re-instantiates a subset of modules** just to harvest
   command shapes, using a `NOOP_GUILD_PROVIDER`. This duplicates the module
   list from `main.ts` — a module with commands could be added to `main.ts` but
   forgotten here (it has audio/moderation/announcements/role-menus/
   custom-commands/reminders/birthdays; modules with no commands like welcome
   are correctly absent, but the list is a manual mirror).
3. **Two parallel module-key sources.** `MODULE_KEYS` in `shared` is the
   canonical key set, but each `create*Module` also hard-codes `name`/`key`. The
   seed (`packages/database/src/seed.ts`) must list the same keys. Three places
   must agree for a module to appear enabled in the panel.
4. **Admin↔bot coupling is loose at runtime but tight at the contract.** Both
   sides import `INTERNAL_API_PATHS`/`InternalBotStatus` from `shared`, so a
   contract change is type-checked across both — good. The risk is purely
   operational: `BOT_INTERNAL_URL`/`INTERNAL_API_TOKEN` must match between the
   two containers.
5. **The admin imports several module packages only for repos/validation**
   (e.g. `createModerationCasesRepo`, `validateAnnouncement`,
   `createAnnouncementRepo`). This couples the SSR app to module internals; if a
   module relocates a repo export, the admin build breaks.
6. **Source consumed as TS (`main`/`types` = `./src/index.ts`).** Every package
   points at raw TS; this relies on tsup inlining at build and tsx at dev. A
   stray non-type runtime import from a "types-only" package would be bundled.

## Recommendations

- Treat `apps/bot/src/main.ts` as the single source of truth for "what modules
  ship"; keep `register-commands.ts` and `seed.ts` in lockstep when adding one.
- When adding a module: add the key to `MODULE_KEYS` (`shared/src/types.ts`),
  add a seed row (`database/src/seed.ts`), wire it in `main.ts`, and (if it has
  commands) in `register-commands.ts`. The "where to add features" section in
  `docs/technical/architecture.md` enumerates this.
- Keep the no-throw contracts intact: `AuditLogPort.record`, `GuildService`
  methods, and `BotStatusClient` are all documented as never-throw — preserve
  that when extending.

## What remains to verify (handoff)

- `packages/security/src/*` internals (only the `timingSafeEqualStrings` usage
  and SSRF-validation responsibility were confirmed by call sites, not by
  reading the implementation this pass).
- `packages/database/src/seed.ts` exact module-key list (the inventory says 11
  built-in rows; not re-read line-by-line here).
- The non-reference modules (moderation services folder, cards renderer,
  role-menus/automod/reminders/birthdays/scheduled-messages/custom-commands)
  follow the same factory pattern per the inventory, but only audio +
  announcements + welcome were read in full this pass.
- `packages/logger/src` (factory shape assumed from usage).

---

## Checkpoint

Status: PASS

### Validat
- Core layering: `core` depends only on `config`/`logger`/`shared`
  (`packages/core/package.json`); no discord/db/module deps. Verified.
- All eight core contract files read; `BotModule`, `CommandContext`,
  `ChannelAdapter`, `VoiceCapability/VoiceSession/AudioStreamSource`,
  `AuditLogPort/ModuleStatePort/HealthIndicator`, `PlatformEvent`,
  `GuildService(Provider)` documented from source.
- Module lifecycle (register → dispatchers → onLoad → adapter start →
  scheduler → audit) read in `kernel.ts`; adapter-failure isolation confirmed.
- Both error boundaries read (`registry.ts` command/event dispatch;
  `server.ts` Fastify handler) and `UserFacingError` rule in `errors.ts`.
- Bot↔admin seam confirmed end-to-end: shared contract
  (`internal-api.ts`) ↔ bot server (`apps/bot/src/internal-api.ts`) ↔ admin
  client (`apps/admin/src/bot-client.ts`), token + `x-internal-token` header,
  `timingSafeEqualStrings`. Admin has NO `discord-adapter` dep (verified in
  `apps/admin/package.json`).
- Module factory pattern verified across audio, announcements, welcome.
- Dependency graph confirmed via 7 `package.json` files.
- Composition root (`apps/bot/src/main.ts`) read in full; 11 modules + 4
  scheduler jobs + 2 health indicators wiring confirmed.
- Admin plugin routing verified (`routes/index.ts`, `context.ts`,
  `announcements.ts`, `placeholders.ts`).

### Nevalidat
- `packages/security/src/*` implementation (only call sites read).
- Full `seed.ts` module-key list (relied on inventory).
- 8 of the 11 modules read only as the inventory describes (audio +
  announcements + welcome read in full).
- `packages/logger/src` implementation.

### Probleme
- `apps/bot/src/main.ts`, `register-commands.ts`, and `seed.ts` each maintain a
  manual module list that must stay in sync (coupling, not a bug).
- Admin imports module-internal repos/validation, coupling SSR app to module
  internals.
- Three-place agreement (`MODULE_KEYS` + factory + seed) required for a module
  to surface correctly in the panel.

### Următorul agent poate continua?
Da. The architecture, contracts, lifecycle, dependency flow, bot↔admin seam,
patterns, risks, and the "add a feature" guide are all verified against source
and captured here + in `docs/technical/architecture.md`. A later agent can
extend specific modules (read the remaining 8 module `index.ts` files, all of
which follow the verified factory pattern) or deep-dive `security`/`logger`
internals without re-deriving the overall structure.
