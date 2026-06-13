# Testing

Three layers, all executed **inside Docker** — never on the Windows host.
Current counts (all passing in validation): **314 unit / 37 integration /
23 e2e**. Every community module ships unit tests for its pure logic
(announcement validation + mass-mention safety, card rendering/placeholders/
storage, role-menu role-change computation, schedule next-run with timezones
+ cron, reminder duration parsing, birthday date logic, moderation command
guards, automod rule matching, custom-command rendering).

## Unit tests (vitest, no I/O)

```bash
docker compose exec app pnpm test:unit
```

Coverage highlights:

- `config` — env parsing, defaults, coercion, secret-free error messages
- `security` — URL validation matrix (schemes, credential URLs, localhost,
  every private/link-local/CGNAT/metadata range incl. IPv6 + IPv4-mapped,
  allowlist semantics), safe-stream redirect orchestration (re-validation per
  hop, redirect caps, status/content-type gates, safe error wrapping)
- `core` — registry/dispatch error boundary, disabled-module behavior,
  guild-only blocking, cached module state (TTL, fallback)
- `audio-module` — queue bounds/order, session lifecycle (advance, error
  cutoff, duration timer with fake clocks, suppressed intentional stops,
  persistence resilience), resolver/provider selection + laziness, and
  every slash command's specified edge cases
- `discord-adapter` — command JSON mapping, registration routes (injected
  REST double), reply normalization
- `moderation-module` — services with faked repos, permission checks
- `apps/admin` — guild-settings input validation, bot client (URL building,
  offline tolerance)

Unit tests live next to the code (`src/**/*.test.ts`) or in `tests/unit/`.

## Integration tests (vitest + real PostgreSQL)

```bash
docker compose exec app pnpm test:integration
```

- A vitest **global setup** (`tests/integration-setup/global-setup.ts`)
  creates `botplatform_test` (from `TEST_DATABASE_URL`) if missing and runs
  the real Drizzle migrations against it. The dev database is never touched.
- `packages/database/tests/integration` — migrations create all 14 tables;
  repository round-trips; audit port redaction + never-throws guarantee;
  playback history/queue mirror; moderation records.
- `apps/admin/tests/integration` — the full HTTP story via `fastify.inject`:
  healthz, login form + CSRF harvesting, wrong-password (generic message,
  audited), session cookie flow, dashboard rendering, module toggle
  persistence + audit + restore, CSRF rejection without raw error codes,
  secret-leak scan across all pages, logout, login rate limit (429).
- `apps/bot/tests/integration` — internal API auth (401 without/with wrong
  token), status shape, audio admin actions + audit, via structural fakes.

Files run sequentially (`fileParallelism: false`) since they share one DB.

## E2E tests (Playwright, inside the dev container)

```bash
docker compose exec app pnpm test:e2e
# or as a one-shot service:
docker compose --profile e2e run --rm e2e
```

- The dev image **is** the official Playwright image — browsers preinstalled;
  never run `playwright install`, never install anything on Windows.
- Tests target the running `admin` service at `http://admin:3000`
  (`PLAYWRIGHT_BASE_URL`). A global setup polls `/healthz` for up to 2 min.
- An auth **setup project** logs in once as the seeded
  `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` user and shares storage state.
- Specs: login page renders; invalid login fails safely (generic error, no
  stack traces, no which-field hints); valid login → dashboard; dashboard
  shows adapter state/database health/modules/version; module toggle +
  restore with audit verification; audio page (limits, sessions/empty state,
  errors section); guild settings page; audit logs table + filter; system
  settings; **a secret-leak assertion across every page**; logout.
- Failure artifacts: `tests/e2e/playwright-report/` (HTML) and
  `test-results/` (screenshots, traces on retry).

Prerequisite: seeded admin users (`pnpm db:seed`) and the `admin` service up.

## Lint, types, build

```bash
docker compose exec app pnpm lint
docker compose exec app pnpm typecheck   # tsc --noEmit in all 13 projects
docker compose exec app pnpm build       # tsup bundles both apps
```

## CI (GitHub Actions, `.github/workflows/ci.yml`)

Three jobs on every push/PR:

1. **validate** — the *exact* local Docker workflow on an ubuntu runner:
   compose build → up db+app → `pnpm install --frozen-lockfile` → lint →
   typecheck → unit → migrate → integration → seed → build → up bot+admin →
   wait for health → e2e → logs + teardown. Playwright report uploaded on
   failure.
2. **docker-prod** — builds both production image targets.
3. **secret-scan** — gitleaks over the full history; the build fails on
   committed secrets.

A red check on any step blocks the pipeline — broken code is never deployed.
