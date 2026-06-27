# Agent memory — Runtime & Docker (tech-docs/02)

**Author role:** RUNTIME & DOCKER. **Date:** 2026-06-27.
**Deliverable:** `docs/technical/runtime-and-docker.md` (operator runbook, rewritten over the stale 11-module version).

## What this covers

- Two-image model: dev (`Dockerfile.dev`, Playwright base `v1.60.0-noble`, root, fat toolbox) vs prod (`Dockerfile` multi-stage: builder/proddeps/runtime-base/bot/admin, `node` user, slim).
- The "app toolbox + bot/admin wait-for-node_modules" model: `app` = `sleep infinity`; `node_modules` is a named volume that starts empty; `scripts/dev-entry.sh` polls `node_modules/.modules.yaml` then runs the tsx watcher.
- Dev services (db/app/bot/admin/e2e), prod services (db/migrate/seed/bot/admin), ports (admin 3000 only; db 5432 unpublished; bot 8081 internal), volumes (pgdata/node_modules/pnpm-store/uploads dev; pgdata-prod/uploads-prod prod), healthchecks (compose for dev; baked HEALTHCHECK for prod).
- Exact commands raw + `make` for build/up/down/restart/logs/ps/shell/install/lint/typecheck/test/build/migrate/seed/setup/register-commands/e2e/psql/backup/restore/prod.
- From-zero runbook, day-to-day loop, schema-change loop, clean-validate / CI parity (3 CI jobs: validate, docker-prod, secret-scan).
- 2026-06-27 execution evidence cited and clearly separated from from-files content.

## Key real finding (documented as a gap, NOT fixed)

`Dockerfile` `proddeps` stage (lines 70-90) COPYs workspace manifests one-per-line and lists only 18 (6 infra + discord-adapter + 11 modules). It is MISSING the 9 newest module manifests (raise-hand, fun-commands, engagement-prompts, giveaways, server-stats, trivia, minigames, economy, levels), all of which `apps/bot/package.json` depends on via `workspace:*`. The 2026-06-27 prod build reportedly PASSED — most likely a cached `proddeps` layer masking it. Flagged in §9.1 with the real test: `docker build --no-cache --target bot -t botplatform-bot .`. Dev path is unaffected (whole repo bind-mounted).

## Checkpoint

Status: PASS

### Validat (verified in code)
- All infra files read: `Dockerfile`, `Dockerfile.dev`, `docker-compose.yml`, `docker-compose.prod.yml`, `.dockerignore`, `Makefile`, `scripts/dev-entry.sh`, `scripts/clean-validate.sh`, `scripts/check-admin-pages.sh`, `.github/workflows/ci.yml`.
- Cross-checked against `package.json` (scripts incl. `db:setup`, `discord:register-commands`), `pnpm-workspace.yaml` (catalog, Playwright pin 1.60.0, onlyBuiltDependencies), `apps/bot/package.json` (depends on all 20 modules), `packages/database/package.json` (migrate/seed CLIs).
- Services/ports/volumes/healthchecks tables match files exactly.
- proddeps stale-manifest gap confirmed by direct read (18 listed, 9 missing).

### Validat (verified by execution on 2026-06-27, warm stack)
- install / migrate(10) / lint / typecheck(31 projects) / test:unit(471/46) / test:integration(37/7) / build all PASS; bot+admin /healthz ok (Discord connected); e2e 24 passed/1 skipped; prod build 3 images ~60s. Cited verbatim; flagged as warm-stack, point-in-time.

### Nevalidat (not run this pass — stack was up, instructed not to down it)
- `docker build --no-cache` prod images (needed to confirm/deny §9.1 gap impact).
- `docker compose down -v` clean room.
- `scripts/check-audio-stack.ts` runtime output (file existence verified, not executed).

### Probleme
- §9.1 prod `proddeps` manifest gap vs reported prod-build PASS is an unresolved contradiction; documented honestly with the exact command to settle it. Likely Docker layer cache.
- `scripts/check-admin-pages.sh` route list is also stale (missing the 9 newest modules) — noted in §8; consistent with MEMORY's "9 newest modules have no dedicated admin route yet" gap.

### Următorul agent poate continua?
Da. Next agent should: (1) run `docker build --no-cache --target bot .` to confirm the §9.1 gap and, if it fails, add the 9 missing COPY lines; (2) refresh `scripts/check-admin-pages.sh` once admin routes for the 9 new modules exist. Runbook is otherwise complete and self-contained.
