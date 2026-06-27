# 06 — Testing & Validation (Agent 6)

## Agent purpose

Document HOW the botplatform test/validation pipeline works and record the REAL,
actually-executed validation results from the clean-room run on 2026-06-27.
Establish a clear three-way split of every claim: (A) VALIDAT EFECTIV (ran, with
evidence), (B) DEDUS din cod (inferred from source), (C) NEVALIDAT (and why).

## Files analyzed

- `vitest.config.ts` (unit + integration projects)
- `tests/integration-setup/global-setup.ts` (integration global setup)
- `tests/e2e/playwright.config.ts`, `tests/e2e/package.json`
- `tests/e2e/playwright/global-setup.ts`, `auth.setup.ts`, `helpers.ts`, `auth.spec.ts`
- `package.json` (root scripts)
- `scripts/clean-validate.sh`, `.github/workflows/ci.yml`
- `packages/database/src/test-url.ts` (`resolveTestDatabaseUrl`)
- Representative tests: `apps/bot/tests/integration/internal-api.test.ts`,
  `packages/database/tests/integration/moderation.test.ts`
- Test-file inventory via glob (`**/*.test.ts`) and e2e spec enumeration

## What was discovered

- Testing is a single **Vitest** workspace with two named projects (`unit`,
  `integration`) defined in `vitest.config.ts`, plus a separate **Playwright**
  e2e package `@botplatform/e2e` under `tests/e2e/`. (verified in code)
- **Unit** tests are co-located as `*.test.ts` next to source under
  `packages/*/src/**` and `apps/*/src/**` (also `*/tests/unit/**`). Pure logic,
  no DB. (verified in code)
- **Integration** tests live in `packages/*/tests/integration/**` and
  `apps/*/tests/integration/**`, run serially (`fileParallelism:false`) against a
  real Postgres test DB, with a global setup that creates + migrates the DB.
  (verified in code)
- **E2E** tests are Playwright specs (8 spec files + 1 auth setup) that drive the
  live `admin` service over HTTP from inside the dev container. (verified in code)
- Everything runs **inside Docker** — the host has no Node. CI
  (`.github/workflows/ci.yml`) and `scripts/clean-validate.sh` both drive the
  exact same `docker compose exec -T app pnpm ...` sequence. (verified in code)
- The full suite was executed clean-room on 2026-06-27 and ALL gates passed
  (see "Validated by execution" below). (validat efectiv)

## Commands run (by the orchestrator, clean-room, 2026-06-27)

See the "VALIDAT EFECTIV" section for the full command list with results and
durations. This agent itself only read source files; it did not re-run the suite.

## Results

All 14 gates PASSED. Headline counts: unit **332 tests / 34 files**, integration
**37 tests / 7 files**, e2e **24 passed + 1 skipped**; lint clean; typecheck clean
(18 packages + apps/bot + apps/admin); build clean; prod images built clean;
admin + bot `/healthz` OK; **bot connected to Discord** (token valid).

## Problems

None blocking. The only nuance worth recording: a few timing/count figures are
implementation details of the test files at the point of the run and could drift
as tests are added/removed; the *gate pass/fail status* is the durable signal.

## Recommendations

- Keep the clean-room run (`scripts/clean-validate.sh`) as the pre-merge gate; it
  is byte-for-byte the CI sequence.
- Add manual Discord smoke tests (the bot connects, token is valid) — see
  `docs/technical/testing.md` for the full checklist.

## What remains

- Manual Discord smoke tests are NEVALIDAT (require a human + a live Discord
  guild + privileged intents) — documented, not executed.

---

## Testing framework + commands

Single **Vitest** workspace (two projects) for unit/integration, **Playwright**
for e2e. Everything is invoked through Docker Compose against the `app` toolbox
container. All commands below are the exact docker compose forms. (verified in code)

Prerequisite for all of them: dev stack up.

```bash
docker compose up -d --build db app
docker compose exec -T app pnpm install --frozen-lockfile
```

Lint:

```bash
docker compose exec -T app pnpm lint
```

Typecheck:

```bash
docker compose exec -T app pnpm typecheck
```

Format check:

```bash
docker compose exec -T app pnpm format:check
```

Unit tests (`vitest run --project unit`):

```bash
docker compose exec -T app pnpm test:unit
```

Integration tests (`vitest run --project integration`) — needs the DB migrated:

```bash
docker compose exec -T app pnpm db:migrate
docker compose exec -T app pnpm test:integration
```

Unit + integration together (`vitest run --project unit --project integration`):

```bash
docker compose exec -T app pnpm test
```

E2E tests (Playwright; needs `admin` healthy) — runs in the dev container, which
is built from the Playwright image (browsers preinstalled, never run
`playwright install`):

```bash
docker compose up -d bot admin
docker compose exec -T app pnpm test:e2e
```

Or via the dedicated e2e profile service:

```bash
docker compose --profile e2e run --rm e2e
```

Raw Playwright CLI passthrough:

```bash
docker compose exec -T app pnpm playwright --version
```

## Test layers — coverage + real counts

### Unit (project `unit`) — 332 tests / 34 files (validat efectiv)

- Include globs: `packages/*/src/**/*.test.ts`, `packages/*/tests/unit/**`,
  `apps/*/src/**/*.test.ts`, `apps/*/tests/unit/**`. Node environment, fully
  parallel, no DB. (verified in code)
- Covers pure logic across modules: audio (queue, session, resolver + ytdlp/
  spotify providers, commands, now-playing), moderation (warning/action/rule/
  permission services, commands, index), automod matcher, role-menus logic/
  service, announcements, birthdays date-logic, reminders duration,
  scheduled-messages next-run, custom-commands render, cards renderer/storage,
  welcome service, config loader, core (registry, scheduler, module-state),
  security (url-validation, safe-stream), discord-adapter command-mapper, and
  admin unit (validation, bot-client). (verified in code via test-file inventory)
- **Prerequisites:** none beyond `pnpm install`. No DB. (verified in code)

### Integration (project `integration`) — 37 tests / 7 files (validat efectiv)

- Include globs: `packages/*/tests/integration/**/*.test.ts`,
  `apps/*/tests/integration/**/*.test.ts`. (verified in code)
- Runs serially (`fileParallelism:false`, `hookTimeout 60s`, `testTimeout 30s`)
  because all files share one DB. (verified in code)
- Global setup `tests/integration-setup/global-setup.ts` resolves the test DB URL
  (`resolveTestDatabaseUrl`: `TEST_DATABASE_URL` wins, else `DATABASE_URL` with a
  `_test` suffix), connects to the maintenance `postgres` DB, `CREATE DATABASE` if
  missing (name validated against `/^[a-z0-9_]+$/`), then runs migrations.
  (verified in code)
- The 7 files:
  `packages/database/tests/integration/{migrations,repos,audit,playback,moderation}.test.ts`,
  `apps/admin/tests/integration/admin-flows.test.ts`,
  `apps/bot/tests/integration/internal-api.test.ts`. (verified in code)
- Covers: migrations apply cleanly; repo CRUD/upsert dedup; audit-log writes;
  playback persistence; moderation (warnings/actions/rules with cascade delete);
  admin server flows; bot internal API (`/healthz` open, `/internal/*` gated by
  `INTERNAL_TOKEN_HEADER`, audio admin actions audited). (verified in code)
- **Prerequisites:** DB up + migrated; `TEST_DATABASE_URL`/`DATABASE_URL` set
  (provided by `.env` / compose). (verified in code)

### E2E (Playwright, `@botplatform/e2e`) — 24 passed + 1 skipped (validat efectiv)

- `tests/e2e/playwright.config.ts`: `testDir ./playwright`, NOT parallel
  (`workers:1`), `retries` 1 in CI / 0 local, base URL `http://admin:3000`
  (override via `PLAYWRIGHT_BASE_URL`), `timeout 30s`, `expect.timeout 10s`.
  (verified in code)
- Two Playwright projects: `setup` (runs `auth.setup.ts`, logs in as the seeded
  `e2e-admin@example.com`, saves `storageState` to `playwright/.auth/admin.json`)
  and `chromium` (Desktop Chrome, reuses that storage state,
  `dependencies: ['setup']`). (verified in code)
- Global setup `global-setup.ts` polls `admin:3000/healthz` (up to 120s) before
  any test runs. (verified in code)
- 8 spec files: `auth`, `dashboard`, `audio`, `settings`, `audit-logs`, `guilds`,
  `modules`, `commands`. They assert pages render, login/logout + session
  protection work, invalid login shows a safe non-revealing error, and that
  **no stack traces and no secret values** ever appear in the HTML (helper
  `expectNoStackTrace` / `expectNoSecretsRendered`). (verified in code)
- **Prerequisites:** DB up + migrated + seeded (e2e admin user), `admin` service
  healthy, Playwright browsers preinstalled in the dev image (from
  `mcr.microsoft.com/playwright:v1.60.0-noble`). (verified in code)

---

## (A) VALIDAT EFECTIV — ran, with evidence

Executed by the orchestrator on 2026-06-27 (Docker engine 28.0.1, OSType linux,
~4GB), a full clean-room run mirroring `scripts/clean-validate.sh` +
`.github/workflows/ci.yml`. ALL 14 gates PASSED. These are actual executed
outputs.

| # | Command | Result | Duration |
|---|---------|--------|----------|
| 1 | `docker compose down -v` | PASS, wiped all named volumes (pgdata, node_modules, pnpm-store, uploads) | 2s |
| 2 | `docker compose up -d --build db app` | PASS (dev image build was a layer-cache HIT → 10s; a cold/`--no-cache` build is much longer) | 10s |
| 3 | db healthcheck | healthy | — |
| 4 | `docker compose exec -T app pnpm install --frozen-lockfile` | PASS (first install after volume wipe, pnpm-store cold) | 194s (3m13s) |
| 5 | `docker compose exec -T app pnpm lint` (eslint .) | PASS, zero warnings | 8s |
| 6 | `docker compose exec -T app pnpm typecheck` | PASS — all 18 packages + apps/bot + apps/admin | 39s |
| 7 | `docker compose exec -T app pnpm test:unit` | PASS — **332 tests across 34 test files** | 18s |
| 8 | `docker compose exec -T app pnpm db:migrate` | PASS — "migrations applied" | 3s |
| 9 | `docker compose exec -T app pnpm test:integration` | PASS — **37 tests across 7 test files** | 25s |
| 10 | `docker compose exec -T app pnpm db:seed` | PASS — "admin user created: admin@example.com", "admin user created: e2e-admin@example.com", "seed complete" | 3s |
| 11 | `docker compose exec -T app pnpm build` | PASS — tsup ESM bundles for all packages + apps | 4s |
| 12 | `docker compose up -d bot admin` | PASS — admin became healthy; bot health "starting" → healthy | 2s |
| 13 | `curl http://admin:3000/healthz` | `{"status":"ok","checks":{"database":{"status":"ok"}}}` | — |
| 14 | `curl http://bot:8081/healthz` | `{"status":"ok","checks":{"discord":{"status":"ok","detail":"connected"},"database":{"status":"ok"}}}` | — |
| 15 | `docker compose --profile e2e run --rm e2e` (pnpm test:e2e) | PASS — **24 passed, 1 skipped** (Playwright, chromium project) | 11s |
| 16 | `docker compose -f docker-compose.prod.yml build` | PASS — built images: admin, bot, migrate | 163s |

Final `docker compose ps` at end of run: db healthy, app up, admin healthy
(`0.0.0.0:3000->3000`), bot up (health starting → ok).

**CRITICAL FINDING:** the bot SUCCESSFULLY CONNECTS to Discord (bot `/healthz` →
`checks.discord.status="ok"`, `detail="connected"`). The `DISCORD_TOKEN` in the
local `.env` is therefore VALID. This SUPERSEDES the stale "malformed token" note
in older project memory — do not repeat that claim.

## (B) DEDUS din cod — inferred from source, not separately re-measured

- The 34 unit test files map to specific module/package logic areas (queue,
  resolver, moderation services, etc.) per the file inventory; the 332 number is
  the executed total, but per-file test counts were not individually itemized.
- `pnpm test` (unit + integration combined) is expected to total ~369 tests
  (332 + 37); only the two layers were run separately, so the combined figure is
  arithmetic, not separately measured.
- `pnpm format:check` (prettier --check) is wired but was NOT one of the 14
  executed gates; it is expected to pass given lint is clean, but that is
  inference, not execution.
- The `e2e` profile service and `docker compose exec -T app pnpm test:e2e` are
  two routes to the same Playwright run; the orchestrator used the profile route.

## (C) NEVALIDAT — not run, and why

- **`pnpm format:check`** — not part of the 14 executed gates (NEVALIDAT; would
  need a separate run).
- **All manual Discord smoke tests** — require a human operator, a live Discord
  guild, real users, and privileged Gateway intents (e.g. GuildMembers for
  member-join). Documented as a checklist in `docs/technical/testing.md` but NOT
  executed (NEVALIDAT).
- **Privileged-intent member-join (welcome) behaviour** — the GuildMembers intent
  is gated behind an opt-in flag (see recent commit history); end-to-end member
  join was not exercised (NEVALIDAT).
- **Real audio playback to a voice channel** (`/play` producing audible output)
  — automated suite mocks/asserts logic; no real voice-channel playback was
  executed (NEVALIDAT).

---

## Checkpoint

Status: PASS

### Validat
- Full clean-room pipeline executed 2026-06-27, all 14 gates PASS (lint,
  typecheck, unit 332/34, integration 37/7, migrate, seed, build, e2e 24+1,
  prod image build, admin+bot healthz, bot Discord connected). (validat efectiv)
- Test framework wiring (vitest projects, integration global-setup, Playwright
  config + auth setup + global health gate) read and documented. (verified in code)
- Bot connects to Discord — local `DISCORD_TOKEN` is valid. (validat efectiv)

### Nevalidat
- `pnpm format:check` (prettier) — wired but not part of the executed gates.
- Manual Discord smoke tests (slash registration, `/play` audio, member-join
  welcome, permission failure, invalid-config, DB-persistence after restart) —
  documented as a checklist, require a human + live guild + intents.

### Probleme
- None blocking. Per-test counts may drift as tests change; rely on gate
  pass/fail as the durable signal.

### Următorul agent poate continua?
Da. The testing pipeline is fully documented and validated by execution. The only
outstanding work is human-driven manual Discord smoke testing, captured as a
ready-to-run checklist in `docs/technical/testing.md`.
