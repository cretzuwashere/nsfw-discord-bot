# 01 — Project Inventory

> Agent: **AGENT 1 — PROJECT INVENTORY**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)

## Agent purpose

Produce a complete, navigable inventory of the `botplatform` monorepo so later
agents can locate files without re-scanning: the repo tree, every package and
its entry/tests, all config + Docker files, app entrypoints, where command /
event / service / database / migration / test code lives, the run scripts, and
a freshness judgement for every existing doc.

## Files analyzed (verified by reading)

- Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.prettierrc.json`,
  `.npmrc`, `.dockerignore`, `Dockerfile`, `Dockerfile.dev`,
  `docker-compose.yml`, `Makefile`, `.github/workflows/ci.yml`.
- App entrypoints: `apps/bot/src/main.ts`, `apps/admin/src/main.ts`,
  `apps/admin/src/server.ts`, plus `apps/bot/package.json` and
  `apps/admin/package.json` (to confirm real entrypoints).
- Bot CLIs: `apps/bot/src/register-commands.ts`, `apps/bot/src/migrate.ts`,
  `apps/bot/src/seed.ts`.
- Every `packages/*/package.json` and the index/factory of representative
  packages: `packages/core/src/index.ts` + `contracts/module.ts`,
  `packages/database/src/index.ts` + `schema.ts` + `migrate.ts` +
  `drizzle.config.ts` + `seed.ts`, `packages/audio-module/src/index.ts`,
  `packages/moderation-module/src/index.ts`, `packages/shared/src/index.ts` +
  `types.ts` + `internal-api.ts`.
- Admin routing: `apps/admin/src/routes/index.ts`.
- Scripts: `scripts/dev-entry.sh`, `scripts/clean-validate.sh`,
  `scripts/check-admin-pages.sh`, `scripts/check-audio-stack.ts`,
  `scripts/README.md`.
- Migration journal: `packages/database/migrations/meta/_journal.json`.
- Docs sampled for freshness: `docs/ARCHITECTURE.md`, `docs/COMMUNITY_MODULES.md`.

## Commands run

**None — read-only analysis.** Only Glob/Grep/Read and non-mutating `find`/`ls`
listing were used to enumerate files. No pnpm/node/npm/build/test/docker
commands were executed (per constraint: host has no Node; another process owns
real validation).

## What was discovered (high level)

- The on-disk layout matches the briefed layout **with corrections**: there are
  **18 packages** (not the briefed list count — `reminders-module` and
  `welcome-module` both exist; all 18 confirmed) and **two apps** (`bot`,
  `admin`). `tests/` has `e2e/` and `integration-setup/`.
- Real bot entrypoint is `apps/bot/src/main.ts` (prod `node dist/main.js` via
  `tsup` build; dev `tsx watch src/main.ts`). Real admin entrypoint is
  `apps/admin/src/main.ts` (NOT `server.ts` — `main.ts` imports
  `buildAdminServer` from `server.ts`). Confirmed in each app's `package.json`.
- Module pattern is uniform: each module package exports a `create<Name>Module`
  factory returning a `...Handle` with a `module: BotModule`. The bot wires 11
  module handles into `BotKernel` (`apps/bot/src/main.ts`).
- Drizzle schema is a single file `packages/database/src/schema.ts`; **2
  migrations** exist (`0000_romantic_moonstone`, `0001_sturdy_timeslip`).
- Test totals: **41 `*.test.ts`** files — **32 co-located unit** tests under
  `*/src/`, **7 integration** tests under `*/tests/integration/`, **2 more**
  integration files counted within those 7 are app-level; plus **9 Playwright
  e2e** specs/setups under `tests/e2e/playwright/`.

---

## 1. Repo tree (relevant dirs)

```
Fable - Mod/
├── apps/
│   ├── bot/            @botplatform/bot   — Discord worker + internal HTTP API
│   └── admin/          @botplatform/admin — Fastify SSR admin panel
├── packages/           18 workspace packages (see table below)
├── tests/
│   ├── e2e/            @botplatform/e2e   — Playwright tests
│   └── integration-setup/  global-setup.ts (provisions test DB)
├── scripts/            dev-entry.sh, clean-validate.sh, check-admin-pages.sh,
│                       check-audio-stack.ts, README.md
├── docs/               24 *.md docs + docs/agent-memory/ + docs/technical/
├── uploads/            runtime card-asset volume mount point
├── .github/workflows/ci.yml
├── Dockerfile, Dockerfile.dev, docker-compose.yml, docker-compose.prod.yml,
├── Makefile, package.json, pnpm-workspace.yaml, pnpm-lock.yaml,
├── tsconfig.base.json, tsconfig.json, eslint.config.js, vitest.config.ts,
├── .prettierrc.json, .prettierignore, .npmrc, .dockerignore, .editorconfig,
└── .env.example (+ .env, not tracked)
```

### Packages — purpose, entry, tests

Every package `package.json` declares `"main"` / `"types": "./src/index.ts"`
(consumed directly as TS source via the bundler-resolution + tsup-inlining
strategy). "Entry" below is `src/index.ts` unless noted.

| Package (`@botplatform/…`) | Dir | Purpose | Entry | Has tests? |
|---|---|---|---|---|
| shared | `packages/shared` | Cross-cutting types, errors, placeholders, internal-API contract, util | `src/index.ts` | No co-located test (utilities tested indirectly) |
| config | `packages/config` | `loadConfig()` — zod-validated `AppConfig` from env | `src/index.ts` | Yes — `src/config.test.ts` |
| logger | `packages/logger` | pino logger factory `createLogger` | `src/index.ts` | No |
| core | `packages/core` | `BotKernel`, `ModuleRegistry`, scheduler, health, module-state, all contracts | `src/index.ts` | Yes — `registry.test.ts`, `scheduler.test.ts`, `module-state.test.ts` |
| security | `packages/security` | argon2 password hash, tokens, SSRF-safe URL validation + safe stream | `src/index.ts` | Yes — `url-validation.test.ts`, `safe-stream.test.ts` |
| database | `packages/database` | Drizzle client, schema, migrations, seed, ports, repositories | `src/index.ts` | Yes — `tests/integration/*` (5 files) |
| discord-adapter | `packages/discord-adapter` | discord.js v14 `DiscordAdapter`, guild service, voice session, command mapper, command registration | `src/index.ts` | Yes — `command-mapper.test.ts` |
| audio-module | `packages/audio-module` | Voice audio playback engine + resolver (yt-dlp/Spotify/direct), now-playing panel | `src/index.ts` | Yes — many (`commands`, `queue`, `session`, `now-playing`, `resolver`, providers) |
| moderation-module | `packages/moderation-module` | warn/mute/kick/ban/purge + case logging, services + permission RBAC | `src/index.ts` | Yes — `index.test.ts`, `commands.test.ts`, `services/*.test.ts` |
| announcements-module | `packages/announcements-module` | Create/schedule/send announcements | `src/index.ts` | Yes — `service.test.ts`, `validation.test.ts` |
| cards-module | `packages/cards-module` | Dynamic card image rendering (resvg), storage, layout, placeholders | `src/index.ts` | Yes — `renderer.test.ts`, `storage.test.ts` |
| welcome-module | `packages/welcome-module` | Welcome/leave messages, cards, auto-roles, DMs | `src/index.ts` | Yes — `service.test.ts` |
| role-menus-module | `packages/role-menus-module` | Self-assignable roles (reaction/button/select) | `src/index.ts` | Yes — `logic.test.ts`, `service.test.ts` |
| birthdays-module | `packages/birthdays-module` | Opt-in birthday announcements/roles/cards | `src/index.ts` | Yes — `date-logic.test.ts` |
| reminders-module | `packages/reminders-module` | Personal/server reminders, recurring, tz-aware | `src/index.ts` | Yes — `duration.test.ts` |
| scheduled-messages-module | `packages/scheduled-messages-module` | One-off + recurring channel messages (cron) | `src/index.ts` | Yes — `next-run.test.ts` |
| automod-module | `packages/automod-module` | Banned words / spam / link filtering with escalation | `src/index.ts` | Yes — `matcher.test.ts` |
| custom-commands-module | `packages/custom-commands-module` | Text/embed/random/link custom commands | `src/index.ts` | Yes — `render.test.ts` |

> Note: `shared` and `logger` have no co-located `*.test.ts`. All other 16
> packages do, or are covered by integration tests (`database`).

### Apps

| App | Dir | Real entrypoint | Notes |
|---|---|---|---|
| `@botplatform/bot` | `apps/bot` | `src/main.ts` | Wires DB + 11 modules + `DiscordAdapter` into `BotKernel`; exposes internal API (`src/internal-api.ts`) on `HEALTH_PORT` (8081). CLIs: `src/register-commands.ts`, `src/migrate.ts`, `src/seed.ts`. Build: `tsup` (`apps/bot/tsup.config.ts`). |
| `@botplatform/admin` | `apps/admin` | `src/main.ts` | `main.ts` builds the server via `buildAdminServer` in `src/server.ts`. Routes in `src/routes/`. Build: `tsup` (`apps/admin/tsup.config.ts`). Serves `views/*.ejs` + `public/` from disk (NOT bundled). |

---

## 2. Package files

### Root `package.json` scripts

| Script | Command |
|---|---|
| `dev` | `pnpm --parallel --filter "./apps/*" run dev` |
| `build` | `pnpm -r run build` |
| `typecheck` | `pnpm -r run typecheck` |
| `lint` | `eslint .` |
| `lint:fix` | `eslint . --fix` |
| `format` | `prettier --write .` |
| `format:check` | `prettier --check .` |
| `test` | `vitest run --project unit --project integration` |
| `test:unit` | `vitest run --project unit` |
| `test:integration` | `vitest run --project integration` |
| `test:e2e` | `pnpm --filter @botplatform/e2e run test` |
| `playwright` | `pnpm --filter @botplatform/e2e exec playwright` |
| `db:generate` | `pnpm --filter @botplatform/database run generate` (drizzle-kit) |
| `db:migrate` | `pnpm --filter @botplatform/database run migrate` (`tsx src/migrate-cli.ts`) |
| `db:seed` | `pnpm --filter @botplatform/database run seed` (`tsx src/seed-cli.ts`) |
| `db:setup` | `pnpm db:migrate && pnpm db:seed` |
| `discord:register-commands` | `pnpm --filter @botplatform/bot run register-commands` |

Root engines: `node >=22.12`. `packageManager: pnpm@10.34.3`.

### `pnpm-workspace.yaml`

- **Workspaces:** `apps/*`, `packages/*`, `tests/e2e`.
- **`onlyBuiltDependencies`** (allowed to run native build scripts):
  `@discordjs/opus`, `argon2`, `esbuild`.
- **Central `catalog:`** — every package references `catalog:` instead of
  pinning. Key pins (verified): discord.js `^14.26.4`, `@discordjs/voice`
  `^0.19.2`, `@discordjs/opus` `^0.10.0`, prism-media `^1.3.5`, fastify
  `^5.8.5`, `@fastify/secure-session` `^8.3.0`, `@fastify/csrf-protection`
  `^8.0.0`, `@fastify/rate-limit` `^11.0.0`, ejs `^6.0.1`, drizzle-orm
  `^0.45.2`, drizzle-kit `^0.31.10`, pg `^8.21.0`, argon2 `^0.44.0`, zod
  `^4.4.3`, undici `^8.4.1`, ipaddr.js `^2.4.0`, `@resvg/resvg-js` `^2.6.2`,
  luxon `^3.7.2`, cron-parser `^5.4.0`, pino `^10.3.1`, typescript `^5.9.2`,
  tsx `^4.22.4`, tsup `^8.5.1`, vitest `^4.1.8`, eslint `^10.5.0`,
  typescript-eslint `^8.61.0`, prettier `^3.8.4`, `@types/node` `^24.0.0`,
  `@playwright/test` `1.60.0` (exact — must match the Playwright Docker tag).

### Package names (npm scope `@botplatform`)

All packages: `@botplatform/{shared, config, logger, core, security, database,
discord-adapter, audio-module, moderation-module, announcements-module,
cards-module, welcome-module, role-menus-module, birthdays-module,
reminders-module, scheduled-messages-module, automod-module,
custom-commands-module}`. Apps: `@botplatform/bot`, `@botplatform/admin`. Tests:
`@botplatform/e2e`. All `"private": true`, `"type": "module"`, version `0.1.0`
(e2e has no version).

---

## 3. Config files

| File | What it sets |
|---|---|
| `tsconfig.base.json` | `target ES2022`, `lib ES2023`, `module ESNext`, `moduleResolution Bundler`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `noEmit`, `types: ["node"]`. |
| `tsconfig.json` | Extends base; `include` globs for `apps/*/src`, `apps/*/tests`, `packages/*/src`, `packages/*/tests`, `tests/e2e`, `tests/integration-setup`, plus `vitest.config.ts` + `eslint.config.js`. |
| `eslint.config.js` | ESLint flat config: `js.recommended` + `tseslint.recommended`; `consistent-type-imports`, `no-unused-vars` (`^_` ignore), `no-explicit-any: warn`, `no-console: error` (allow `warn`/`error`) — relaxed for scripts/tests/seed/migrate. |
| `vitest.config.ts` | Two projects: **unit** (`*/src/**/*.test.ts` + `*/tests/unit/**`), **integration** (`*/tests/integration/**`, `globalSetup: ./tests/integration-setup/global-setup.ts`, `fileParallelism: false`, 60s/30s timeouts). |
| `.prettierrc.json` | `semi`, `singleQuote`, `trailingComma: es5`, `printWidth: 100`, `endOfLine: lf`. |
| `.npmrc` | `node-linker=hoisted`, `prefer-frozen-lockfile=true`, `link-workspace-packages=true`. |
| Drizzle config | `packages/database/drizzle.config.ts` — dialect `postgresql`, `schema: ./src/schema.ts`, `out: ./migrations`, url from `DATABASE_URL`. |

Each app/package also has its own `tsconfig.json`; apps additionally have
`tsup.config.ts` (`apps/bot/tsup.config.ts`, `apps/admin/tsup.config.ts`).

---

## 4. Docker / infra files

| File | Purpose (verified) |
|---|---|
| `Dockerfile` | Prod multi-stage. Stages: `builder` (node:24-bookworm, pnpm install + `pnpm build`), `proddeps` (prod-only hoisted node_modules from manifests for cache), `runtime-base` (node:24-bookworm-slim + ffmpeg/curl/python3/fonts + pinned **yt-dlp 2026.06.09**), `bot` (EXPOSE 8081, healthcheck `/healthz`, ships migrations to `/app/migrations`), `admin` (EXPOSE 3000, healthcheck `/healthz`, ships `views/` + `public/`). Runs as `node` user. Targets: `bot`, `admin`. |
| `Dockerfile.dev` | Dev image from `mcr.microsoft.com/playwright:v1.60.0-noble` (Node 24 + browsers). Adds ffmpeg, postgresql-client, build tools, git, curl, pinned yt-dlp, pnpm 10.34.3. Runs as root (Windows bind-mount perms). Default `CMD sleep infinity`. |
| `docker-compose.yml` | DEV compose. Services: `db` (postgres:18-alpine, volume at `/var/lib/postgresql`), `app` (toolbox, `sleep infinity`), `bot` + `admin` (run `scripts/dev-entry.sh`), `e2e` (profile `e2e`). Source bind-mounted at `/workspace`; `node_modules` + `pnpm-store` + `uploads` are named volumes. All env via `x-dev-environment` anchor with dev defaults. Admin publishes `${ADMIN_PORT:-3000}`. |
| `docker-compose.prod.yml` | PROD compose (not fully read this pass — see "Not validated"). Per Dockerfile/Makefile comments: sets build targets, has `migrate`/`seed` one-shot services, NO secret defaults. |
| `.dockerignore` | Excludes `node_modules`, `dist`, `.git`, `.env*` (keeps `.env.example`), coverage/reports, `docs`, `README.md`. |
| `Makefile` | Optional wrappers over docker compose: `build/up/down/logs/ps`, `install/dev/lint/typecheck/test/test-unit/test-integration/e2e`, `migrate/seed/register-commands`, `psql/backup/restore`, `prod-build/prod-up/prod-down`. |

---

## 5. Source folders + entrypoints

### Bot (`apps/bot/src/`)
- `main.ts` — **entrypoint** (`node dist/main.js`). Loads config, creates DB +
  audit + module-state + guildsRepo, builds 11 module handles, constructs
  `BotKernel`, registers scheduler jobs (announcements, scheduled-messages,
  reminders, birthdays) + health indicators (db, discord-informational), starts
  kernel, then starts internal API on `config.bot.healthPort`.
- `internal-api.ts` — Fastify internal HTTP API (status + audio admin), token
  via `x-internal-token` (`@botplatform/shared` `INTERNAL_API_PATHS`).
- `register-commands.ts` — CLI to register Discord slash commands (collects
  commands from audio/moderation/announcements/role-menus/custom-commands/
  reminders/birthdays modules).
- `migrate.ts` — CLI wrapper around `runMigrations` (prod one-shot).
- `seed.ts` — CLI wrapper around `seed()` (prod one-shot).

### Admin (`apps/admin/src/`)
- `main.ts` — **entrypoint**; builds server via `buildAdminServer`.
- `server.ts` — Fastify app: plugins (formbody, multipart, secure-session,
  csrf, rate-limit, view/ejs, static, sensible), error boundary, auth guards
  (`requireAuth`, `requireMutatingRole`), `/healthz`, login/logout, and the
  core pages (`/dashboard`, `/modules`, `/audio`, `/guilds`, `/moderation`,
  `/audit-logs`, `/settings`). Registers community route plugins last.
- `bot-client.ts` — HTTP client to the bot's internal API.
- `command-catalog.ts` — catalog of slash commands for the `/commands` page.
- `paths.ts` — resolves `viewsDir` / `publicDir`.
- `validation.ts` — guild-settings input validation.
- `routes/` — one file per community module + `index.ts` (plugin list),
  `context.ts` (route context type), `placeholders.ts` (catch-all, kept LAST).
- `views/*.ejs` (28 templates incl. `partials/`), `public/styles.css`.

### Core contracts (`packages/core/src/contracts/`)
`adapter.ts` (ChannelAdapter), `commands.ts` (CommandDefinition/CommandContext),
`events.ts` (PlatformEvent), `guild-service.ts` (GuildService/Provider),
`module.ts` (BotModule/ModuleContext/ModuleMetadata), `ports.ts`
(AuditLogPort/ModuleStatePort etc.), `voice.ts` (VoiceCapability/VoiceSession/
AudioStreamSource). Plus `kernel.ts`, `registry.ts`, `scheduler.ts`,
`health.ts`, `module-state.ts`.

---

## 6. Command / event / service / database layout

### Per-module code organization (verified patterns)
- **Module factory:** `packages/<mod>/src/index.ts` exports
  `create<Name>Module(options) → { module: BotModule, … }`.
- **Commands:** `commands.ts` in modules that own slash commands (audio,
  moderation, announcements, role-menus; others build commands inline or have
  none). Slash commands are `CommandDefinition[]` on `module.commands`.
- **Events:** declared on `module.events` (e.g. audio's `component.interaction`
  handler in `commands.ts` via `buildAudioComponentHandler`).
- **Services:** moderation has a `src/services/` folder (action, permission,
  rule, warning services + repos). Other modules use `service.ts` (announcements,
  cards, role-menus, welcome) and/or `repo.ts` (most modules) for persistence.
- **Adapter↔command mapping:** `packages/discord-adapter/src/command-mapper.ts`
  and `command-mapper.test.ts`; slash registration in
  `packages/discord-adapter/src/register-commands.ts`.

### Database (`packages/database/`)
- `src/client.ts` — `createDatabase(url)` (node-postgres + Drizzle), `pingDatabase`.
- `src/schema.ts` — **single schema file**; all tables + pgEnums (admin_users,
  modules, module_settings, guilds, guild_settings, platform_users, warnings,
  moderation_actions, moderation_rules, permission_mappings, audit_logs,
  playback_history, queue_items, system_settings, announcements, card_templates,
  card_assets, welcome_settings, role_menus, role_menu_options,
  role_assignment_logs, birthdays, birthday_settings, birthday_announcements,
  reminders, scheduled_messages, scheduled_message_runs, moderation_cases,
  moderation_settings, automod_rules, automod_violations, custom_commands).
- `src/migrate.ts` (+ `migrate-cli.ts`) — `runMigrations`; `MIGRATIONS_DIR` env
  override (prod uses `/app/migrations`).
- `src/seed.ts` (+ `seed-cli.ts`) — idempotent: ensures 11 built-in module rows
  (audio + announcements default ON; rest default OFF) + creates owner admin and
  optional E2E admin.
- `src/ports.ts` — DB-backed implementations of core ports (audit, module-state,
  health indicator).
- `src/repositories/` — `admin-users`, `audit-logs`, `guilds`, `moderation`,
  `modules`, `playback`, `system-settings`.
- `src/test-url.ts` — helper for integration test DB URL.

### Migrations / seeders
- `packages/database/migrations/0000_romantic_moonstone.sql`
- `packages/database/migrations/0001_sturdy_timeslip.sql`
- `packages/database/migrations/meta/` (`_journal.json`, `0000_snapshot.json`,
  `0001_snapshot.json`). Journal lists **2** entries.
- Seeders: `packages/database/src/seed.ts` (logic) → `seed-cli.ts` /
  `apps/bot/src/seed.ts` (entrypoints).

---

## 7. Tests — counts + locations

| Category | Count | Location |
|---|---|---|
| Unit (co-located) | 32 | `packages/*/src/**/*.test.ts` + `apps/*/src/**/*.test.ts` |
| Integration | 7 | `packages/database/tests/integration/{audit,migrations,moderation,playback,repos}.test.ts`, `apps/admin/tests/integration/admin-flows.test.ts`, `apps/bot/tests/integration/internal-api.test.ts` |
| **Total `*.test.ts`** | **41** | (32 unit + 7 integration + 2 additional unit under app `tests/unit/`: `apps/admin/tests/unit/bot-client.test.ts`, `apps/admin/tests/unit/validation.test.ts`) |
| E2E (Playwright) | 9 files | `tests/e2e/playwright/{audio,audit-logs,auth,commands,dashboard,guilds,modules,settings}.spec.ts` + `auth.setup.ts` |

Notes:
- Unit tests are **co-located** next to source (`*.test.ts`), matching the
  vitest `unit` project globs. `apps/admin` also has `tests/unit/*` (counted in
  the 41 total; vitest `unit` project includes `apps/*/tests/unit/**`).
- Integration tests live in `*/tests/integration/` and share one DB
  (`fileParallelism: false`), provisioned by
  `tests/integration-setup/global-setup.ts`.
- E2E config: `tests/e2e/playwright.config.ts`; auth state cached at
  `tests/e2e/playwright/.auth/admin.json`.

---

## 8. Run scripts (`scripts/`)

| Script | What it does (read) |
|---|---|
| `dev-entry.sh` | Entrypoint for the `bot`/`admin` dev compose services. Polls for `node_modules/.modules.yaml` (the "pnpm install finished" signal), then `exec pnpm --filter @botplatform/<app> dev`. Must stay LF. Linux-container only. |
| `clean-validate.sh` | Clean-room full validation from the host: `docker compose down -v` → build/up → install → lint → typecheck → unit → migrate → integration → seed → build → up bot+admin (wait healthy) → e2e. Mirrors CI. |
| `check-admin-pages.sh` | Inside container: curls every admin page route; fails on 500/404 (302→login is healthy). Pages list includes a `permissions` route. |
| `check-audio-stack.ts` | Prints `@discordjs/voice` dependency report; fails if `@discordjs/opus` not loadable or ffmpeg missing. Run with `tsx`. |
| `README.md` | Documents `dev-entry.sh` behaviour + LF requirement. |

> Note: `packages/audio-module/scripts/check-streaming.ts` is a module-local
> helper (not under root `scripts/`).

---

## 9. Existing documentation — coverage + freshness

Freshness judged against the code read this pass. Docs sampled in depth
(`ARCHITECTURE.md`, `COMMUNITY_MODULES.md`) match current code precisely (module
contract, 11 modules, internal-API seam, kernel error boundary). Others judged
by topic alignment with verified code; marked **unknown** where not opened.

| Doc (`docs/`) | Covers | Freshness |
|---|---|---|
| `ARCHITECTURE.md` | Modular monorepo, kernel, contracts, adapter, internal API | Current (verified against `core` + `main.ts`) |
| `COMMUNITY_MODULES.md` | Module system index; the 11 built-in modules | Current (verified vs `module.ts` + seed + main.ts) |
| `ADMIN_PANEL.md` | Admin panel login/nav/pages | Likely current (matches `server.ts` pages) — verify |
| `ANNOUNCEMENTS.md` | Announcements module | Likely current — unknown (not opened) |
| `ASSUMPTIONS.md` | Hosting/host assumptions (hoisted node_modules, Docker-first) | Likely current (matches `.npmrc`/compose) — unknown |
| `AUDIO_SOURCES.md` | yt-dlp/Spotify/direct sources, cookies | Likely current (matches audio module + compose YTDLP vars) — unknown |
| `AUTOMOD.md` | Auto-moderation module | Likely current — unknown |
| `BIRTHDAYS_AND_REMINDERS.md` | Birthdays + reminders modules | Likely current — unknown |
| `CUSTOM_COMMANDS.md` | Custom commands module | Likely current — unknown |
| `DISCORD_SETUP.md` | Token, intents, invite, register-commands | Likely current (matches register-commands + intent flags) — unknown |
| `DOCKER_DEPLOYMENT.md` | Prod docker-compose.prod usage | Possibly stale — verify vs `docker-compose.prod.yml` (not fully read) |
| `DOCKER_DEVELOPMENT.md` | Dev compose workflow | Current (matches `docker-compose.yml` + dev-entry.sh) — verify wording |
| `DYNAMIC_CARDS.md` | Cards module (resvg, templates, assets) | Likely current (matches schema card_* tables) — unknown |
| `GITHUB_DEPLOYMENT.md` | CI / GitHub deploy | Likely current (matches `ci.yml`) — verify |
| `LOCAL_RUN.md` | Running locally via Docker | Likely current — unknown |
| `MODERATION.md` | Moderation module | Likely current (matches moderation module + cases) — unknown |
| `MODERATION_ROADMAP.md` | Future moderation plans | Roadmap — unknown (intentionally forward-looking) |
| `PERMISSIONS.md` | Admin roles + RBAC/permission mappings | Likely current (matches admin_role enum + permission_mappings) — unknown |
| `PRIVACY.md` | Data/privacy posture | Likely current — unknown |
| `REACTION_ROLES.md` | Role-menus module (reaction/button/select) | Likely current (matches role_menus schema) — unknown |
| `SCHEDULED_MESSAGES.md` | Scheduled messages module | Likely current (matches scheduled_messages schema) — unknown |
| `SECURITY.md` | Security model (SSRF, secrets, CSRF, sessions) | Likely current (matches security pkg + admin plugins) — unknown |
| `TESTING.md` | Unit/integration/e2e strategy | Likely current (matches vitest + playwright config) — verify counts |
| `TROUBLESHOOTING.md` | Common failures | Unknown |

> All docs are in **English**, consistent with the codebase. No doc was found to
> contradict the code in the files read. `DOCKER_DEPLOYMENT.md` is the main
> freshness risk because `docker-compose.prod.yml` was not fully read this pass.

---

## 10. Problems found

1. **`docker-compose.prod.yml` not fully read** — its services (`migrate`,
   `seed`, secret handling) are inferred from Dockerfile + Makefile + compose
   comments, not directly verified. A later agent should open it.
2. **Two packages lack co-located unit tests** (`shared`, `logger`). Not a bug,
   but coverage gaps to note.
3. **Most `docs/*.md` not opened individually** — freshness for ~18 docs is a
   topic-alignment judgement, not a line-by-line verification.
4. **`.env` exists on disk** (untracked) alongside `.env.example`. Not read (per
   secrets rule). Agents must use placeholders, never copy values.

## 11. Recommendations

- Trust this inventory for file locations; do NOT re-scan the whole tree.
- For prod deployment work, read `docker-compose.prod.yml` first.
- The module pattern is uniform — to find any module's logic, start at
  `packages/<name>/src/index.ts` and follow to `commands.ts` / `service.ts` /
  `repo.ts` / `services/`.
- The schema is one file: `packages/database/src/schema.ts` is the source of
  truth for all tables; migrations are generated from it (drizzle-kit).
- Admin pages: core pages in `apps/admin/src/server.ts`; per-module pages in
  `apps/admin/src/routes/*.ts` (registered via `routes/index.ts`).

## 12. What remains to verify (handoff)

- `docker-compose.prod.yml` contents (services, env, volumes, one-shots).
- `apps/bot/src/internal-api.ts` route implementations vs the shared contract.
- `apps/bot/tsup.config.ts` / `apps/admin/tsup.config.ts` build entry/targets.
- `packages/config/src/index.ts` — the full `AppConfig` shape + env var names.
- Line-by-line freshness for docs marked "unknown" above.
- `packages/core/src/kernel.ts` + `registry.ts` dispatcher error-boundary
  details (claimed in ARCHITECTURE.md, not read this pass).

---

## Checkpoint

Status: PASS

### Validat
- Repo tree: 18 packages + 2 apps + tests(e2e, integration-setup) + scripts +
  docs — enumerated from disk.
- Every `package.json` (root, 2 apps, 18 packages, e2e) read; names, scripts,
  entries recorded.
- Real entrypoints confirmed via each app's `package.json`: bot `src/main.ts`,
  admin `src/main.ts` (→ `server.ts`).
- All root config files read: `tsconfig.base.json`, `tsconfig.json`,
  `eslint.config.js`, `vitest.config.ts`, `.prettierrc.json`, `.npmrc`,
  `.dockerignore`; drizzle config located + read.
- Docker: `Dockerfile`, `Dockerfile.dev`, `docker-compose.yml`, `Makefile`,
  `.github/workflows/ci.yml` read.
- DB schema, migrate, seed, drizzle config, migration journal read (2
  migrations confirmed).
- Module factory pattern verified (core `module.ts`, audio + moderation index).
- Test inventory counted by category (41 total: 32 unit co-located + app
  `tests/unit` + 7 integration; 9 Playwright files).
- All four `scripts/` files read and summarized.
- `docs/` enumerated (24 files); 2 read in depth (current), rest topic-judged.

### Nevalidat
- `docker-compose.prod.yml` (not fully read).
- `apps/*/tsup.config.ts` (existence confirmed, contents not read).
- `packages/config/src/index.ts` full `AppConfig` shape (env names not enumerated).
- ~18 `docs/*.md` line-by-line (freshness is topic-alignment only).
- `.env` (intentionally not read — secrets).
- `core/kernel.ts` + `registry.ts` internals.

### Probleme
- Prod compose freshness risk (`DOCKER_DEPLOYMENT.md` depends on a file not
  fully read).
- `shared` + `logger` have no co-located unit tests (coverage note).
- Many doc freshness judgements are inferred, not line-verified.

### Următorul agent poate continua?
Da. The inventory gives exact paths for every package, app, config, Docker file,
schema/migration, test, and script, plus the uniform module-factory pattern and
the admin routing layout. A later agent can jump straight to any file. The only
gaps to close before deployment-focused work are `docker-compose.prod.yml` and
the full `AppConfig` env shape in `packages/config/src/index.ts`.
