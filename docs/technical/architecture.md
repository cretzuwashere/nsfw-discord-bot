# Architecture

> **Project:** botplatform — a Docker-first, modular Discord bot platform.
> **Scope verified on disk:** 2026-06-27 against the working tree.
> **Tagging convention:** every non-trivial claim is marked `[verified in code]`
> (read directly from source this pass), `[deduced]` (inferred from verified
> facts), or `[documented-elsewhere-unverified]` (taken from other docs/brief,
> not re-read here).
> **Host note:** the Windows host has NO Node/pnpm/ffmpeg/psql/Playwright.
> Everything runs in Linux Docker containers; every workspace command is run as
> `docker compose exec app pnpm ...`.

---

## 1. One-paragraph overview

botplatform is a **layered, hexagonal (ports-and-adapters)** TypeScript
monorepo. A platform-agnostic **core kernel** (`@botplatform/core`) owns startup
order, the command/event routing, the error boundary and graceful shutdown, and
knows *nothing* about Discord. **Feature modules** (20 of them) are
adapter-agnostic plugins that speak only in core contracts. A single
**channel adapter** (`@botplatform/discord-adapter`) translates Discord gateway
traffic into those contracts in both directions. Two **apps** compose everything:
`apps/bot` is the worker (kernel + adapter + all modules + scheduler + a
token-guarded internal HTTP API), and `apps/admin` is a Fastify SSR control
panel that talks to the worker over the Docker network. Persistence is Drizzle
+ Postgres, exposed to core only through narrow **ports**. `[verified in code]`

---

## 2. Layered / hexagonal design

```
                          ┌──────────────────────────────────────────────┐
                          │                  apps/admin                   │
                          │  Fastify SSR panel (EJS). Login, dashboard,   │
                          │  module toggles, per-guild settings, audit.   │
                          │  Reads/acts via the bot internal API (HTTP).  │
                          └───────────────────────┬──────────────────────┘
                                                  │  HTTP (Docker network,
                                                  │  token-guarded /internal/*)
                                                  ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                                apps/bot                                    │
   │  Composition root (main.ts): builds DB/audit/state, the adapter, ALL 20   │
   │  module handles, the BotKernel, registers scheduler jobs + health, then    │
   │  serves the internal API (internal-api.ts).                                │
   └───────┬───────────────────────────────────────────────────────┬──────────┘
           │ depends on                                             │ depends on
           ▼                                                        ▼
   ┌───────────────────────────┐      core contracts only   ┌──────────────────┐
   │   @botplatform/core       │◄───────────────────────────│  20 feature       │
   │  (the hexagon's centre)   │   (BotModule, CommandCtx,   │  modules          │
   │  BotKernel, ModuleRegistry│    PlatformEvent, ports…)   │  packages/*-module│
   │  Scheduler, Health,       │                            └─────────┬─────────┘
   │  CachedModuleState,       │                                      │ act on guilds
   │  contracts/* (ports)      │◄─────────────────────────────────────┘ via
   └──────────┬────────────────┘   implements ports        GuildServiceProvider
              │ ChannelAdapter, GuildServiceProvider,
              │ Voice* are PORTS implemented by →
              ▼
   ┌─────────────────────────────┐      ┌───────────────────────────────────────┐
   │ @botplatform/discord-adapter │     │ @botplatform/database (driven adapter) │
   │  discord.js ↔ core contracts │     │  Drizzle/Postgres impl of AuditLogPort,│
   │  gateway events → Platform   │     │  ModuleStatePort, repos, migrations,   │
   │  Events; commands ← registry │     │  seed.                                 │
   │  GuildService impl, Voice    │     └───────────────────────────────────────┘
   └──────────┬───────────────────┘
              │ discord.js / @discordjs/voice
              ▼
        ┌──────────┐
        │ Discord  │  (gateway + REST + voice)
        └──────────┘

Infra packages used everywhere: @botplatform/shared (types, MODULE_KEYS,
errors, placeholders), @botplatform/config (zod env loader), @botplatform/logger
(pino), @botplatform/security (argon2, tokens, SSRF-safe URLs, safe-stream).
```
`[verified in code: kernel.ts, registry.ts, contracts/*, main.ts, internal-api.ts, server.ts, bot-client.ts, adapter.ts]`

**Dependency rule (the whole point of the hexagon).** Arrows point *inward*
toward `core`. `core` imports only `@botplatform/config`, `@botplatform/logger`,
and `@botplatform/shared` — never `database` and never `discord-adapter`. The DB
and Discord are **driven/driving adapters** that implement core's port
interfaces. Modules depend on `core` (contracts) and `database` (their own
repos) but **never** on `discord-adapter`. `[verified in code: core/src/* import lines;
welcome-module/src/index.ts imports from core + database + shared only]`

### The 20 feature modules (all wired in `apps/bot/src/main.ts`)

| MODULE_KEYS key | key string | package | factory | has slash cmds? | scheduler job? | events |
|---|---|---|---|---|---|---|
| `audioPlayer` | `audio-player` | `audio-module` | `createAudioModule` | yes | — | — |
| `moderation` | `moderation` | `moderation-module` | `createModerationModule` | yes | — | — |
| `announcements` | `announcements` | `announcements-module` | `createAnnouncementsModule` | yes | `schedulerJob` | — |
| `welcome` | `welcome` | `welcome-module` | `createWelcomeModule` | no | — | member.join, member.leave |
| `dynamicCards` | `dynamic-cards` | `cards-module` | `createCardsModule` | no | — | — |
| `roleMenus` | `role-menus` | `role-menus-module` | `createRoleMenusModule` | yes | — | component.interaction |
| `birthdays` | `birthdays` | `birthdays-module` | `createBirthdaysModule` | yes | `schedulerJob` | — |
| `reminders` | `reminders` | `reminders-module` | `createRemindersModule` | yes | `schedulerJob` | — |
| `scheduledMessages` | `scheduled-messages` | `scheduled-messages-module` | `createScheduledMessagesModule` | no | `schedulerJob` | — |
| `automod` | `automod` | `automod-module` | `createAutomodModule` | no | — | message.create |
| `customCommands` | `custom-commands` | `custom-commands-module` | `createCustomCommandsModule` | yes | — | — |
| `raiseHand` | `raise-hand` | `raise-hand-module` | `createRaiseHandModule` | yes | — | component.interaction, voice.state.update |
| `funCommands` | `fun-commands` | `fun-commands-module` | `createFunCommandsModule` | yes | — | — |
| `engagementPrompts` | `engagement-prompts` | `engagement-prompts-module` | `createEngagementPromptsModule` | yes | `schedulerJob` | — |
| `giveaways` | `giveaways` | `giveaways-module` | `createGiveawaysModule` | yes | `schedulerJob` | component.interaction |
| `serverStats` | `server-stats` | `server-stats-module` | `createServerStatsModule` | yes | `schedulerJobs` (plural) | message.create |
| `trivia` | `trivia` | `trivia-module` | `createTriviaModule` | yes | `schedulerJobs` (plural) | component.interaction |
| `minigames` | `minigames` | `minigames-module` | `createMinigamesModule` | yes | `schedulerJob` | component.interaction |
| `economy` | `economy` | `economy-module` | `createEconomyModule` | yes | — | — |
| `levels` | `levels` | `levels-module` | `createLevelsModule` | yes | — | message.create |

> The factory list and `BotKernel({ modules: [...] })` array are `[verified in code:
> main.ts:51–193]`. The "scheduler job?" column is `[verified in code: main.ts:204–212]`.
> The **"has slash cmds?"** column is `[verified in code: register-commands.ts:130–147]`
> (a module is "yes" iff its commands are spread there; the 4 "no" modules are
> intentionally absent because they have no slash commands). The **"events"**
> column is `[deduced]` from the wiring patterns seen in `welcome-module` and the
> adapter's event emission; **treat per-module event detail as deduced until the
> MODULES agent verifies each package's `index.ts`.**

---

## 3. Core contracts (the ports at the centre)

All of these live in `packages/core/src/contracts/` and are re-exported from
`@botplatform/core` (`packages/core/src/index.ts`). `[verified in code]`

### `BotModule` — `contracts/module.ts`
The plugin contract every feature implements.

```ts
interface BotModule {
  readonly key: string;          // stable, == DB row key (MODULE_KEYS in shared)
  readonly name: string;
  readonly description: string;
  readonly commands: CommandDefinition[];
  readonly metadata?: ModuleMetadata;     // requiredPermissions/Intents, configSchema, auditEvents
  readonly events?: ModuleEventHandler[]; // subscriptions to PlatformEvents
  onLoad?(ctx: ModuleContext): Promise<void> | void;
  onShutdown?(): Promise<void> | void;
}
```
- `ModuleMetadata` is *declarative* data for the admin panel and status views:
  `requiredPermissions`, `requiredIntents`, a `configSchema` (typed
  `ConfigFieldSchema[]`), and `auditEvents`. `[verified in code: module.ts:13–35]`
- `ModuleEventHandler<T>` ties a `PlatformEventType` to a typed `handle(event)`.
  `[verified in code: module.ts:38–41]`

### `ModuleRegistry` — `registry.ts`
Holds modules, indexes their commands by name, collects event handlers, and
builds the two dispatchers. It enforces two invariants at registration:

- **No duplicate module key** → throws `PlatformError('INTERNAL', "Module 'x' registered twice")`.
- **No command-name collision across modules** → throws `PlatformError('INTERNAL', …conflicts…)`.

`[verified in code: registry.ts:32–49]` This is the platform's fail-fast guard
against two modules claiming the same command name.

### `BotKernel` — `kernel.ts`
The composition core. **Contains no Discord-specific logic.** Owns:
- startup order (see §4),
- the command **error boundary** (via the dispatcher),
- adapter isolation (an adapter that fails to start is logged + audited but does
  **not** crash the platform — `kernel.ts:91–100`),
- a `Scheduler` and a `HealthAggregator`,
- graceful shutdown + `installProcessHandlers()` (SIGINT/SIGTERM with a 10s
  forced-exit timeout; `uncaughtException` stops then exits; `unhandledRejection`
  is logged only). `[verified in code: kernel.ts:147–177]`

### `CommandContext` — `contracts/commands.ts`
Adapter-agnostic view of ONE command invocation, built by the adapter and
consumed by module handlers. Carries `commandName`, `subcommand`, `adapterKey`,
`guildId`, `channelId`, `user`, `options`, `logger`, a nullable
`voice: VoiceCapability | null`, plus `defer()`, `reply()`, and an optional
`replyRich()` for embeds/buttons/attachments. `CommandDefinition` supports flat
commands, `subcommands`, `guildOnly`, and `defaultMemberPermissions` (Discord
visibility gating). `[verified in code: commands.ts:24–72]`

### `ChannelAdapter` — `contracts/adapter.ts`
The driving-adapter port: `start(ctx)`, `stop()`, `getStatus()`. `AdapterContext`
hands the adapter the `commands` (from the registry), the `dispatch`
(CommandDispatcher) and `dispatchEvent` (EventDispatcher) callbacks. `[verified in
code: adapter.ts:8–37]`

### The 5 PlatformEvents — `contracts/events.ts`
Adapter-neutral events; the Discord adapter translates gateway events into these
and a future Slack/Telegram adapter would emit the same shapes. `[verified in code:
events.ts]`

| `type` | interface | notes |
|---|---|---|
| `member.join` | `MemberJoinEvent` | guild + user + `memberCount`. |
| `member.leave` | `MemberLeaveEvent` | guild + user + `memberCount`. |
| `message.create` | `MessageCreateEvent` | `content` is `''` unless the MessageContent intent is granted; carries `mentionCount`, `hasAttachments`, `authorRoleIds`. Adapter drops bot authors and non-guild messages. |
| `component.interaction` | `ComponentInteractionEvent` | button/select; `customId` routing, `values`, `userRoleIds`, `reply()`, optional `update()`. |
| `voice.state.update` | `VoiceStateUpdateEvent` | **newest**. Uses the non-privileged `GuildVoiceStates` intent (already enabled). `oldChannelId`/`newChannelId` nullable; the adapter **drops pure mute/deafen toggles** (`oldState.channelId === newState.channelId`) and bot users. |

Union type `PlatformEvent`, helper `PlatformEventType`. `[verified in code: events.ts:96–103;
adapter.ts:302–342 confirms the bot/non-guild and mute/deafen drops]`

### `GuildService` / `GuildServiceProvider` — `contracts/guild-service.ts`
The driven-adapter port modules use to *act on a guild* without touching
discord.js: send/edit/delete messages, DMs, list roles/channels, role
add/remove with `canManageRole`, and a full moderation primitive set
(`timeoutMember`, `removeTimeout`, `kickMember`, `banMember`, `unbanMember`,
`purgeMessages`, `setSlowmode`, `setChannelLocked`). Permission helpers:
- `botHasPermission(permission, channelId?)`,
- **`memberHasPermission(userExternalId, permission)`** — re-checks moderator
  gating **server-side for button interactions**, because Discord cannot gate
  *components* by permission the way it gates *commands*. `[verified in code:
  guild-service.ts:96–107]`
- `getMemberRoleIds`, `isGuildOwner`.

`GuildServiceProvider.forGuild(externalId)` returns a `GuildService | null`
(null when disconnected/unknown); `isReady()` reports adapter readiness. The
`DiscordAdapter` **implements `GuildServiceProvider` directly** and is passed to
modules as `guildServiceProvider` in `main.ts`. `[verified in code: guild-service.ts:110–116;
adapter.ts:43, 186–191; main.ts passes the adapter as guildServiceProvider]`

### Voice: `VoiceCapability` / `VoiceSession` / `AudioStreamSource` — `contracts/voice.ts`
- `AudioStreamSource`: a playable source — `createStream(): Promise<Readable>`,
  an `inputType` (`'arbitrary' | 'ogg-opus' | 'webm-opus'`; `arbitrary` means the
  adapter must transcode via ffmpeg), and `TrackSummary` metadata.
- `VoiceSession`: a live per-guild connection — `play(source, onEvent)`,
  `pause`/`resume`/`stop`/`disconnect`, plus `status`/`destroyed` and
  `PlaybackEvent` lifecycle (`started`/`finished`/`error`, each firing once).
- `VoiceCapability`: scoped to one invocation —
  `getUserVoiceChannel()`, `getActiveSession()`, `join(channelId)`. Exposed on
  `CommandContext.voice` (null outside a guild or when the adapter has no voice).
`[verified in code: voice.ts:1–58; adapter.ts:439–494 builds it from voiceSessions]`

### Ports: `AuditLogPort` / `ModuleStatePort` / `HealthIndicator` — `contracts/ports.ts`
- `AuditLogPort.record(entry)` — **must never throw** (audit failure must not
  break a feature); takes a dotted `action`, actor info, optional `moduleKey`,
  `guildId`, `severity`, target, and `metadata` (which **must never contain
  secrets or raw error stacks**). `[verified in code: ports.ts:9–27]`
- `ModuleStatePort.isEnabled(moduleKey)` — the enabled-check gate.
- `HealthIndicator` — named `check()` returning `{ status, detail }`.

`CachedModuleState` (`module-state.ts`) wraps a `ModuleStatePort` with a 10s TTL
cache so command dispatch doesn't hit the DB every invocation; on a lookup
failure it **falls back to the last known value (default: enabled)** so a DB
hiccup can't silence the bot. `[verified in code: module-state.ts]`

### Error boundary: `UserFacingError` / `PlatformError` — `@botplatform/shared/errors.ts`
The golden rule: **raw internal errors must never reach end users.**
- `PlatformError(code, message)` — internal, with a typed `PlatformErrorCode`.
- `UserFacingError(code, safeMessage)` — its `safeMessage` is the *only* error
  text allowed to cross the boundary to a Discord reply or the admin UI.
- `toSafeUserMessage(error)` returns `error.safeMessage` for a `UserFacingError`,
  else the generic `'Something went wrong while handling that…'`.
`[verified in code: errors.ts:1–58]` The command dispatcher and the Discord
adapter both funnel user-visible text through `toSafeUserMessage` /
`GENERIC_USER_ERROR`. `[verified in code: registry.ts:150; adapter.ts:208–210]`

---

## 4. Module & adapter lifecycle (load → register → wire → schedule)

`BotKernel.start()` runs a deterministic order. `[verified in code: kernel.ts:56–111]`

1. **Register modules** into the `ModuleRegistry` (one by one). This indexes
   commands (collision-checked) and collects event handlers. (`kernel.ts:63–66`)
2. **Build dispatchers** — `createDispatcher` (commands) and
   `createEventDispatcher` (events) are constructed once from the registry.
   (`kernel.ts:68–69`)
3. **`onLoad` each module** — a module failing `onLoad` is fatal and re-thrown
   (startup aborts). (`kernel.ts:71–78`)
4. **Start each adapter** with `{ logger, config, audit, commands, dispatch,
   dispatchEvent }`. An adapter that throws on `start` is **caught, logged and
   audited** (`adapter.start.error`) but does NOT abort startup. (`kernel.ts:80–101`)
5. **Start the scheduler** (`scheduler.start()` arms every registered job). (`kernel.ts:103`)
6. **Audit `system.startup`.** (`kernel.ts:105–109`)

After `kernel.start()`, `main.ts` builds and listens the **internal API**
(`buildInternalApi`) on `config.bot.healthPort`. `[verified in code: main.ts:229–247]`

**Scheduler jobs are registered in `main.ts` BEFORE `start()`** (`main.ts:204–212`),
contributed by 9 module handles. Two use a **plural `schedulerJobs` array**
(`serverStats`, `trivia`) registered in a loop; the rest expose a single
`schedulerJob`. `[verified in code]` The `Scheduler` is a minimal in-process,
DB-backed periodic runner: each job declares an `intervalMs`, has an
**overlap guard** (skips a tick if the previous run is still in flight), and a
failing job never crashes the worker (logged; next tick retries). `[verified in
code: scheduler.ts:55–78]`

**Health indicators** are registered after the kernel: a DB indicator
(`createDbHealthIndicator`) and a `discord` indicator that **always reports
`ok`** — Discord connectivity is treated as *informational* so a bad/expired
token can't make the container unhealthy and trigger restart loops; the real
state is surfaced on the admin dashboard. `[verified in code: main.ts:214–226]`

**Shutdown** (`kernel.stop()`): stop scheduler → stop adapters (best-effort) →
`onShutdown` each module in **reverse** order → audit `system.shutdown` →
`options.onShutdown()` (which closes the internal API and the DB). `[verified in
code: kernel.ts:113–145; main.ts:197–201]`

### Dispatch flows

**Command dispatch** (`registry.createDispatcher`, `registry.ts:95–153`):
1. Look up command by name; unknown → safe "Unknown command." reply.
2. `guildOnly` check vs `ctx.guildId`.
3. `moduleState.isEnabled(moduleKey)` — disabled module replies politely instead
   of executing.
4. Run the command (subcommand routing in `runCommand`, `registry.ts:157–172`).
5. Audit success (`<moduleKey>.command.<name>`).
6. On error: log, audit `<…>.error` (with a **safe** message only), and reply
   `toSafeUserMessage(error)`. `[verified in code]`

**Event dispatch** (`registry.createEventDispatcher`, `registry.ts:68–89`):
filter handlers by `event.type`, run them **concurrently** (`Promise.all`), each
gated by `moduleState.isEnabled` and **isolated in a try/catch** so one module's
failure can't break others or the adapter. `[verified in code]`

### Adapter ↔ core translation seam (`discord-adapter/src/adapter.ts`)

Inbound (Discord → core):
- `InteractionCreate` → if a chat-input command, build a `CommandContext` and
  call `ctx.dispatch(...)`; if a button/string-select, build a
  `ComponentInteractionEvent` and call `ctx.dispatchEvent(...)`. If no module
  acknowledges a component, the adapter `deferUpdate()`s so Discord doesn't show
  "interaction failed". `[verified in code: adapter.ts:195–276]`
- `GuildMemberAdd/Remove`, `MessageCreate`, `VoiceStateUpdate` →
  `member.join/leave`, `message.create`, `voice.state.update`. `[verified in code:
  adapter.ts:131–142, 278–342]`

Outbound (core → Discord): `commandsToDiscordJson` maps adapter-neutral
`CommandDefinition`s to Discord registration JSON (option type numbers,
`contexts: [0]` for guild-only, `default_member_permissions` bitfield);
`registerSlashCommands` PUTs them (guild-scoped = instant, global = slow).
`[verified in code: command-mapper.ts; register-commands.ts]`

**Privileged-intent gating.** The adapter requests the non-privileged intents
(`Guilds`, `GuildVoiceStates`, `GuildMessages`, `GuildModeration`) always, and
adds `GuildMembers` / `MessageContent` **only** when the opt-in config flags
(`enableGuildMembers` / `enableMessageContent`) are set — because requesting a
privileged intent not enabled in the Discord portal makes the gateway reject the
connection (close code 4014) and the bot won't connect at all. `[verified in code:
adapter.ts:64–84]`

---

## 5. The bot ↔ admin internal-API seam

The admin panel never imports the kernel or the adapter. It talks to the worker
over HTTP on the Docker network. `[verified in code]`

**Bot side** (`apps/bot/src/internal-api.ts`):
- Public `GET /healthz` — runs the `HealthAggregator`; 200 when `ok`, else 503.
- A token-guarded `/internal/*` plugin: every request must carry the
  `INTERNAL_TOKEN_HEADER` matching `config.bot.internalApiToken`, compared with
  **`timingSafeEqualStrings`** (constant-time). `[verified in code: internal-api.ts:48–55]`
  - `GET /internal/status` → `InternalBotStatus`: uptime, version, env, per-adapter
    status, per-module `{key,name,enabled}`, and audio `sessions` snapshots.
  - `POST /internal/audio/:guildId/{skip,stop,clear-queue}` → audio actions, each
    audited (`audio.admin.*`).

**Admin side** (`apps/admin/src/bot-client.ts`):
- `createBotClient` calls `config.bot.internalUrl` with the token header and a
  **3s timeout**, and **never throws** — on any failure `getStatus()` returns
  `null` and `audioAction` returns `{ ok:false, message:… }`, so the panel
  renders an honest "bot offline" state instead of error pages. `[verified in code:
  bot-client.ts:22–67]`

**Admin app shape** (`apps/admin/src/server.ts`):
- Fastify SSR (EJS), `@fastify/secure-session` (16-char salt), CSRF protection,
  per-route rate limiting (login 20/min), static assets, multipart (8 MB cap for
  card-background uploads). `[verified in code: server.ts:69–88]`
- Guards: `requireAuth` (redirects to `/login`) and `requireMutatingRole`
  (403s the `viewer` role; `owner`/`admin` may mutate). All mutating POSTs require
  `[requireAuth, requireMutatingRole, csrfProtection]`. `[verified in code: server.ts:123–139]`
- Its own **error boundary**: 4xx/5xx render friendly `error.ejs`; 5xx is logged
  with the real error. `[verified in code: server.ts:93–118]`
- Core pages defined directly in `server.ts`: `/healthz`, `/login`, `/logout`,
  `/dashboard`, `/modules` (+ `/modules/:key/toggle`), **`/audio`** (+ audio
  actions), `/guilds` (+ edit/settings), **`/moderation`** (+ rule toggle),
  `/audit-logs`, `/settings`. Note `/audio` and `/moderation` live in `server.ts`,
  **not** in `routes/`. `[verified in code: server.ts:282, 386]`
- Community module pages are registered via `COMMUNITY_ROUTE_PLUGINS` — one
  import + one array entry per module — each plugin receiving a shared
  `AdminRouteContext` (config, db, logger, audit, botClient, the three guards,
  and `pageLocals`). `[verified in code: routes/index.ts; routes/context.ts; server.ts:491–505]`

---

## 6. Patterns in use

- **Hexagonal / ports-and-adapters.** Core defines ports; `discord-adapter` and
  `database` implement them. `[verified in code]`
- **Factory functions + handle objects.** Every module is a
  `createXModule(options): { module, schedulerJob?, service?, … }` factory; the
  app composes handles. (e.g. `welcome-module/src/index.ts`.) `[verified in code]`
- **Dependency injection via the composition root.** `main.ts` is the single
  place that wires DB, audit, state, adapter and modules together. `[verified in code]`
- **Adapter-neutral DTOs.** `CommandContext`, `PlatformEvent`, `OutgoingMessage`,
  `TrackSummary` etc. keep modules platform-free. `[verified in code]`
- **Error boundary as a first-class type** (`UserFacingError.safeMessage`).
  `[verified in code]`
- **Fail-fast registration** (duplicate module/command names throw at startup).
  `[verified in code: registry.ts:33–44]`
- **Fault isolation everywhere:** adapter-start failures, scheduler-job failures,
  and per-handler event failures are all caught so one fault can't cascade.
  `[verified in code: kernel.ts, scheduler.ts, registry.ts]`
- **Defense in depth on permissions:** Discord gates *commands* via
  `defaultMemberPermissions`; *button* interactions are re-checked server-side via
  `GuildService.memberHasPermission`. `[verified in code]`
- **Read cache with safe fallback** (`CachedModuleState`). `[verified in code]`
- **Secrets discipline:** constant-time token compare; explicit allowlist of
  config rendered on `/settings`; allowed-mentions default to no pings in
  `OutgoingMessage`. `[verified in code: internal-api.ts:52; server.ts:457–477;
  guild-service.ts OutgoingMessage:43–44]`

---

## 7. High-coupling / fragile areas

### 7.1 THE THREE-PLACE (really FOUR-PLACE) module wiring  ⚠️ headline fragility
A new module's existence is asserted in **four separate files that must agree**,
none of which is derived from the others:

1. **`packages/shared/src/types.ts` → `MODULE_KEYS`** — the canonical key string
   (the DB row key). `[verified in code]`
2. **`apps/bot/src/main.ts`** — `import { createXModule }`, build the handle,
   add `xHandle.module` to `BotKernel({ modules: [...] })`, and (if applicable)
   register `xHandle.schedulerJob(s)`. `[verified in code: main.ts]`
3. **`packages/database/src/seed.ts`** — add a `builtInModules` entry
   (`key/name/description/defaultEnabled`) so the row is seeded and the admin
   panel can toggle it. **All 20 are present here.** `[verified in code: seed.ts]`
4. **`apps/bot/src/register-commands.ts`** — a **manual mirror** of `main.ts`
   that re-instantiates each command-bearing module (with a `NOOP_GUILD_PROVIDER`)
   and spreads `x.module.commands` into the `commands` array. **If a new module
   with slash commands is added to `main.ts` but forgotten here, its commands are
   never registered with Discord** even though the runtime handler exists.
   `[verified in code: register-commands.ts:130–147]`

There is **no single registry array** the four places read from; they are kept in
sync by hand. This is the most error-prone part of adding a module.

> Note: `register-commands.ts` intentionally omits the 4 modules with no slash
> commands (`welcome`, `dynamic-cards`, `scheduled-messages`, `automod`). It
> currently spreads commands for the 16 command-bearing modules. `[verified in code]`

### 7.2 Admin surface gap — 9 of 20 modules have ZERO admin UI  ⚠️ real gap
**Have a real admin page (11):** `audio-player` and `moderation` (defined inline
in `server.ts`), plus `announcements`, `welcome`, `dynamic-cards` (cards),
`role-menus`, `birthdays`, `scheduled-messages`, `automod`, `custom-commands`
(routes/*), and `reminders` (placeholder page only — read-only description, no
editor). `[verified in code: server.ts; routes/index.ts; placeholders.ts]`

**NO dedicated route, NO `.ejs` view, NOT in the command catalog (9):**
`raise-hand`, `fun-commands`, `engagement-prompts`, `giveaways`, `server-stats`,
`trivia`, `minigames`, `economy`, `levels`. Corroborated three ways:
- `COMMUNITY_ROUTE_PLUGINS` lists 9 module plugins + the placeholder; none of the
  9 newest. `[verified in code: routes/index.ts:18–29]`
- `apps/admin/src/command-catalog.ts` has only **11 keys** (`audio-player,
  announcements, role-menus, birthdays, reminders, moderation, custom-commands,
  welcome, dynamic-cards, scheduled-messages, automod`) → the 9 newest don't even
  appear on the read-only `/commands` page. `[verified in code: 11 `key:` entries]`
- No `.ejs` views exist for any of the 9 (`apps/admin/views/` listing).
  `[verified in code]`

These 9 modules are fully wired in the **runtime** (`main.ts`) and seeded
(`seed.ts`) so they can be enabled/disabled from the generic `/modules` toggle
page and used in Discord — but they have **no config UI**. This is a genuine
coverage gap for the MODULES agent to scope.

### 7.3 Other fragile seams
- **`customId` routing is a stringly-typed convention.** Component interactions
  are routed by the `customId` prefix the originating module encoded
  (e.g. `rolemenu:<id>`); there is no central registry, so two modules picking the
  same prefix would both receive the event and must defensively check it.
  `[verified in code: events.ts:56–60; adapter.ts:219–275 dispatches all
  buttons/selects as one event stream]`
- **Command-name uniqueness is global** across all modules (registry throws on
  collision), so module authors must avoid name clashes. `[verified in code:
  registry.ts:38–44]`
- **`command-catalog.ts` is a hand-curated mirror** of each module's command
  definitions (its own comment says the definitions are the source of truth);
  it drifts unless updated. `[verified in code: command-catalog.ts:1–25]`
- **Privileged-intent dependency.** A module whose `metadata.requiredIntents`
  includes a privileged intent (`GuildMembers`/`MessageContent`) silently no-ops
  if the matching opt-in flag/portal toggle is off — there is no startup check
  that a needed intent is actually enabled. `[verified in code: adapter.ts:64–84;
  module.ts requiredIntents is declarative only]`

---

## 8. How to add a new module (reference: `welcome-module`)

Use `packages/welcome-module` as the template — it shows events + a service +
repo without commands; for a command-bearing example see `custom-commands-module`.
All commands run inside Docker.

1. **Create the package** `packages/<name>-module/` with `package.json`
   (`@botplatform/<name>-module`, `catalog:` version pins), `tsconfig.json`, and
   `src/index.ts` exporting a `create<Name>Module(options): { module, … }`
   factory. Put data access in `src/repo.ts` and behavior in `src/service.ts`
   (the welcome pattern). `[verified in code: welcome-module/src/index.ts]`
2. **Add the key** to `MODULE_KEYS` in `packages/shared/src/types.ts`. Use
   `MODULE_KEYS.<name>` as `module.key` (it IS the DB row key). `[verified in code]`
3. **Implement `BotModule`**: set `name`, `description`, `commands`,
   `metadata` (`requiredPermissions`, `requiredIntents`, `configSchema`,
   `auditEvents`), and `events` (each `{ type, handle }`). Act on guilds only via
   the injected `GuildServiceProvider` — never import discord.js. `[verified in code:
   welcome-module/src/index.ts:42–61]`
4. **Wire it in `apps/bot/src/main.ts`**: import the factory, build the handle
   (passing `config/logger/db/audit/guildServiceProvider` as needed — see the
   existing calls), and add `xHandle.module` to the `BotKernel({ modules })`
   array. If it has a scheduler job, `kernel.scheduler.register(xHandle.schedulerJob)`
   (or loop `schedulerJobs`). `[verified in code: main.ts]`
5. **Seed it** in `packages/database/src/seed.ts` — add a `builtInModules` entry
   (`key, name, description, defaultEnabled`). `[verified in code: seed.ts]`
6. **If it has slash commands, mirror it in
   `apps/bot/src/register-commands.ts`** — instantiate it with
   `NOOP_GUILD_PROVIDER` and spread `x.module.commands` into the `commands` array.
   **This is the easy step to forget (see §7.1).** `[verified in code]`
7. **Migrations** for any new tables: edit `packages/database/src/schema.ts` then
   `docker compose exec app pnpm db:generate` (creates a new
   `packages/database/migrations/00XX_*` file), and `docker compose exec app pnpm
   db:migrate`. `[verified in code: db:generate/db:migrate scripts]`
8. **(Recommended) add an admin page** — see §10 — and a `command-catalog.ts`
   entry so the module is not part of the §7.2 gap.
9. **Register & verify:**
   ```bash
   docker compose exec app pnpm build
   docker compose exec app pnpm typecheck
   docker compose exec app pnpm discord:register-commands
   docker compose exec app pnpm test
   ```

## 9. How to add a command (to an existing module)

1. In the module's `src/index.ts` add a `CommandDefinition` to `module.commands`
   (or a `SubcommandDefinition` to a command's `subcommands`). Set `name`,
   `description`, `options` (`CommandOptionDef[]`), `guildOnly`,
   `defaultMemberPermissions` (Discord visibility gating), and `execute(ctx)`.
   `[verified in code: commands.ts:48–72]`
2. In `execute`, use `ctx` only: `ctx.options`, `ctx.user`, `ctx.guildId`,
   `ctx.voice`, `ctx.defer()/reply()/replyRich()`. Throw a `UserFacingError` for
   anything the user should see; the dispatcher's boundary handles the rest.
   `[verified in code: registry.ts:134–151]`
3. Command **name must be globally unique** across all modules (registry throws
   otherwise). `[verified in code: registry.ts:38–44]`
4. Ensure the owning module is spread in `register-commands.ts` (it is, if the
   module already had commands), then:
   ```bash
   docker compose exec app pnpm discord:register-commands
   ```
   Guild-scoped registration (`DISCORD_GUILD_ID` set) is instant; global
   registration can take up to an hour. `[verified in code: register-commands.ts:158–161]`
5. (Optional) add the command to `apps/admin/src/command-catalog.ts` so it
   appears on the `/commands` page. `[verified in code]`

## 10. How to add an admin page (reference: `apps/admin/src/routes/welcome.ts`)

1. Create `apps/admin/src/routes/<module>.ts` exporting an `AdminRoutePlugin`:
   `export const register<Name>Routes: AdminRoutePlugin = (app, ctx) => { … }`.
   `[verified in code: routes/context.ts:29–30; routes/welcome.ts:8]`
2. Inside, build the repos you need from `ctx.db` (e.g.
   `createWelcomeRepo(ctx.db)`), and register routes:
   - `GET` page with `{ preHandler: ctx.requireAuth }`, rendering an EJS view via
     `reply.view('<view>', { ...ctx.pageLocals(request, reply, 'Title'), … })`.
   - `POST` save with `{ preHandler: [ctx.requireAuth, ctx.requireMutatingRole,
     ctx.csrfProtection] }`, validate input, persist, then
     `ctx.audit.record({ … moduleKey, guildId, … })` and redirect. `[verified in code:
     routes/welcome.ts:13–65]`
3. Create the matching `apps/admin/views/<view>.ejs` (the `<form>` posts a
   `_csrf` field from `csrfToken`). Add a sidebar link in
   `apps/admin/views/partials/nav.ejs`. `[verified in code: views/ listing; welcome.ejs exists]`
4. **Register the plugin** in `apps/admin/src/routes/index.ts`: add the import and
   an entry to `COMMUNITY_ROUTE_PLUGINS` **before** the placeholder plugin (which
   must stay last). If the module had a placeholder path, remove it from
   `placeholders.ts`. `[verified in code: routes/index.ts:18–29; placeholders.ts:5–11]`
5. Verify:
   ```bash
   docker compose exec app pnpm --filter @botplatform/admin build
   docker compose exec app pnpm test:e2e        # admin page reachability
   ```

---

## 11. Quick file map (architecture-relevant)

| Concern | File |
|---|---|
| Kernel / lifecycle | `packages/core/src/kernel.ts` |
| Registry + dispatchers + error boundary | `packages/core/src/registry.ts` |
| Scheduler | `packages/core/src/scheduler.ts` |
| Health aggregation | `packages/core/src/health.ts` |
| Module-state cache | `packages/core/src/module-state.ts` |
| Contracts (ports) | `packages/core/src/contracts/{module,commands,adapter,events,guild-service,ports,voice}.ts` |
| Error types | `packages/shared/src/errors.ts` |
| Module keys (canonical) | `packages/shared/src/types.ts` |
| Discord adapter (driving + GuildServiceProvider + voice) | `packages/discord-adapter/src/{adapter,guild-service,voice-session,command-mapper,register-commands}.ts` |
| Bot composition root | `apps/bot/src/main.ts` |
| Bot internal API | `apps/bot/src/internal-api.ts` |
| Command registration mirror | `apps/bot/src/register-commands.ts` |
| DB seed (module bootstrap) | `packages/database/src/seed.ts` |
| Admin server + core pages | `apps/admin/src/server.ts` |
| Admin route plugin registry | `apps/admin/src/routes/index.ts` |
| Admin route context/contract | `apps/admin/src/routes/context.ts` |
| Admin → bot client | `apps/admin/src/bot-client.ts` |
| Command catalog (curated) | `apps/admin/src/command-catalog.ts` |
