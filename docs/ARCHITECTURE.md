# Architecture

The platform is a **modular monorepo**: a platform-agnostic bot core, channel
adapters, feature modules, a database layer behind ports, and a separate
admin app. Discord and audio playback are the *first* adapter and module —
not hard-wired assumptions.

```
                ┌────────────────────────── apps/bot ──────────────────────────┐
                │  BotKernel (packages/core)                                   │
 Discord ◄──────┤   ├── ChannelAdapter ◄── packages/discord-adapter            │
                │   ├── BotModule      ◄── packages/audio-module               │
                │   ├── BotModule      ◄── packages/moderation-module          │
                │   ├── AuditLogPort / ModuleStatePort / HealthIndicator       │
                │   └── internal HTTP API (status + audio admin, token-gated)  │
                └────────────┬─────────────────────────────▲──────────────────┘
                             │ Drizzle (packages/database)  │ Docker network
                      PostgreSQL                     apps/admin (Fastify SSR)
                                                            ▲
                                                     Browser (login, CSRF)
```

## Bot core (`packages/core`)

- **`BotKernel`** owns startup order (modules → adapters), graceful shutdown
  (SIGTERM-friendly for containers), process-level error handlers, and the
  health aggregator. It contains **zero Discord-specific code**.
- **`ModuleRegistry`** holds modules and their commands and builds the
  **command dispatcher** — the platform's error boundary:
  - disabled modules answer politely instead of executing,
  - `guildOnly` commands are blocked outside guilds,
  - every execution is audited,
  - thrown errors become `UserFacingError.safeMessage` or a generic message —
    **raw errors never reach end users**.
- **`CachedModuleState`** wraps the DB-backed enable/disable lookups with a
  10 s TTL so dispatch doesn't hit PostgreSQL per command, and falls back to
  the last known value if the database blips.

## Contracts (the seams everything plugs into)

| Contract | Implemented by | Consumed by |
|----------|----------------|-------------|
| `ChannelAdapter` | `DiscordAdapter` | kernel |
| `CommandDefinition` / `CommandContext` | modules ↔ adapters | dispatcher |
| `VoiceCapability` / `VoiceSession` / `AudioStreamSource` | `discord-adapter` | `audio-module` |
| `AuditLogPort`, `ModuleStatePort`, `HealthIndicator` | `database` | everyone |
| Internal API types (`shared/src/internal-api.ts`) | `apps/bot` | `apps/admin` |

A future Slack/Telegram adapter implements `ChannelAdapter` (+ optionally the
voice contracts) and every existing module works unchanged. A new module
ships commands as `CommandDefinition[]` and never imports an adapter.

## Discord adapter (`packages/discord-adapter`)

- discord.js v14 client (`Guilds` + `GuildVoiceStates` intents). A missing
  token = adapter `disabled`; a bad token = adapter `error` — **the platform
  keeps running** either way (admin panel, health, other adapters).
- Translates interactions into `CommandContext` (defer/reply/ephemeral
  semantics normalized) and routes them through the kernel dispatcher.
- `DiscordVoiceSession` wraps a voice connection + audio player with a strict
  event contract: per `play()` call, `started` fires once, then **exactly one**
  of `finished`/`error`; startup failures reject the call and emit nothing.
  ffmpeg transcodes arbitrary input (`StreamType.Arbitrary` via prism-media).
- Slash-command registration converts the neutral definitions to Discord
  JSON (`command-mapper.ts`) — testable without network.

## Audio module (`packages/audio-module`)

Three layers, no Discord imports anywhere:

1. **Resolver** — `AudioResolver` validates URLs through
   `@botplatform/security` (scheme/credential checks, private-IP blocking,
   DNS verification, allowlist) and picks the first `AudioProvider` claiming
   the URL. v1 ships `DirectHttpAudioProvider` (direct audio file links,
   lazy SSRF-safe streams). Future providers (YouTube-style resolvers, video)
   are list insertions, not rewrites.
2. **Engine** — `PlaybackQueue` (bounded FIFO) and `GuildPlaybackSession`:
   advance-on-finish, error tolerance with a 3-consecutive-failure cutoff,
   max-duration safety timer, pause/resume/skip/stop semantics, and
   best-effort persistence (history + queue mirror) that never breaks
   playback if the DB hiccups. `PlayerManager` keys sessions by guild and
   serves admin actions (skip/stop/clear) coming from the internal API.
3. **Commands** — thin handlers implementing the spec'd UX for all nine
   slash commands.

## Moderation foundation (`packages/moderation-module`)

Services over the persisted schema — `WarningService`,
`ModerationActionService`, `RuleService`, `PermissionService` (role→permission
mappings) — plus an empty command list. The roadmap in
[MODERATION_ROADMAP.md](MODERATION_ROADMAP.md) maps each future command onto
these services and the existing tables.

## Database layer (`packages/database`)

Drizzle ORM + node-postgres. Schema covers admin users, modules +
module/guild settings, guilds, platform users, warnings, moderation actions
+ rules, permission mappings, audit logs, playback history, queue mirror and
system settings. Access goes through **repository factories**; core-facing
behavior is exposed as **ports** (`createDbAuditLog` — which never throws —
`createDbModuleState`, `createDbHealthIndicator`). Migrations are generated
SQL (`migrations/`), applied by `pnpm db:migrate`, programmatically by
integration tests, and by the one-shot `migrate` service in production.

## Admin app (`apps/admin`)

Fastify 5, server-rendered EJS (no CDN, no frontend build), encrypted
stateless sessions, CSRF on every form, login rate limiting, role guard,
explicit safe-config allowlist, generic error pages. It reads the database
directly (repos) and reaches the bot worker only through the internal API
client — which never throws and renders honest offline states.

## Jobs/queue layer

Deliberately minimal in v1: playback state is in-memory in the bot worker
with a DB mirror; there is no Redis (see ASSUMPTIONS.md #3). The moderation
roadmap introduces a scheduler abstraction when announcements/automod need it.

## Health & observability

- bot: `GET :8081/healthz` aggregates DB + adapter indicators (503 when
  degraded → Docker healthcheck fails honestly, e.g. on an invalid token).
- admin: `GET :3000/healthz` checks the database.
- Structured pino logs everywhere, with secret-redaction paths; pretty in
  dev, JSON in production. `docker compose logs -f <service>`.

## Extensibility recap

| Want to add… | Touch |
|--------------|-------|
| A Slack adapter | new `packages/slack-adapter` implementing `ChannelAdapter`; register in `apps/bot/src/main.ts` |
| A YouTube provider | new `AudioProvider` in `audio-module/src/resolver/providers/`, prepend to the list |
| A `/warn` command | `moderation-module`: add a `CommandDefinition` calling `WarningService` |
| A new module | new package exporting a `BotModule`; add to the kernel's module list + seed |
| A REST/JSON API | new routes in `apps/admin` (repos already there) or a new `apps/api` |
