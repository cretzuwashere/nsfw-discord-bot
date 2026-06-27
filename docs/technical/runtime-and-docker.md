# Runtime & Docker — Operator Runbook

> **Audience:** anyone operating the `botplatform` stack on the Windows host (or
> a Linux CI runner). The host needs **only Docker Desktop** — there is no
> Node.js, pnpm, ffmpeg, psql, or Playwright on the host. Every toolchain
> command runs **inside a Linux container** via `docker compose exec app …`.
>
> **Evidence legend used throughout this doc:**
> - **[verified in code]** — read directly from the infra file cited.
> - **[verified by execution on 2026-06-27]** — run by the orchestrator against
>   the *running warm dev stack* on 2026-06-27 ~12:19 (not a clean-room
>   `down -v` this pass; a full clean-room ran earlier the same day on a smaller
>   snapshot of the repo). Counts are point-in-time.
> - **[deduced]** — inferred from the files; not separately executed.
>
> **Repo root:** `C:/Projects/Mods/Fable - Mod`. Run every command from the repo
> root unless stated otherwise.

---

## 1. The mental model

### 1.1 Two images, one philosophy

| Image | Built from | Used by | Purpose |
|-------|-----------|---------|---------|
| **Dev image** (`botplatform-dev`) | `Dockerfile.dev` | dev compose `app`, `bot`, `admin`, `e2e` | Fat toolbox: Node 24, pnpm, ffmpeg, psql, yt-dlp, **Playwright browsers**, compilers. One image, four services, command differs. |
| **Prod images** (`botplatform-bot`, `botplatform-admin`) | `Dockerfile` (multi-stage) | prod compose `migrate`, `seed`, `bot`, `admin` | Slim runtime, bundled app code, production-only deps, runs as unprivileged `node` user. |

The dev image is **the only toolchain a developer needs on the host** —
everything else lives in Linux. [verified in code: `Dockerfile.dev` header]

### 1.2 The "app toolbox + bot/admin wait-for-node_modules" model

This is the single most important runtime concept. [verified in code:
`docker-compose.yml`, `scripts/dev-entry.sh`]

- **`app`** is a long-lived **toolbox** container whose only command is
  `sleep infinity` (`docker-compose.yml` line 112). It never runs the bot or
  admin. You exec into it to run pnpm / tests / lint / migrate / seed.
- **`node_modules` is a named Docker volume** (`node_modules:/workspace/node_modules`),
  **not** on the Windows bind mount. It starts **empty** on first boot. You
  populate it once, manually:
  ```bash
  docker compose exec app pnpm install
  ```
  Installs are deliberately manual so the four services never race each other on
  the shared volume. [verified in code: `scripts/dev-entry.sh` comments]
- **`bot` and `admin`** start immediately but **idle politely** until that
  install finishes. `scripts/dev-entry.sh` loops every 5s waiting for
  `/workspace/node_modules/.modules.yaml` (pnpm's "install complete" marker),
  then `exec pnpm --filter "@botplatform/<bot|admin>" dev` (the tsx watcher).
  Net effect: `docker compose up -d` **always succeeds immediately** — services
  wait for deps instead of crash-looping. [verified in code:
  `scripts/dev-entry.sh` lines 16-22]

> **Consequence:** if `bot`/`admin` logs show
> `[dev-entry] waiting for dependencies — run: docker compose exec app pnpm install`,
> you simply have not run the install step yet. Run it; the watchers start on
> their own within 5s.

### 1.3 Source code: bind-mounted, hot-reloaded

The repo is bind-mounted at `/workspace` (`.:/workspace`). `tsx watch` in the
`bot`/`admin` watchers picks up host edits live — no rebuild needed for source
changes. [verified in code: `docker-compose.yml` x-dev-volumes;
`apps/bot/package.json` `"dev": "tsx watch src/main.ts"`]

You only rebuild the **image** when `Dockerfile.dev` itself changes (new system
package, new yt-dlp/pnpm pin). Dependency changes (package.json / lockfile) need
a re-run of `pnpm install`, not an image rebuild. [deduced]

---

## 2. Services, ports, volumes, healthchecks

### 2.1 Dev stack (`docker-compose.yml`, compose project name `botplatform`)

| Service | Image | Command | Published port | Depends on | Healthcheck |
|---------|-------|---------|----------------|-----------|-------------|
| **db** | `postgres:18-alpine` | (default) | **none** (5432 intentionally not published) | — | `pg_isready -U botplatform -d botplatform`, 5s/3s, 10 retries |
| **app** | `botplatform-dev` | `sleep infinity` | none | db (healthy) | none (toolbox) |
| **bot** | `botplatform-dev` | `bash scripts/dev-entry.sh bot` | **none** (internal API only) | db (healthy) | `curl http://localhost:${HEALTH_PORT:-8081}/healthz`, 15s/5s, start_period 90s, 10 retries |
| **admin** | `botplatform-dev` | `bash scripts/dev-entry.sh admin` | **`${ADMIN_PORT:-3000}:${ADMIN_PORT:-3000}`** → `http://localhost:3000` | db (healthy) | `curl http://localhost:${ADMIN_PORT:-3000}/healthz`, 15s/5s, start_period 90s, 10 retries |
| **e2e** | `botplatform-dev` | `bash -lc 'pnpm test:e2e'` | none | **admin (healthy)** | none |

[verified in code: `docker-compose.yml` lines 84-182]

- **e2e is opt-in** via the `e2e` profile (`profiles: ['e2e']`) — it does **not**
  start with a plain `docker compose up`. It waits for `admin` to be **healthy**
  before running, so the admin panel is guaranteed up. Playwright browsers ship
  in the dev image (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). [verified in code]
- **db port 5432 is deliberately NOT published** — the host has no psql; use
  `docker compose exec db psql`. To attach a GUI client from the host, uncomment
  the `ports:` block in the `db` service (lines 105-106). [verified in code]
- **bot has no published port** — its internal API (default `8081`) is
  Docker-network-only; only `admin` calls it (`BOT_INTERNAL_URL=http://bot:8081`).
  [verified in code]

**Named volumes (dev):** [verified in code: `docker-compose.yml` lines 184-188]

| Volume | Mount | Why |
|--------|-------|-----|
| `pgdata` | `db:/var/lib/postgresql` | Postgres data. **Note:** `postgres:18+` moved the mount to `/var/lib/postgresql` (not the pre-18 `/var/lib/postgresql/data`). |
| `node_modules` | all dev services: `/workspace/node_modules` | Linux-native deps, shared, off the Windows bind mount (native speed, no symlink/permission issues). |
| `pnpm-store` | `/root/.local/share/pnpm` | Persistent content-addressable store → fast re-installs. |
| `uploads` | `/workspace/uploads` | Dynamic-cards uploaded/generated assets. |

### 2.2 Prod stack (`docker-compose.prod.yml`, project name `botplatform-prod`)

> **Standalone file.** Always invoke with `-f docker-compose.prod.yml`. Do **not**
> merge it with the dev compose. [verified in code: prod compose header]

| Service | Build target | Image | Command | Published port | Depends on |
|---------|-------------|-------|---------|----------------|-----------|
| **db** | — | `postgres:18-alpine` | (default) | none | — |
| **migrate** | `bot` | `botplatform-bot` | `node dist/migrate.js` | none | db (healthy) — one-shot, `restart: 'no'` |
| **seed** *(profile `seed`)* | `bot` | `botplatform-bot` | `node dist/seed.js` | none | db (healthy) — one-shot |
| **bot** | `bot` | `botplatform-bot` | (image CMD `node dist/main.js`) | none | db (healthy) **+ migrate completed successfully** |
| **admin** | `admin` | `botplatform-admin` | (image CMD `node dist/main.js`) | `${ADMIN_PORT:-3000}:…` | db (healthy) **+ migrate completed successfully** |

[verified in code: `docker-compose.prod.yml` lines 51-148]

- **Startup order is enforced:** `db` healthy → `migrate` (applies Drizzle
  migrations, then exits) → `bot` + `admin` (gated on
  `migrate: condition: service_completed_successfully`). [verified in code]
- **Prod healthchecks live in the image** (`HEALTHCHECK` instructions in
  `Dockerfile`, not in compose): bot `curl http://localhost:${HEALTH_PORT:-8081}/healthz`,
  admin `curl http://localhost:${ADMIN_PORT:-3000}/healthz`, both
  30s/5s, start_period 30s, 5 retries. [verified in code: `Dockerfile` lines 141, 161]
- **Secrets fail loudly:** `DATABASE_URL`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`,
  `POSTGRES_PASSWORD` use `${VAR:?message}` — compose refuses to start without
  real values. There are **no dev fallbacks** in the prod file. `COOKIE_SECURE`
  defaults **`true`** (vs `false` in dev). [verified in code]

**Named volumes (prod):** `pgdata-prod` (`db:/var/lib/postgresql`),
`uploads-prod` (`bot` + `admin`: `/app/uploads`). [verified in code]

### 2.3 Healthcheck payloads observed

[verified by execution on 2026-06-27]

```json
// bot /healthz
{"status":"ok","checks":{"discord":{"status":"ok","detail":"connected"},"database":{"status":"ok"}}}

// admin /healthz
{"status":"ok","checks":{"database":{"status":"ok"}}}
```

The bot was **connected to Discord** (the configured `DISCORD_TOKEN` is valid).
The bot health surfaces both Discord and DB; admin surfaces DB only. [verified by
execution on 2026-06-27]

---

## 3. Day-to-day loop

The normal inner loop once the stack is up and deps are installed:

```bash
# Edit source on the host → tsx watchers reload automatically. To watch it happen:
docker compose logs -f bot admin

# Run the gates inside the toolbox:
docker compose exec app pnpm lint
docker compose exec app pnpm typecheck
docker compose exec app pnpm test            # unit + integration
```

- Source edits: **no action** — `tsx watch` reloads. [verified in code]
- Changed a `package.json` / lockfile: `docker compose exec app pnpm install`.
- Changed the DB schema: generate + apply migrations (see §6).
- Changed `Dockerfile.dev`: `docker compose build` then `docker compose up -d`.

---

## 4. Exact commands — raw `docker compose` AND `make`

> `make` is **optional** and just wraps the same commands; recipes are not
> `@`-silenced, so make prints each command before running it. Windows users
> without `make` copy the raw commands. [verified in code: `Makefile` header]

### 4.1 Lifecycle

| Action | Raw `docker compose` | `make` |
|--------|----------------------|--------|
| Build dev image | `docker compose build` | `make build` |
| Start db+app+bot+admin (detached) | `docker compose up -d` | `make up` |
| (Re)start only bot+admin watchers | `docker compose up -d bot admin` | `make dev` |
| Stop everything (volumes kept) | `docker compose down` | `make down` |
| Stop **and wipe volumes** | `docker compose down -v` | *(no make target)* |
| Follow all logs | `docker compose logs -f --tail=200` | `make logs` |
| Service status + health | `docker compose ps` | `make ps` |
| Restart one service | `docker compose restart bot` | *(no make target)* |

[verified in code: `Makefile` lines 23-44; `down -v` documented in
`scripts/clean-validate.sh`]

### 4.2 Inside the toolbox (`app`)

| Action | Raw | `make` |
|--------|-----|--------|
| Install deps into the volume | `docker compose exec app pnpm install` | `make install` |
| Lint | `docker compose exec app pnpm lint` | `make lint` |
| Lint + autofix | `docker compose exec app pnpm lint:fix` | *(none)* |
| Format | `docker compose exec app pnpm format` | *(none)* |
| Format check | `docker compose exec app pnpm format:check` | *(none)* |
| Typecheck (all 31 projects) | `docker compose exec app pnpm typecheck` | `make typecheck` |
| Unit + integration | `docker compose exec app pnpm test` | `make test` |
| Unit only | `docker compose exec app pnpm test:unit` | `make test-unit` |
| Integration only | `docker compose exec app pnpm test:integration` | `make test-integration` |
| Build (tsup bundles) | `docker compose exec app pnpm build` | *(none)* |
| Open a shell in the toolbox | `docker compose exec app bash` | *(none)* |

[verified in code: `Makefile` lines 40-59; root `package.json` scripts]

### 4.3 Database & Discord

| Action | Raw | `make` |
|--------|-----|--------|
| Generate a migration from schema | `docker compose exec app pnpm db:generate` | *(none)* |
| Apply migrations | `docker compose exec app pnpm db:migrate` | `make migrate` |
| Seed bootstrap admin (idempotent) | `docker compose exec app pnpm db:seed` | `make seed` |
| Migrate + seed in one go | `docker compose exec app pnpm db:setup` | *(none)* |
| Register Discord slash commands | `docker compose exec app pnpm discord:register-commands` | `make register-commands` |

[verified in code: `Makefile` lines 64-71; root `package.json` lines 24-28]

> `db:setup` is `db:migrate && db:seed`. It was renamed from a previous name to
> avoid colliding with a pnpm built-in (see recent commit
> `d5ee8fc fix: rename setup script to db:setup`). [verified in code]
>
> `register-commands` needs `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and (for
> guild-scoped registration) `DISCORD_GUILD_ID` in `.env`. [verified in code:
> `apps/bot/package.json` `"register-commands": "tsx src/register-commands.ts"`,
> Makefile comment]

### 4.4 E2E (Playwright)

| Action | Raw | `make` |
|--------|-----|--------|
| Run e2e (starts/awaits admin healthy) | `docker compose --profile e2e run --rm e2e` | `make e2e` |

[verified in code: `Makefile` line 62; `docker-compose.yml` lines 168-182.
verified by execution on 2026-06-27: **24 passed / 1 skipped**, Playwright chromium]

You can also run e2e from the toolbox once `admin` is already healthy:
`docker compose exec app pnpm test:e2e`. [verified in code: used by
`scripts/clean-validate.sh` and CI]

### 4.5 psql, backup, restore

| Action | Raw | `make` |
|--------|-----|--------|
| Interactive psql | `docker compose exec db psql -U botplatform -d botplatform` | `make psql` |
| Backup → host `.sql` | `docker compose exec -T db pg_dump -U botplatform botplatform > backup_$(date +%Y%m%d_%H%M%S).sql` | `make backup` |
| Restore from a dump | `docker compose exec -T db psql -U botplatform -d botplatform < backup_XXXX.sql` | `make restore FILE=backup_XXXX.sql` |

[verified in code: `Makefile` lines 75-83]

> `make psql/backup/restore` honour `POSTGRES_USER` / `POSTGRES_DB` overrides,
> e.g. `make psql POSTGRES_USER=other`. The `-T` flag (no TTY) is required when
> piping in/out of `docker compose exec`. [verified in code]
>
> **Windows note:** the `make backup` recipe uses a Unix `>` redirect and
> `date`; under Git Bash / WSL it works as-is. From PowerShell, run the raw
> `pg_dump` form inside `bash` or redirect manually. [deduced]

### 4.6 Production (standalone compose)

| Action | Raw | `make` |
|--------|-----|--------|
| Build all prod images | `docker compose -f docker-compose.prod.yml build` | `make prod-build` |
| Start prod stack (detached) | `docker compose -f docker-compose.prod.yml up -d` | `make prod-up` |
| Stop prod stack | `docker compose -f docker-compose.prod.yml down` | `make prod-down` |
| Build with rebuild on up | `docker compose -f docker-compose.prod.yml up -d --build` | *(none)* |
| Seed first admin (one-shot) | `docker compose -f docker-compose.prod.yml --profile seed run --rm seed` | *(none)* |

[verified in code: `Makefile` lines 87-94; prod compose header. verified by
execution on 2026-06-27: `docker compose -f docker-compose.prod.yml build` built
all 3 prod images (admin, bot, migrate) in ~60s]

> Migrations run **automatically** as the one-shot `migrate` service before
> `bot`/`admin` start — you do **not** run a separate migrate command in prod.
> Seeding is opt-in (the `seed` profile); set `ADMIN_EMAIL` / `ADMIN_PASSWORD`
> in the environment for the run. [verified in code]

---

## 5. From-zero runbook (fresh machine, dev)

Prereq: Docker Desktop running. Nothing else. All commands from the repo root.

```bash
# 1. (Optional) create .env. Every dev var has a safe default in compose, so
#    this is only needed to set DISCORD_* or override defaults.
cp .env.example .env

# 2. Build the dev image and start db + app + bot + admin (detached).
docker compose up -d --build

# 3. Populate the shared node_modules volume (one-time / after dep changes).
#    bot+admin are idling until this completes; they auto-start ~5s after.
docker compose exec app pnpm install

# 4. Apply database migrations.
docker compose exec app pnpm db:migrate

# 5. Seed the bootstrap admin user (idempotent).
docker compose exec app pnpm db:seed
#    (steps 4+5 together: docker compose exec app pnpm db:setup)

# 6. (If using Discord) register slash commands — needs DISCORD_* in .env.
docker compose exec app pnpm discord:register-commands

# 7. Verify health.
docker compose ps
curl http://localhost:3000/healthz                          # admin (from host)
docker compose exec app curl -fsS http://bot:8081/healthz   # bot (internal)
```

Admin panel: **http://localhost:3000**. Default admin credentials come from
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (dev defaults `admin@example.com` /
`change_me_admin_password`). [verified in code: `docker-compose.yml` lines 45-46]

The `make` equivalent of the core sequence:
```bash
make up install migrate seed       # first boot, end to end
```
[verified in code: `Makefile` header example]

> **Without Discord:** leave `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` /
> `DISCORD_GUILD_ID` empty — the stack runs without a Discord connection and the
> admin panel still works. [verified in code: `docker-compose.yml` lines 33-36]

---

## 6. Schema-change loop

```bash
# 1. Edit the Drizzle schema (packages/database/src/...).
# 2. Generate a new migration SQL file.
docker compose exec app pnpm db:generate
# 3. Apply it.
docker compose exec app pnpm db:migrate
```

The repo ships **10 Drizzle migrations** `0000_romantic_moonstone` ..
`0009_legal_cammi` in `packages/database/migrations`. In prod the SQL files are
**baked into the bot image** (`COPY … packages/database/migrations →
/app/migrations`, `MIGRATIONS_DIR=/app/migrations`) and applied by the one-shot
`migrate` service. [verified in code: `Dockerfile` lines 130-131; prod compose
`migrate` service. verified by execution on 2026-06-27: all 10 migrations applied
0000..0009]

---

## 7. Clean-room validation (mirrors CI)

`scripts/clean-validate.sh` runs from the **host** and reproduces CI end-to-end:
`down -v` → build+up db+app → install (frozen) → lint → typecheck → unit →
migrate → integration → seed → build → up bot+admin (wait for admin healthy) →
e2e. [verified in code: `scripts/clean-validate.sh` 12 steps]

```bash
bash scripts/clean-validate.sh
```

> **Do not run this while the stack is up if you need to keep your data** — step
> 1 is `docker compose down -v`, which **wipes all named volumes** (DB, deps,
> uploads). The 2026-06-27 validation noted below ran against the **warm running
> stack**, not a `down -v` clean room. [verified in code]

### CI parity

`.github/workflows/ci.yml` runs the **same Docker-Compose sequence** on
`ubuntu-latest` (no Node toolchain on the runner). Three jobs: [verified in code]

1. **validate** — `cp .env.example .env` → build app → up db+app → install
   (frozen) → lint → typecheck → unit → migrate → integration → seed → build →
   up bot+admin → wait for admin healthy → e2e → (always) dump logs +
   `down -v`. Uploads the Playwright report on failure.
2. **docker-prod** — `docker build --target bot` and `--target admin` (proves
   the prod images build).
3. **secret-scan** — Gitleaks over full history (`fetch-depth: 0`).

---

## 8. Helper scripts (`scripts/`)

| Script | Run where | What it does |
|--------|-----------|--------------|
| `dev-entry.sh <bot\|admin>` | inside container (compose command) | waits for `node_modules/.modules.yaml`, then `pnpm --filter @botplatform/<app> dev`. **Must stay LF** (`.gitattributes`); CRLF breaks bash. [verified in code] |
| `clean-validate.sh` | host | full clean-room validation (see §7). [verified in code] |
| `check-admin-pages.sh` | inside container | curls each admin route; flags 500/404. **NOTE:** its hard-coded `pages` list covers only the older routes (dashboard, modules, audio, announcements, cards, welcome, role-menus, birthdays, reminders, scheduled-messages, moderation, automod, custom-commands, guilds, audit-logs, permissions, settings) — it does **not** list the 9 newest modules. [verified in code: `scripts/check-admin-pages.sh` line 4] |
| `check-audio-stack.ts` | inside container (tsx) | audio-stack smoke check (ffmpeg / yt-dlp / opus presence). [verified in code: file exists] |

---

## 9. Prod build internals (`Dockerfile`)

Multi-stage, targets `builder` / `proddeps` / `runtime-base` / `bot` / `admin`.
[verified in code: `Dockerfile`]

- **builder** (`node:24-bookworm`): installs `python3 make g++` (needed —
  `@discordjs/opus` compiles from source on glibc), pins `pnpm@10.34.3`,
  `pnpm install --frozen-lockfile`, `pnpm build` (tsup bundles each app with
  `@botplatform/*` workspace code **inlined**).
- **proddeps** (`node:24-bookworm`): copies **manifests only** then
  `pnpm install --prod --frozen-lockfile` → one flat hoisted
  `/app/node_modules` (`.npmrc` `node-linker=hoisted`). Layer cached until a
  manifest/lockfile changes.
- **runtime-base** (`node:24-bookworm-slim`): `ffmpeg curl ca-certificates
  python3 fonts-dejavu-core fontconfig` + pinned `yt-dlp` (`YTDLP_VERSION`
  build arg, default `2026.06.09`). `NODE_ENV=production`.
- **bot**: proddeps node_modules + `apps/bot/dist` + baked migrations
  (`MIGRATIONS_DIR=/app/migrations`), writable `/app/uploads`
  (`UPLOADS_DIR=/app/uploads`), runs as `node`, `EXPOSE 8081`,
  `CMD node dist/main.js`. **Also carries `dist/migrate.js` + `dist/seed.js`** —
  reused by the prod `migrate` and `seed` one-shot services.
- **admin**: proddeps node_modules + `apps/admin/dist` + `views` + `public`
  (EJS templates + static assets served from disk, not bundled), runs as `node`,
  `EXPOSE 3000`, `CMD node dist/main.js`.

The dev image (`Dockerfile.dev`) is the **Playwright base**
(`mcr.microsoft.com/playwright:v1.60.0-noble`) — the tag **must match** the
`@playwright/test` catalog pin (`1.60.0`) or Playwright refuses to run. It runs
as **root** (Windows bind-mount permission reasons), unlike the prod images.
[verified in code: `Dockerfile.dev` lines 16, 60-61; `pnpm-workspace.yaml` line 70]

> **`.dockerignore`** excludes `node_modules`, `dist`, `.git`, `.env*` (except
> `.env.example`), coverage/report dirs, `docs`, `README.md`. So `COPY . .` in
> the builder copies source + manifests only. [verified in code]

### 9.1 KNOWN GAP — stale `proddeps` manifest COPY list [verified in code]

The `proddeps` stage (`Dockerfile` lines 70-90) copies workspace `package.json`
manifests **one per line** (no glob). It lists **18** of them: the 6 infra
packages + `discord-adapter` + **only 11 module manifests** (audio, moderation,
announcements, cards, welcome, role-menus, scheduled-messages, custom-commands,
reminders, birthdays, automod).

It is **MISSING the 9 newest module manifests**: `raise-hand-module`,
`fun-commands-module`, `engagement-prompts-module`, `giveaways-module`,
`server-stats-module`, `trivia-module`, `minigames-module`, `economy-module`,
`levels-module` — all of which `apps/bot/package.json` depends on
(`workspace:*`, verified in code).

- **Why this matters:** `pnpm install --prod --frozen-lockfile` in `proddeps`
  resolves the workspace graph declared in `pnpm-workspace.yaml`; missing
  manifests referenced as `workspace:*` deps of `@botplatform/bot` are a likely
  install/resolution failure or, at best, an incorrect graph. This is **not** a
  problem for the **dev** path (the whole repo is bind-mounted, every manifest
  present) — only the **prod multi-stage build**.
- **Apparent contradiction:** the 2026-06-27 validation reports
  `docker compose -f docker-compose.prod.yml build` **PASSED** (3 images, ~60s).
  That build likely hit the Docker **layer cache** for the `proddeps` stage
  (manifests unchanged since the cached layer), masking the gap; a no-cache
  build (`--no-cache`, or CI's clean `docker build --target bot`) is the real
  test. **This needs an explicit clean-room re-check** before trusting prod
  builds:
  ```bash
  docker build --no-cache --target bot -t botplatform-bot .
  ```
  [verified in code (the COPY list); the contradiction is flagged, not resolved
  this pass]
- **Fix direction (not applied — docs only):** add the 9 missing
  `COPY packages/<name>/package.json …` lines, or switch the stage to copy all
  manifests in one go. Either keeps the cache-friendly "manifests only"
  property.

---

## 10. Environment variables that affect runtime

Passed through from `.env` with dev defaults (`docker-compose.yml`
x-dev-environment). The runtime-relevant ones: [verified in code]

| Var | Dev default | Prod | Notes |
|-----|-------------|------|-------|
| `NODE_ENV` | `development` | `production` | |
| `DATABASE_URL` | `postgres://botplatform:…@db:5432/botplatform` | **required** (`:?`) | |
| `ADMIN_PORT` | `3000` | `3000` | published host port for admin |
| `HEALTH_PORT` | `8081` | `8081` | bot internal API / healthz |
| `BOT_INTERNAL_URL` | `http://bot:8081` | `http://bot:8081` | admin → bot, Docker network only |
| `SESSION_SECRET` | weak dev default | **required** (`:?`) | ≥32 chars |
| `INTERNAL_API_TOKEN` | weak dev default | **required** (`:?`) | admin↔bot shared secret |
| `POSTGRES_PASSWORD` | `change_me_dev_password` | **required** (`:?`) | |
| `COOKIE_SECURE` | `false` | `true` | HTTPS-only cookies in prod |
| `DISCORD_TOKEN` / `_CLIENT_ID` / `_GUILD_ID` | empty | empty (optional) | empty ⇒ no Discord connection |
| `DISCORD_ENABLE_GUILD_MEMBERS` | `false` | `false` | privileged intent, opt-in, also enable in portal |
| `DISCORD_ENABLE_MESSAGE_CONTENT` | `false` | `false` | privileged intent, opt-in |
| `YTDLP_PATH` | `yt-dlp` | `yt-dlp` | binary baked into both images |
| `YTDLP_COOKIES_FILE` | empty | empty | mount cookies for private YouTube |
| `UPLOADS_DIR` | `/workspace/uploads` | `/app/uploads` | cards assets volume |
| `TEST_DATABASE_URL` | `…/botplatform_test` | n/a | integration tests use a separate DB on the same server |

> `GuildVoiceStates` is **already enabled** and is **not** privileged — the
> newest `voice.state.update` platform event uses it. `GuildMembers` and
> `MessageContent` are the only privileged intents and both default OFF.
> [verified in code: compose comments]

> Use placeholders `<DISCORD_BOT_TOKEN>` / `<DISCORD_CLIENT_ID>` /
> `<DISCORD_GUILD_ID>` when sharing config — never copy real `.env` values.

---

## 11. Quick troubleshooting (runtime)

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `bot`/`admin` log "waiting for dependencies" forever | `pnpm install` never run | `docker compose exec app pnpm install` |
| `pnpm install` fails "frozen lockfile" | lockfile out of sync | regenerate locally, commit, or drop `--frozen-lockfile` for the dev install |
| admin 500 on every page | DB not migrated | `docker compose exec app pnpm db:migrate` |
| Can't log in to admin over plain HTTP | `COOKIE_SECURE=true` without HTTPS | set `COOKIE_SECURE=false` for HTTP trials |
| `dev-entry.sh` "bad interpreter" / `\r` errors | CRLF line endings | re-checkout with LF (`.gitattributes` enforces it) |
| Postgres data vanished after a pull | someone ran `down -v` / `clean-validate.sh` | restore from a backup (`make restore FILE=…`) |
| Prod image build behaves oddly after adding a module | stale `proddeps` COPY list (§9.1) | add the manifest COPY line, rebuild `--no-cache` |
| psql "command not found" on host | host has no psql (by design) | `docker compose exec db psql -U botplatform -d botplatform` |

For deeper diagnosis see `docs/technical/troubleshooting.md`.

---

## 12. Executed-vs-from-files summary

**[verified by execution on 2026-06-27]** (warm running stack, ~12:19; counts
point-in-time):

- `pnpm install` — PASS (lockfile up to date; 31 workspace projects), ~9s
- `pnpm db:migrate` — PASS, all 10 migrations (0000..0009)
- `pnpm lint` — PASS, clean
- `pnpm typecheck` — PASS, all 31 projects
- `pnpm test:unit` — PASS, 471 tests / 46 files
- `pnpm test:integration` — PASS, 37 tests / 7 files
- `pnpm build` — PASS (tsup ESM, all)
- bot `/healthz` — ok, Discord connected, DB ok
- admin `/healthz` — ok, DB ok
- `docker compose --profile e2e run --rm e2e` — PASS, 24 passed / 1 skipped
- `docker compose -f docker-compose.prod.yml build` — PASS, 3 images, ~60s
  *(but see §9.1 — likely cached `proddeps`; a `--no-cache` build is the real test)*

**[verified in code]** — everything in §1, §2, §4, §5, §6, §8, §9, §10 sourced
directly from `Dockerfile`, `Dockerfile.dev`, `docker-compose.yml`,
`docker-compose.prod.yml`, `.dockerignore`, `Makefile`, `scripts/dev-entry.sh`,
`scripts/clean-validate.sh`, `scripts/check-admin-pages.sh`,
`.github/workflows/ci.yml`, `package.json`, `pnpm-workspace.yaml`,
`apps/bot/package.json`, `packages/database/package.json`.

**Not run this pass** (stack was up; do not down it): docker image builds with
`--no-cache`, `down -v` clean room. The §9.1 prod-manifest gap is flagged from
the file contents and **needs a clean `--no-cache` prod build to confirm
impact**.
