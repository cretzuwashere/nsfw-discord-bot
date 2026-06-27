# Testing

How the botplatform monorepo is tested: the three automated layers (unit,
integration, e2e), the exact commands (all in Docker Compose form), the real
current results, prerequisites per layer, what is verified vs deduced vs not
validated, and a manual Discord smoke-test checklist for the things no
automated layer can exercise.

> Everything runs in Linux Docker containers. The Windows host has no Node,
> pnpm, ffmpeg, psql, or Playwright browsers. Every command below is the
> `docker compose exec app pnpm ...` form. The `app` service is the dev
> "toolbox" container (`sleep infinity`); `-T` disables the pseudo-TTY so the
> command works non-interactively / in CI.

---

## Test layers at a glance

| Layer | Runner | Where the tests live | Needs Postgres? | Needs the running stack? |
| --- | --- | --- | --- | --- |
| Unit | Vitest (`unit` project) | co-located `*.test.ts` next to source | No | No |
| Integration | Vitest (`integration` project) | `packages/*/tests/integration/`, `apps/*/tests/integration/` | Yes (a dedicated `_test` DB) | Just the `db` + `app` containers |
| E2E | Playwright (chromium) | `tests/e2e/playwright/*.spec.ts` | Yes (admin uses the dev DB) | Yes (`db`, `bot`, `admin` up + healthy) |

Plus non-test gates that the CI and the validation run treat as first-class:
`lint` (eslint), `typecheck` (tsc, all projects), `build` (tsup), and the
production image build (`docker-compose.prod.yml`).

---

## Layer 1 — Unit tests (Vitest, `unit` project)

*Verified in code: `vitest.config.ts`.*

- Vitest config defines two **projects**, `unit` and `integration`.
- The `unit` project `include` globs (verified in code):
  - `packages/*/src/**/*.test.ts`
  - `packages/*/tests/unit/**/*.test.ts`
  - `apps/*/src/**/*.test.ts`
  - `apps/*/tests/unit/**/*.test.ts`
- Environment: `node`. No global setup, no database, no network. Tests are pure
  and run in parallel.
- On disk today: **46 unit test files** — 44 co-located under
  `packages/*/src/`, and 2 under `apps/admin/tests/unit/` (the only
  `tests/unit` directory present). The other two configured globs
  (`packages/*/tests/unit`, `apps/*/src`) currently match nothing but are kept
  so new packages/apps can use either layout.

Distribution (verified by file count on 2026-06-27): audio-module 10,
moderation-module 6, core 3, then announcements / cards / role-menus / security
/ apps-admin with 2 each, and one file each for the remaining module + infra
packages (automod, birthdays, custom-commands, discord-adapter, economy,
engagement-prompts, fun-commands, giveaways, levels, minigames, raise-hand,
reminders, scheduled-messages, server-stats, trivia, welcome, config).

### Command

```bash
docker compose exec -T app pnpm test:unit
```

(`test:unit` = `vitest run --project unit`.)

### Prerequisites

- The logic does not need `db`, but you run inside `app`, so:
  `docker compose up -d app`.
- `docker compose exec -T app pnpm install` once (lockfile up to date).

---

## Layer 2 — Integration tests (Vitest, `integration` project)

*Verified in code: `vitest.config.ts`, `tests/integration-setup/global-setup.ts`,
`packages/database/src/test-url.ts`, `docker-compose.yml`.*

These run real SQL against a real Postgres, in a **dedicated test database**
that is never the dev/prod database.

- The `integration` project `include` globs (verified in code):
  - `packages/*/tests/integration/**/*.test.ts`
  - `apps/*/tests/integration/**/*.test.ts`
- Key settings (verified in `vitest.config.ts`):
  - `fileParallelism: false` — integration test **files run serially**. They
    share one database, so this avoids concurrent schema churn / row clashes.
  - `hookTimeout: 60_000`, `testTimeout: 30_000`.
  - `globalSetup: './tests/integration-setup/global-setup.ts'`.
- Global setup (verified in `tests/integration-setup/global-setup.ts`):
  1. Resolves the test DB URL via `resolveTestDatabaseUrl()`.
  2. Validates the DB name against `/^[a-z0-9_]+$/` before interpolating it into
     `CREATE DATABASE` (which can't be parameterized) — a deliberate injection
     guard.
  3. Connects to the maintenance `postgres` database and creates the test DB if
     it doesn't already exist.
  4. Runs **all migrations** against the test DB (`runMigrations`).
- Test DB URL resolution (verified in `packages/database/src/test-url.ts`):
  - `TEST_DATABASE_URL` wins if set.
  - Otherwise `DATABASE_URL` is rewritten, suffixing the database name with
    `_test` (e.g. `…/botplatform` -> `…/botplatform_test`) so integration tests
    can never touch the real database.
  - In compose this is set explicitly:
    `TEST_DATABASE_URL=postgres://botplatform:<password>@db:5432/botplatform_test`
    (verified in `docker-compose.yml`).
- Per-file cleanup pattern (verified e.g. in
  `packages/database/tests/integration/repos.test.ts`): each suite tracks the
  ids/keys it inserts and deletes exactly those in `afterAll` (guild deletes
  cascade to `guild_settings`). The DB is reused across runs, not torn down each
  time — there is no per-test transaction rollback.

On disk today: **7 integration test files** (verified by listing):

- `packages/database/tests/integration/audit.test.ts`
- `packages/database/tests/integration/migrations.test.ts`
- `packages/database/tests/integration/moderation.test.ts`
- `packages/database/tests/integration/playback.test.ts`
- `packages/database/tests/integration/repos.test.ts`
- `apps/admin/tests/integration/admin-flows.test.ts`
- `apps/bot/tests/integration/internal-api.test.ts`

### Command

```bash
docker compose exec -T app pnpm test:integration
```

(`test:integration` = `vitest run --project integration`.)

The global setup creates + migrates the test DB automatically. CI pre-migrates
the dev DB first; to mirror that locally:

```bash
docker compose exec -T app pnpm db:migrate
docker compose exec -T app pnpm test:integration
```

### Prerequisites

- `db` and `app` up: `docker compose up -d db app`.
- A reachable Postgres at the `DATABASE_URL` host (`db:5432`). The global setup
  needs CREATE DATABASE privileges on first run (the seeded `botplatform` role
  has them on the local stack).

---

## Layer 3 — End-to-end tests (Playwright, in the dev image)

*Verified in code: `tests/e2e/playwright.config.ts`,
`tests/e2e/playwright/*.ts`, `Dockerfile.dev`, `docker-compose.yml`.*

Playwright drives a headless Chromium against the running **admin** SSR panel.

- Browsers ship inside the dev image. `Dockerfile.dev` is built
  `FROM mcr.microsoft.com/playwright:v1.60.0-noble`; the tag **must** match the
  `@playwright/test` version pinned in the workspace catalog (1.60.0) or
  Playwright refuses to run. `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` is set in
  the base image so browsers survive `node_modules` being a named volume.
  **Never run `playwright install`** — the browsers are already there.
- Playwright config (verified in `tests/e2e/playwright.config.ts`):
  - `testDir: ./playwright`, `fullyParallel: false`, `workers: 1`,
    `retries: 1` only in CI.
  - `baseURL = PLAYWRIGHT_BASE_URL ?? 'http://admin:3000'` — the compose
    `admin` service hostname/port.
  - Two projects: a `setup` project (`auth.setup.ts`) and a `chromium` project
    that `dependencies: ['setup']` and loads the saved
    `playwright/.auth/admin.json` session via `storageState`.
  - `globalSetup: ./playwright/global-setup.ts` polls `admin /healthz` (up to
    120 s) before any test runs and fails with a clear message if admin never
    becomes healthy.
- Auth setup (verified in `auth.setup.ts` + `helpers.ts`): logs in as the
  seeded e2e admin (`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, defaulting to
  `e2e-admin@example.com` / `e2e_test_password_123`), waits for `/dashboard`,
  and saves the session so the chromium tests start authenticated.
- The spec files and what they cover (verified in code):
  - `auth.spec.ts` — login page renders; invalid login stays on `/login` with a
    safe, non-field-revealing error and no stack trace; valid login -> dashboard;
    logout clears the session and re-protects `/dashboard`. (Runs
    unauthenticated via `test.use({ storageState: { cookies: [], origins: [] }})`.)
  - `dashboard.spec.ts` — Discord adapter state, DB health, module list,
    environment/version, recent audit section.
  - `modules.spec.ts` — lists built-in modules; toggles `Custom Commands` off
    and back on idempotently and checks an audit entry was written.
  - `audio.spec.ts` — audio admin page loads without raw errors; shows queue +
    duration limits; shows live sessions or an honest empty state (no Discord
    token in e2e); renders a recent playback errors section.
  - `audit-logs.spec.ts` — audit table renders; an `admin.login` entry from the
    suite login is present; **filter and pagination tests `test.skip()` at
    runtime when those optional controls are absent**.
  - `guilds.spec.ts` — guilds page loads with rows or a friendly empty state, no
    stack trace.
  - `settings.spec.ts` — settings page shows environment values; asserts no
    secret value (`SESSION_SECRET`, `INTERNAL_API_TOKEN`, `ADMIN_PASSWORD`,
    `E2E_ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `DISCORD_TOKEN`) is rendered on
    any of `/settings`, `/dashboard`, `/modules`, `/audio`, `/audit-logs`.
  - `commands.spec.ts` — `/commands` doc page lists `/play`, `/controls`,
    Moderation; no stack trace; no leaked secrets.

  There are **25 test blocks** total across these files: 1 `setup` + 24
  chromium tests. The two `test.skip()` cases account for the single skip in the
  results below.

  **Coverage gap:** e2e exercises only the admin pages that exist — the ~11
  modules with dedicated admin routes plus the generic module-toggle page. The
  9 newest modules (raise-hand, fun-commands, engagement-prompts, giveaways,
  server-stats, trivia, minigames, economy, levels) have **no dedicated admin
  route / e2e page**; their behaviour is covered only by their unit tests.

### Command

```bash
docker compose --profile e2e run --rm e2e
```

This is the canonical, self-contained form: the `e2e` service is an opt-in
compose profile (`profiles: ['e2e']`) that runs `pnpm test:e2e` in the dev
image (verified in `docker-compose.yml`). The CI runs the equivalent
`docker compose exec -T app pnpm test:e2e` against an already-up `admin`.

You can also run it against an already-running `app`:

```bash
docker compose exec -T app pnpm test:e2e
```

(`test:e2e` = `pnpm --filter @botplatform/e2e run test` = `playwright test`.)

### Prerequisites

- `db`, `admin` (and `bot` for a fuller picture) up and `admin` healthy:
  ```bash
  docker compose up -d db admin
  docker compose ps
  curl -fsS http://localhost:3000/healthz   # from the host, admin maps :3000
  ```
- The seeded e2e admin must exist (run `pnpm db:setup` / `db:seed`).
- No Discord token is required; the audio/dashboard/guilds specs are written to
  accept the honest "not connected / empty" states.

---

## Cross-cutting gates (lint / typecheck / build / prod image)

```bash
docker compose exec -T app pnpm lint        # eslint .
docker compose exec -T app pnpm typecheck   # tsc, all projects
docker compose exec -T app pnpm build       # tsup ESM build, all packages/apps
docker compose -f docker-compose.prod.yml build   # 3 prod images: admin, bot, migrate
```

The CI workflow (`.github/workflows/ci.yml`) runs all of these through the same
Docker Compose flow, in this order: build dev image -> up `db app` -> install
(`--frozen-lockfile`) -> lint -> typecheck -> unit -> migrate -> integration ->
seed -> build -> up `bot admin` -> wait for admin health -> e2e. A separate
`docker-prod` job builds the `bot` and `admin` prod image targets, and a
`secret-scan` job runs gitleaks over full history.

---

## Real current results

**Verified by execution on 2026-06-27** (run by the orchestrator against the
running dev stack; counts are point-in-time):

| Gate | Command | Result |
| --- | --- | --- |
| install | `pnpm install` | PASS — lockfile up to date, 31 workspace projects (~9s) |
| migrate | `pnpm db:migrate` | PASS — all 10 migrations applied (`0000_romantic_moonstone` .. `0009_legal_cammi`) |
| lint | `pnpm lint` | PASS — clean |
| typecheck | `pnpm typecheck` | PASS — all 31 projects |
| unit | `pnpm test:unit` | **PASS — 471 tests / 46 files** |
| integration | `pnpm test:integration` | **PASS — 37 tests / 7 files** |
| build | `pnpm build` | PASS — tsup ESM for all |
| e2e | `docker compose --profile e2e run --rm e2e` | **PASS — 24 passed / 1 skipped** (Playwright chromium) |
| prod images | `docker compose -f docker-compose.prod.yml build` | PASS — built all 3 prod images (admin, bot, migrate), ~60s |
| bot health | `GET /healthz` (bot) | `{"status":"ok","checks":{"discord":{"status":"ok","detail":"connected"},"database":{"status":"ok"}}}` — bot connected to Discord |
| admin health | `GET /healthz` (admin) | `{"status":"ok","checks":{"database":{"status":"ok"}}}` |

> Note: this validation ran against the **warm running stack**, not a clean-room
> `docker compose down -v`. A full clean-room run was performed earlier the same
> day on a smaller version of the repo. Counts are point-in-time and will move
> as tests are added.

---

## VALIDAT-EFECTIV / DEDUS / NEVALIDAT

### VALIDAT-EFECTIV (verified by execution on 2026-06-27)

- Unit suite green: 471 tests across 46 files.
- Integration suite green: 37 tests across 7 files (real Postgres `_test` DB).
- E2E suite green: 24 passed / 1 skipped (Playwright chromium vs the admin panel).
- `lint`, `typecheck` (31 projects), `build` all clean.
- Dev + prod images build; bot and admin report healthy; bot is actually
  connected to Discord.

### DEDUS (derived from reading the code/config, not separately re-measured here)

- File counts map to the validation totals: 46 unit files (44 co-located + 2 in
  `apps/admin/tests/unit`), 7 integration files. (File counts re-confirmed on
  disk on 2026-06-27; the per-test totals 471/37 are from the execution run.)
- The single e2e skip corresponds to one of the two optional `test.skip()`
  branches in `audit-logs.spec.ts` (filter / pagination absent).
- Integration tests are isolated from real data purely by the `_test`
  suffix/`TEST_DATABASE_URL` mechanism + per-suite cleanup — there is no
  per-test transaction rollback or full DB drop between runs.

### NEVALIDAT (no automated coverage; or not exercised this pass)

- A clean-room `docker compose down -v` full run this pass (the warm stack was
  used instead).
- Anything requiring a live Discord gateway/voice connection: real `/play`
  audio playback, `member.join` welcome behind the privileged GuildMembers
  intent, real moderation permission enforcement, raise-hand multi-user button
  flows, voice-state events. The e2e layer deliberately runs **without** a
  Discord token and only asserts honest empty states. These are covered only by
  the manual smoke test below.
- The 9 newest modules (raise-hand, fun-commands, engagement-prompts,
  giveaways, server-stats, trivia, minigames, economy, levels) have **no
  dedicated admin route / e2e page coverage**.
- Load / performance / concurrency under real traffic.

---

## Manual Discord smoke-test checklist

Automated tests never touch a live Discord gateway. After a deploy (or before
cutting a release) run this by hand against a test guild. Use placeholder
secrets only: `<DISCORD_BOT_TOKEN>`, `<DISCORD_CLIENT_ID>`, `<DISCORD_GUILD_ID>`.

1. **Bot connects to Discord.** Bring the stack up with a valid token in `.env`,
   then check health:
   ```bash
   docker compose up -d db bot admin
   docker compose exec -T bot curl -fsS http://localhost:3000/healthz
   ```
   Expect `discord.status: "ok"`, `detail: "connected"`. Confirm the bot shows
   online in the guild member list.

2. **Register slash commands.** Register guild-scoped commands (fast, no global
   propagation delay):
   ```bash
   docker compose exec -T app pnpm discord:register-commands
   ```
   In the guild, type `/` and confirm the command list populates (`/play`,
   `/controls`, moderation, etc.).

3. **`/play` real audio.** Join a voice channel, run `/play url:<a known-good
   link>`. Expect the bot to join the channel, transcode (ffmpeg/yt-dlp in the
   image), and play audible audio. Then `/controls` -> pause/skip/stop and
   confirm each takes effect. Check the admin `/audio` page shows the live
   session and, on a bad URL, a recent playback error.

4. **Member-join welcome (privileged GuildMembers intent).** The `member.join`
   event requires the **privileged GuildMembers intent**, which is gated behind
   an opt-in flag. With the intent enabled in the Discord developer portal *and*
   the opt-in flag set, have a fresh account (or a test alt) join the guild.
   Expect the welcome message to fire and any auto-assigned roles to be applied.
   With the intent/flag OFF, joins should produce **no** welcome and no crash —
   confirm the graceful no-op.

5. **Non-mod moderation permission failure.** As a user **without** the required
   moderation permission, invoke a moderation command (e.g. ban/kick/timeout).
   Expect a clean, user-facing "you don't have permission" style refusal and
   **no** action taken / no stack trace. (Server-side gating uses
   `GuildService.memberHasPermission`.) Repeat as a mod to confirm the happy
   path works.

6. **Raise-hand multi-user flow.** With at least two test users: user A starts /
   joins a raise-hand session and presses the raise-hand button; user B does the
   same. Confirm the queue/order updates correctly for both, that a mod can call
   on / clear hands, and that button presses by a user without the gating
   permission are rejected server-side (`memberHasPermission`).

7. **Economy / levels persistence across restart.** Earn some economy currency
   and/or XP (send messages, run economy commands) for a test user. Note the
   balances/level, then restart the bot **without** wiping the DB:
   ```bash
   docker compose restart bot
   ```
   (Do **not** use `down -v` — that drops the `pgdata` volume.) Re-query the
   user's balance/level via the relevant command and confirm the values survived
   the restart (i.e. they're persisted in Postgres, not in memory).

---

## Quick reference — all test commands

```bash
# Unit
docker compose exec -T app pnpm test:unit

# Integration (auto-creates + migrates the _test DB)
docker compose exec -T app pnpm test:integration

# Unit + integration together
docker compose exec -T app pnpm test

# E2E (canonical, self-contained profile run)
docker compose --profile e2e run --rm e2e
# E2E against an already-running app
docker compose exec -T app pnpm test:e2e

# Cross-cutting gates
docker compose exec -T app pnpm lint
docker compose exec -T app pnpm typecheck
docker compose exec -T app pnpm build
docker compose -f docker-compose.prod.yml build
```
