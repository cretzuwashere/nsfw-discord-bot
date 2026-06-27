# 08 — Testing (agent memory)

Notes for the TESTING author pass. Target deliverable:
`docs/technical/testing.md`. Written 2026-06-27.

## What was done

- Read and verified against code:
  - `vitest.config.ts` — two projects (`unit`, `integration`); integration has
    `fileParallelism: false`, `globalSetup`, `hookTimeout 60s`, `testTimeout 30s`.
  - `tests/integration-setup/global-setup.ts` — creates the `_test` DB (with a
    `/^[a-z0-9_]+$/` name guard) and runs all migrations before any integration
    test.
  - `packages/database/src/test-url.ts` — `resolveTestDatabaseUrl()`:
    `TEST_DATABASE_URL` wins, else `DATABASE_URL` is suffixed with `_test`.
  - `tests/e2e/playwright.config.ts` + all spec/helper/setup files.
  - `Dockerfile.dev` (Playwright base `v1.60.0-noble`, browsers preinstalled),
    `docker-compose.yml` (e2e profile, env block, `TEST_DATABASE_URL`),
    `.github/workflows/ci.yml`, root `package.json` scripts.
- Re-counted on disk: **46 unit test files** (44 under `packages/*/src`, 2 under
  `apps/admin/tests/unit`; the `packages/*/tests/unit` and `apps/*/src` globs
  match nothing today). **7 integration test files** (5 database, 1 admin, 1
  bot). E2E: **25 test blocks** (1 setup + 24 chromium) across 8 spec files,
  with 2 runtime `test.skip()` branches in `audit-logs.spec.ts`.
- Confirmed the validation totals are internally consistent: unit 471/46,
  integration 37/7, e2e 24 passed / 1 skipped (the 1 skip = one optional
  audit-log control absent).

## Key facts captured in the doc

- All commands in `docker compose exec -T app pnpm ...` form; canonical e2e run
  is `docker compose --profile e2e run --rm e2e`.
- Per-layer prerequisites; integration DB isolation via `_test` suffix + per-suite
  `afterAll` cleanup (no per-test rollback, DB reused across runs).
- Real results table (verified by execution on 2026-06-27, warm stack) including
  bot/admin `/healthz` payloads, prod-image build, lint/typecheck/build clean.
- VALIDAT-EFECTIV / DEDUS / NEVALIDAT split.
- Manual Discord smoke-test checklist: bot connect, register-commands, `/play`
  audio, member-join welcome behind GuildMembers intent, non-mod moderation
  refusal, raise-hand multi-user flow, economy/levels persistence across
  `docker compose restart bot` (not `down -v`).

## Confirmed gaps (documented as real)

- 9 newest modules (raise-hand, fun-commands, engagement-prompts, giveaways,
  server-stats, trivia, minigames, economy, levels) have no dedicated admin
  route / e2e page; only unit-test coverage.
- No live-Discord automated coverage (voice/gateway). No clean-room `down -v`
  run this pass.

## Checkpoint

Status: PASS

### Validat
- `vitest.config.ts` two-project structure, integration serial + globalSetup.
- Test DB isolation mechanism (`resolveTestDatabaseUrl`, `_test` suffix, name
  guard, CREATE-DATABASE-if-missing + migrate).
- E2E config (Playwright in dev image, admin baseURL, setup→chromium projects,
  health-poll global setup) and the full spec inventory.
- Unit file count = 46, integration file count = 7 (re-counted on disk).
- All test commands (compose form) against `package.json` scripts + CI workflow.
- Validation result numbers (471/46, 37/7, 24/1, prod-build) recorded verbatim,
  cited as "verified by execution on 2026-06-27".

### Nevalidat
- Did NOT re-run the suites in this pass (no exec); per-test totals 471/37 are
  taken from the orchestrator's execution block, not re-measured here.
- No clean-room `docker compose down -v` run.
- No live-Discord behaviours exercised (covered only by the manual checklist).

### Probleme
- The pre-existing `docs/technical/testing.md` was stale ("Testing Guide",
  smaller-repo era); it was fully overwritten with verified current content.

### Următorul agent poate continua?
Da. Doc is complete and consistent with the verified validation block. If a
future pass re-runs the suites, refresh the result counts and the per-module
admin-route gap (which will shrink as routes are added for the 9 newer modules).
