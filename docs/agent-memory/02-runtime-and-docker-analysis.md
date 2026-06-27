# 02 — Runtime & Docker Analysis

> Agent: **AGENT 2 — RUNTIME & DOCKER**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (all paths below are relative to it)

## Agent purpose

Document the complete Docker-first runtime of the **botplatform** monorepo: every
Docker file (dev image, prod multi-stage image, dev compose, prod compose,
`.dockerignore`), every service (db / app / bot / admin / e2e + the prod-only
migrate/seed one-shots), the exact operator commands (build, bring-up, install,
migrate, seed, register Discord commands, tests, psql, backup/restore, prod
up/down) in both raw `docker compose` and `make` form, and a "first run from
zero" runbook plus the day-to-day loop. The host has **no Node** — everything
runs in Linux Docker containers. This file is the agent-memory record; the
polished runbook lives in `docs/technical/runtime-and-docker.md`.

## Files analyzed (verified by reading)

- `Dockerfile` — prod multi-stage image (read in full).
- `Dockerfile.dev` — dev/toolbox image (read in full).
- `docker-compose.yml` — DEV compose, services db/app/bot/admin/e2e (read in full).
- `docker-compose.prod.yml` — PROD standalone compose + migrate/seed (read in full).
- `.dockerignore` (read in full).
- `Makefile` — optional wrappers (read in full).
- `scripts/dev-entry.sh` — bot/admin dev entrypoint (read in full).
- `scripts/clean-validate.sh` — clean-room validation driver (read in full).
- `.github/workflows/ci.yml` — CI (validate + docker-prod + secret-scan) (read in full).
- `.env.example` — compose variable defaults reference (read in full).
- `.npmrc` — hoisted node-linker (read in full).
- `pnpm-workspace.yaml` — workspace globs + version catalog (read in full).
- `package.json` (root) — script targets (read in full).
- `apps/bot/package.json`, `packages/database/package.json` — verified the actual
  commands behind `db:migrate`, `db:seed`, `discord:register-commands`, `dev`.
- `.gitattributes` — LF enforcement for `*.sh` (read).

Cross-referenced (not re-derived): `docs/agent-memory/05-environment-and-configuration.md`,
`docs/technical/environment.md` for env-var semantics. **Not touched:**
`docs/agent-memory/music/*` (owned by another process).

## What was discovered

### The "no Node on host" model (verified in code)

The only host requirement is Docker. `Dockerfile.dev` (the dev image) bundles
Node 24, pnpm `10.34.3`, ffmpeg, `yt-dlp` `2026.06.09`, postgresql-client,
build toolchain (python3/make/g++), git, curl, and — because it is based on
`mcr.microsoft.com/playwright:v1.60.0-noble` — all Playwright browsers under
`/ms-playwright`. The README workflow (in `docker-compose.yml` header and
`.env.example`) and CI both run **every** pnpm command via
`docker compose exec app …`.

### Dev dependency model: shared named volume + manual install (verified in code)

`.npmrc` sets `node-linker=hoisted` → a single flat `node_modules` at repo root.
`docker-compose.yml` mounts that path as a **named volume** `node_modules`
(NOT on the Windows bind mount) shared by all four dev services. The volume
starts **empty**; the developer must run `docker compose exec app pnpm install`
once. The `app` service is a `sleep infinity` toolbox; `bot` and `admin` run
`scripts/dev-entry.sh`, which **idles in a loop** until
`/workspace/node_modules/.modules.yaml` exists (pnpm's "install complete"
marker), then `exec pnpm --filter @botplatform/<bot|admin> dev` (a `tsx watch`).
This is why `bot`/`admin` healthchecks have a generous `start_period: 90s`.

### Prod image model: tsup-bundled, runs as non-root (verified in code)

`Dockerfile` is multi-stage with five targets:
- `builder` (`node:24-bookworm`): full `pnpm install --frozen-lockfile` + `pnpm
  build`; tsup **inlines** all `@botplatform/*` workspace code into each app's
  `dist/`, leaving only external/native deps to `require()` at runtime.
- `proddeps` (`node:24-bookworm`): copies **only manifests** then
  `pnpm install --prod --frozen-lockfile` → cached until a `package.json`/lockfile
  changes. Native modules (`@discordjs/opus`, `argon2`) compile here (hence
  python3/make/g++).
- `runtime-base` (`node:24-bookworm-slim`): ffmpeg, curl, ca-certificates,
  python3, fonts-dejavu-core + fontconfig (for the cards module's resvg
  `loadSystemFonts`), `yt-dlp` `2026.06.09`; `ENV NODE_ENV=production`.
- `bot` (from runtime-base): proddeps node_modules + `apps/bot/dist` +
  `packages/database/migrations` (`ENV MIGRATIONS_DIR=/app/migrations`);
  `mkdir /app/uploads` owned by `node`; `USER node`; `EXPOSE 8081`;
  HEALTHCHECK `curl http://localhost:${HEALTH_PORT:-8081}/healthz`;
  `CMD ["node","dist/main.js"]`. This same image also carries `dist/migrate.js`
  and `dist/seed.js`, reused by the prod `migrate` and `seed` services.
- `admin` (from runtime-base): proddeps node_modules + `apps/admin/dist` +
  `views` (EJS templates) + `public` (static assets, served from disk, not
  bundled); `USER node`; `EXPOSE 3000`; HEALTHCHECK
  `curl http://localhost:${ADMIN_PORT:-3000}/healthz`;
  `CMD ["node","dist/main.js"]`.

### Service topology

| Service | Image | Dev role | Prod role | Port (host) | Depends on |
| --- | --- | --- | --- | --- | --- |
| `db` | `postgres:18-alpine` | dev DB | prod DB | none published | — |
| `app` | `botplatform-dev` (Dockerfile.dev) | toolbox (`sleep infinity`) | not in prod | none | db (healthy) |
| `bot` | dev: `botplatform-dev` / prod: `botplatform-bot` (target `bot`) | tsx watcher via dev-entry | Discord worker + internal API | none (8081 internal only) | dev: db; prod: db + migrate(completed) |
| `admin` | dev: `botplatform-dev` / prod: `botplatform-admin` (target `admin`) | tsx watcher via dev-entry | Fastify SSR panel | `${ADMIN_PORT:-3000}:3000` | dev: db; prod: db + migrate(completed) |
| `e2e` | `botplatform-dev` (profile `e2e`) | Playwright runner | n/a | none | admin (healthy) |
| `migrate` | `botplatform-bot` (target `bot`) | n/a | one-shot `node dist/migrate.js` | none | db (healthy) |
| `seed` | `botplatform-bot` (profile `seed`) | n/a | one-shot `node dist/seed.js` | none | db (healthy) |

### Ports, healthchecks, volumes (verified in code)

- **Postgres `db`**: port **5432 NOT published** in either compose (the host has
  no psql; use `docker compose exec db psql`). Dev compose has a commented
  `5432:5432` to attach a GUI client. Healthcheck `pg_isready -U $POSTGRES_USER
  -d $POSTGRES_DB`, interval 5s / timeout 3s / retries 10. Volume mounted at
  **`/var/lib/postgresql`** (postgres:18+ moved it up from the pre-18
  `/var/lib/postgresql/data`) → dev volume `pgdata`, prod volume `pgdata-prod`.
- **admin** publishes `${ADMIN_PORT:-3000}:${ADMIN_PORT:-3000}` (only host-exposed
  service). Healthcheck `curl http://localhost:${ADMIN_PORT:-3000}/healthz`.
- **bot** publishes nothing; internal API on `HEALTH_PORT` (default 8081) is
  Docker-network-only. Dev healthcheck `curl
  http://localhost:${HEALTH_PORT:-8081}/healthz` (start_period 90s, 10 retries);
  prod healthcheck baked into the image (start-period 30s, 5 retries).
- **Dev volumes** (`x-dev-volumes` anchor, shared by app/bot/admin/e2e):
  bind `.:/workspace`; named `node_modules:/workspace/node_modules`; named
  `pnpm-store:/root/.local/share/pnpm`; named `uploads:/workspace/uploads`.
- **Prod volumes**: named `pgdata-prod:/var/lib/postgresql`; `uploads-prod`
  mounted into bot and admin at `/app/uploads`. No source bind mount in prod.

### Env passthrough (verified in code)

Dev compose `x-dev-environment` passes ~30 vars with **safe dev defaults**
matching `.env.example` (e.g. `DATABASE_URL` default
`postgres://botplatform:change_me_dev_password@db:5432/botplatform`; Discord vars
default empty so the platform runs with no Discord connection). Prod compose
`x-app-environment` uses **`${VAR:?message}` required syntax** for
`DATABASE_URL`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`, and `POSTGRES_PASSWORD`
— compose refuses to start until real values are supplied; there are **no dev
fallbacks for secrets** in the prod file. `COOKIE_SECURE` defaults `false` in dev,
`true` in prod.

### Networks

Neither compose file declares an explicit `networks:` block, so each project uses
its **default compose bridge network** (`botplatform_default` for dev,
`botplatform-prod_default` for prod). Services reach each other by service name
(`db`, `bot`, `admin`) — e.g. `DATABASE_URL=…@db:5432/…`,
`BOT_INTERNAL_URL=http://bot:8081`, `PLAYWRIGHT_BASE_URL=http://admin:3000`.
The dev and prod stacks have **distinct project names** (`name: botplatform` vs
`name: botplatform-prod`) so they do not collide.

### .dockerignore (verified in code)

Excludes `node_modules`, `dist`, `.git`, `.env`/`.env.*` (but keeps
`.env.example`), coverage/playwright-report/test-results/blob-report, logs,
IDE files, `docs`, `README.md`. So the prod `builder` stage copies source +
manifests only, and `.env` is never baked into an image.

### CI (verified in code)

`.github/workflows/ci.yml` has three jobs, all on `ubuntu-latest`, no Node on the
runner:
1. **validate** — `cp .env.example .env` → build dev image → up db+app → install
   → lint → typecheck → unit → migrate → integration → seed → build → up
   bot+admin → wait for admin healthz → e2e → always `docker compose logs` +
   `down -v`. This mirrors `scripts/clean-validate.sh`.
2. **docker-prod** — `docker build --target bot` and `--target admin` (proves the
   prod image builds).
3. **secret-scan** — gitleaks over full history.

## Commands run (by this agent)

Read-only filesystem inspection only (Read tool, plus a few `ls`/`grep` via Bash
to confirm script targets):

```bash
ls -la "docs/agent-memory/" "docs/technical/" "scripts/"
grep -A20 '"scripts"' apps/bot/package.json
grep -A12 '"scripts"' packages/database/package.json
cat .gitattributes
```

**This agent did NOT run any docker build / up / down** — the stack was already
up and another process may be using it. The validation evidence below was
executed by the **main orchestrator** on 2026-06-27.

## Results — REAL clean-room VALIDATION run

Executed by the main orchestrator on **2026-06-27** (Docker engine 28.0.1,
OSType linux, ~4GB), a full clean-room run mirroring `scripts/clean-validate.sh`
+ `.github/workflows/ci.yml`. **ALL 14 GATES PASSED.** These are ACTUAL executed
outputs — cite as *"verified by execution on 2026-06-27"*, not deduced.

| # | Command | Result | Duration |
| --- | --- | --- | --- |
| 1 | `docker compose down -v` | PASS — wiped all named volumes (pgdata, node_modules, pnpm-store, uploads) | 2s |
| 2 | `docker compose up -d --build db app` | PASS — dev image build was a Docker layer-cache **HIT** → 10s; a cold `--no-cache` build is much longer | 10s |
| 3 | db healthcheck | **healthy** | — |
| 4 | `docker compose exec -T app pnpm install --frozen-lockfile` | PASS — first install after volume wipe, pnpm-store cold | 194s (3m13s) |
| 5 | `docker compose exec -T app pnpm lint` (`eslint .`) | PASS — zero warnings | 8s |
| 6 | `docker compose exec -T app pnpm typecheck` | PASS — all 18 packages + apps/bot + apps/admin | 39s |
| 7 | `docker compose exec -T app pnpm test:unit` | PASS — **332 tests** across 34 test files | 18s |
| 8 | `docker compose exec -T app pnpm db:migrate` | PASS — "migrations applied" | 3s |
| 9 | `docker compose exec -T app pnpm test:integration` | PASS — **37 tests** across 7 test files | 25s |
| 10 | `docker compose exec -T app pnpm db:seed` | PASS — created `admin@example.com` + `e2e-admin@example.com`, "seed complete" | 3s |
| 11 | `docker compose exec -T app pnpm build` | PASS — tsup ESM bundles for all packages + apps | 4s |
| 12 | `docker compose up -d bot admin` | PASS — admin healthy; bot health starting→healthy | 2s |
| 13 | `curl http://admin:3000/healthz` | `{"status":"ok","checks":{"database":{"status":"ok"}}}` | — |
| 14 | `curl http://bot:8081/healthz` | `{"status":"ok","checks":{"discord":{"status":"ok","detail":"connected"},"database":{"status":"ok"}}}` | — |
| 15 | `docker compose --profile e2e run --rm e2e` (`pnpm test:e2e`) | PASS — **24 passed, 1 skipped** (Playwright, chromium) | 11s |
| 16 | `docker compose -f docker-compose.prod.yml build` | PASS — built images: admin, bot, migrate | 163s |

Final `docker compose ps`: db healthy, app up, admin healthy
(`0.0.0.0:3000->3000`), bot up (health starting→ok).

### Critical finding (verified by execution)

The bot **successfully connects to Discord** (bot `/healthz` →
`checks.discord.status="ok"`, `detail="connected"`). The `DISCORD_TOKEN` in the
local `.env` is therefore **VALID**. This **supersedes** any older "malformed
token" note in project memory — do not repeat that claim.

## Problems / gotchas (verified in code)

- **node_modules volume starts empty** → on first boot `bot`/`admin` sit in the
  dev-entry wait loop printing
  `waiting for dependencies — run: docker compose exec app pnpm install`
  until you run the install. This is by design, not a failure.
- **Postgres 18 volume path**: the mount is `/var/lib/postgresql` (not the
  pre-18 `…/data`). A migration of an old `pgdata` volume would need care.
- **`scripts/*.sh` must be LF** (enforced by `.gitattributes`); CRLF breaks bash
  inside the container — relevant when editing on Windows.
- **Prod secrets fail loud**: `docker compose -f docker-compose.prod.yml up`
  errors immediately if `DATABASE_URL` / `SESSION_SECRET` /
  `INTERNAL_API_TOKEN` / `POSTGRES_PASSWORD` are unset. Intended.
- **5432 not published**: any host-side DB GUI requires uncommenting the
  `5432:5432` port in dev compose (or use `docker compose exec db psql`).
- **Dockerfile.dev runs as root** on purpose (Windows bind-mount permissions);
  the prod images run as the unprivileged `node` user.
- **Playwright image tag pin**: `Dockerfile.dev` base
  (`mcr.microsoft.com/playwright:v1.60.0-noble`) MUST match the
  `@playwright/test` catalog pin (`1.60.0`) or Playwright refuses to run.

## Recommendations

- Keep `scripts/clean-validate.sh` as the canonical local gate — it is identical
  to CI's `validate` job and was re-confirmed green on 2026-06-27.
- For first boot, follow the runbook in `docs/technical/runtime-and-docker.md`
  exactly (install → migrate → seed before opening the panel).
- When bumping Node, pnpm, yt-dlp, or Playwright, update them in lockstep across
  `Dockerfile`, `Dockerfile.dev`, and `pnpm-workspace.yaml` (catalog).

## What remains

- Documenting the migrate/seed CLI internals (Drizzle journal, idempotency of
  the seeder) belongs to the database/agent-05 workstreams, not here.
- Production reverse-proxy / TLS termination in front of admin:3000 is **not**
  in the repo (no nginx/caddy/traefik config present) — out of scope; note it as
  an operator responsibility (`COOKIE_SECURE=true` assumes HTTPS upstream).

## Checkpoint

Status: PASS

### Validat
- All Docker files read in full and documented: `Dockerfile` (5 targets),
  `Dockerfile.dev`, `docker-compose.yml` (db/app/bot/admin/e2e),
  `docker-compose.prod.yml` (db/migrate/seed/bot/admin), `.dockerignore`.
- Service topology, ports, healthchecks, volumes, env passthrough, networks —
  all verified against the compose/Dockerfile source.
- Operator commands cross-checked against `Makefile`, root `package.json`,
  `apps/bot/package.json`, `packages/database/package.json`.
- The 14-gate clean-room validation run (2026-06-27) recorded as REAL executed
  evidence, including bot↔Discord "connected".

### Nevalidat
- This agent ran NO docker commands itself (stack was up; orchestrator already
  executed the validation). All command outputs above are the orchestrator's
  executed results, not re-run here.
- Cold `--no-cache` dev image build time (validation hit the layer cache → 10s;
  cold is "much longer", exact figure not measured).
- Prod runtime bring-up to healthy (`docker-compose.prod.yml up`) was **built**
  (gate 16) but not run to a healthy admin/bot in this validation pass.

### Probleme
- None blocking. Documented gotchas: empty node_modules volume on first boot,
  postgres-18 volume path, LF-only shell scripts, fail-loud prod secrets,
  unpublished 5432, no bundled reverse proxy for prod TLS.

### Următorul agent poate continua?
Da. Runtime/Docker is fully documented in both this file and
`docs/technical/runtime-and-docker.md`. A new agent can boot the stack from zero
using the runbook without guessing any command. Remaining items (DB CLI
internals, prod TLS proxy) are explicitly flagged and out of this agent's scope.
