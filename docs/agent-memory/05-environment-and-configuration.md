# 05 — Environment & Configuration

> Agent: **AGENT 5 — ENVIRONMENT & CONFIGURATION**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (all paths below are relative to it)

## Agent purpose

Enumerate **every** environment variable the platform actually consumes, where
each is read, its default and validation rule, and whether it is Docker-specific.
Cross-check `.env.example` against real usage (flag drift in both directions),
document the secrets that must never be committed, document the Discord Developer
Portal setup (token / client id / guild id, the two privileged-intent flags,
bot permissions, invite URL), and provide minimal working `.env` recipes for
(a) Docker dev without Discord and (b) with the Discord audio bot. Output is two
Markdown files; this is the agent-memory record.

## Files analyzed (verified by reading)

- `.env.example` (read in full).
- `packages/config/src/index.ts` — the zod env schema + `loadConfig()` +
  `testEnv()` (the single source of truth for app config).
- All 11 files containing `process.env` (found via Grep, all read or
  context-read): `packages/config/src/index.ts`,
  `packages/database/src/migrate.ts`, `packages/database/src/migrate-cli.ts`,
  `packages/database/src/seed-cli.ts`, `packages/database/src/test-url.ts`,
  `packages/database/drizzle.config.ts`, `apps/bot/src/seed.ts`,
  `apps/bot/src/migrate.ts`, `tests/e2e/playwright.config.ts`,
  `tests/e2e/playwright/global-setup.ts`, `tests/e2e/playwright/helpers.ts`.
- Consumers of `loadConfig()`: `apps/bot/src/main.ts`, `apps/admin/src/main.ts`,
  `apps/admin/src/server.ts`, `apps/bot/src/register-commands.ts`.
- Config-driven feature wiring (to attribute "what consumes it"):
  `packages/discord-adapter/src/adapter.ts` (intents),
  `packages/audio-module/src/index.ts` +
  `packages/audio-module/src/resolver/ytdlp-runner.ts` (cookies),
  `apps/admin/src/bot-client.ts` (internal URL + token),
  `apps/bot/src/internal-api.ts` (internal token check),
  `packages/automod-module/src/index.ts` (MessageContent gating),
  `packages/welcome-module/src/index.ts` (GuildMembers requirement),
  `apps/admin/src/routes/cards.ts` (uploadsDir).
- `packages/database/src/seed.ts` (admin-bootstrap + E2E admin logic).
- Compose / image env wiring: `docker-compose.yml` (anchors + db),
  `docker-compose.prod.yml` (full file), `Dockerfile` (bot/admin stages),
  `Makefile` (POSTGRES_USER/POSTGRES_DB usage).
- `docs/DISCORD_SETUP.md` (to reuse the existing, code-consistent permissions
  integer instead of fabricating one).
- `docs/agent-memory/01-project-inventory.md` (handoff context).

## Commands run

- Grep/Glob/Read only (read-only analysis). One non-mutating `ls -la .env
  .env.example` to confirm `.env` exists on disk — **its contents were NOT
  read** (secrets rule). No pnpm/node/npm/build/test/docker commands executed.

## What was discovered (high level)

1. **`packages/config/src/index.ts` is the single source of truth** for the
   running apps. A zod schema (`envSchema`) defines every variable the
   `bot` and `admin` processes read, with defaults and validation. `loadConfig()`
   parses `process.env`, and on failure throws `PlatformError('CONFIG_INVALID',
   …)` listing **variable names only** (never secret values).
2. **Only three env vars are hard-required** by the schema (no default, will fail
   validation if absent/invalid): `DATABASE_URL` (min length 1),
   `SESSION_SECRET` (min 32 chars), `INTERNAL_API_TOKEN` (min 8 chars). Every
   other app var has a default.
3. **A second set of env vars is read directly via `process.env`**, outside the
   zod schema, by CLI/test/tooling code: `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` (seed CLIs),
   `DATABASE_URL`/`MIGRATIONS_DIR` (migrate CLIs), `DATABASE_URL` +
   `TEST_DATABASE_URL` (`test-url.ts`), `DATABASE_URL` (drizzle.config.ts),
   `PLAYWRIGHT_BASE_URL` + `CI` (Playwright), and the secret-leak guard reads
   `SESSION_SECRET`/`INTERNAL_API_TOKEN`/`ADMIN_PASSWORD`/`E2E_ADMIN_PASSWORD`/
   `POSTGRES_PASSWORD`/`DISCORD_TOKEN` (e2e `helpers.ts`).
   Note `ADMIN_EMAIL`/`ADMIN_PASSWORD` ALSO appear in the zod schema
   (`admin.bootstrapEmail`/`bootstrapPassword`), but the actual seeder
   (`apps/bot/src/seed.ts`, `packages/database/src/seed-cli.ts`) reads them
   straight from `process.env`, not from `loadConfig()`.
4. **`.env.example` ↔ code cross-check (drift):**
   - **Used in code but ABSENT from `.env.example`** (all have safe defaults, so
     non-fatal, but undocumented):
     - `UPLOADS_DIR` — zod default `/workspace/uploads`; consumes:
       `config.storage.uploadsDir` (cards module storage). Set by both Docker
       images (`Dockerfile` → `/app/uploads`) and both compose files.
     - `BUILD_VERSION` — zod default `0.1.0`; surfaced as `config.version` on the
       admin dashboard/settings page and asserted by an e2e test.
     - `MIGRATIONS_DIR` — read by `packages/database/src/migrate.ts` (default:
       sibling `../migrations`); set to `/app/migrations` in the prod images.
     - `TEST_DATABASE_URL` — read by `packages/database/src/test-url.ts`
       (integration tests); has a dev default in `docker-compose.yml`. If unset,
       it is derived from `DATABASE_URL` by suffixing the DB name with `_test`.
     - `CI` — read by `tests/e2e/playwright.config.ts` (retries). Set by the CI
       runner, not the user.
   - **In `.env.example` but never read by Node app code**: `POSTGRES_USER`,
     `POSTGRES_DB` (and `POSTGRES_PASSWORD`). These are **Docker/Postgres-image
     + Makefile** variables — they configure the `db` service and `make
     psql/backup/restore`. The Node side only ever reads the assembled
     `DATABASE_URL`. So they are *not* dead, just not consumed by the
     application processes.
5. **Docker-specific defaults** (hostnames only resolvable on the compose
   network): `DATABASE_URL` host `db`, `BOT_INTERNAL_URL` host `bot`
   (`http://bot:8081`), `TEST_DATABASE_URL` host `db`, `PLAYWRIGHT_BASE_URL`
   host `admin` (`http://admin:3000`). `UPLOADS_DIR` defaults differ by context:
   `/workspace/uploads` (config default + dev compose) vs `/app/uploads`
   (prod images + prod compose).
6. **Privileged-intent flags map 1:1 to gateway intents** in
   `packages/discord-adapter/src/adapter.ts`: base intents are always
   `Guilds, GuildVoiceStates, GuildMessages, GuildModeration`;
   `DISCORD_ENABLE_GUILD_MEMBERS=true` adds `GuildMembers`,
   `DISCORD_ENABLE_MESSAGE_CONTENT=true` adds `MessageContent`. The adapter
   short-circuits entirely when `config.discord.enabled` is false (both token
   and client id present). Confirmed `config.discord.enabled = DISCORD_TOKEN
   non-empty AND DISCORD_CLIENT_ID non-empty`.
7. **`COOKIE_SECURE` default differs by environment**: zod default `false`; dev
   compose `false`; **prod compose default `true`** (logins fail over plain HTTP
   when true).
8. **Prod secrets fail loudly**: `docker-compose.prod.yml` uses
   `${VAR:?message}` for `DATABASE_URL`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`,
   and `POSTGRES_PASSWORD` — compose refuses to start without them. The dev
   compose supplies weak defaults for all of these.

## Results

- Two output files written:
  1. `docs/agent-memory/05-environment-and-configuration.md` (this file).
  2. `docs/technical/environment.md` (the polished reference + recipes).
- Full env-var inventory with name / required-or-optional / default / consumer /
  Docker-specificity is in the technical doc's master table.

## Problems found

1. **`.env.example` omits 4 user-relevant vars**: `UPLOADS_DIR`, `BUILD_VERSION`,
   `MIGRATIONS_DIR`, `TEST_DATABASE_URL`. None break the default flow (defaults
   exist), but a reader copying `.env.example` will not know they are tunable.
   `MIGRATIONS_DIR`/`CI` are infra-set and arguably fine to omit;
   `UPLOADS_DIR`/`TEST_DATABASE_URL`/`BUILD_VERSION` are reasonable to add.
2. **Bootstrap-admin double path**: `ADMIN_EMAIL`/`ADMIN_PASSWORD` exist both in
   the zod schema (as `admin.bootstrap*`) and are read directly by the seeders.
   The seed path is what actually creates the user; the config-side copies are
   currently surfaced only indirectly. Not a bug — just two readers of the same
   pair. Worth noting so a later agent does not assume `loadConfig` is the only
   reader.
3. **`POSTGRES_*` vars look app-level in `.env.example` but are Docker-only.** A
   reader could wrongly assume the app reads them. Documented explicitly in the
   technical doc.
4. **Cookie path is host-relative and platform-specific.** The cookies file must
   be a path *inside the container* (e.g. `/workspace/secrets/...` in dev,
   `/secrets/...` in prod via the commented bind mount), not a Windows host path.

## Recommendations

- Add `UPLOADS_DIR`, `TEST_DATABASE_URL`, and `BUILD_VERSION` (commented, with
  their defaults) to `.env.example` to close the documentation gap.
- Keep the prod `${VAR:?}` guards; they are the right safety net for secrets.
- When documenting invites, reuse the existing permissions integer `3147776`
  from `docs/DISCORD_SETUP.md` (View Channels + Send Messages + Connect + Speak);
  do not invent a new one. The codebase does not compute a permissions integer —
  it is a portal/OAuth2 concern only.

## What remains to verify (handoff)

- The **exact bit composition** of permissions integer `3147776` was taken from
  `docs/DISCORD_SETUP.md`'s claim (View Channels + Send Messages + Connect +
  Speak), not recomputed from Discord's bitfield. A later agent could verify the
  arithmetic, but it is not derivable from this repo's code (no permissions math
  exists in-repo).
- `register-commands.ts` was read only through line ~40 (enough to confirm it
  reads `config.discord.*` and exits when Discord is disabled); the full command
  collection list was already inventoried by Agent 1.
- Whether any module reads env vars NOT via `loadConfig` — Grep for
  `process.env` returned only the 11 files above, so this is believed complete,
  but a future schema addition could change that.

---

## Checkpoint

Status: PASS

### Validat
- Read `.env.example` in full (30 documented keys).
- Read `packages/config/src/index.ts` in full: zod schema, defaults, validation
  minimums, `AppConfig` shape, `loadConfig`, `testEnv`.
- Found EVERY `process.env` reference (Grep count: 22 occurrences across 11
  files) and read each consuming file.
- Cross-checked `.env.example` vs code both directions: identified 5 vars read in
  code but absent from `.env.example` (`UPLOADS_DIR`, `BUILD_VERSION`,
  `MIGRATIONS_DIR`, `TEST_DATABASE_URL`, `CI`) and 3 vars in `.env.example` that
  the Node app never reads (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` —
  Docker/Makefile only).
- Verified the two privileged-intent flags map to `GuildMembers` /
  `MessageContent` in `packages/discord-adapter/src/adapter.ts`.
- Verified Docker-specific hosts (`db`, `bot`, `admin`) in both compose files +
  Dockerfile env (`MIGRATIONS_DIR`, `UPLOADS_DIR`).
- Verified the three hard-required vars (`DATABASE_URL`, `SESSION_SECRET` ≥32,
  `INTERNAL_API_TOKEN` ≥8) and the prod `${VAR:?}` guards.
- Confirmed `.env` exists on disk WITHOUT reading its contents.

### Nevalidat
- The bitfield arithmetic behind permissions integer `3147776` (reused from
  existing doc; not recomputed — no permissions math exists in-repo).
- Real `.env` values (intentionally never read — secrets rule).
- Full body of `register-commands.ts` beyond the config-gating preamble.

### Probleme
- `.env.example` omits `UPLOADS_DIR`, `BUILD_VERSION`, `MIGRATIONS_DIR`,
  `TEST_DATABASE_URL` (all have safe defaults; documentation gap, not a runtime
  break).
- `ADMIN_EMAIL`/`ADMIN_PASSWORD` are read by two code paths (zod schema + direct
  seeder); only the seeder path creates the user.
- `POSTGRES_*` keys in `.env.example` are Docker/Makefile-only, not app-read —
  potentially confusing to a reader.

### Următorul agent poate continua?
Da. The complete env-var inventory (name, required/optional, default, consumer,
Docker-specificity), the secrets list, the Discord portal/intent mapping, and
two ready-to-use `.env` recipes are captured here and in
`docs/technical/environment.md`. The only items a later agent might re-verify are
the Discord permissions-integer bit math (a portal concern, not in code) and any
future additions to the zod schema.
