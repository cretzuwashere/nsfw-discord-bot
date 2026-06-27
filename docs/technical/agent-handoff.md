# Agent Handoff — start here

> **You are a future agent (or human) picking up `botplatform`.** This is the
> single entry point. Read this file first, then follow the reading order below.
> Everything here was verified against source and cross-checked by a multi-agent
> documentation pass; the project was run end-to-end in Docker and **all
> validation gates passed on 2026-06-27** (bot connected to Discord, prod images
> build). The authoritative, code-verified status (20 modules, 10 migrations,
> 5 platform events) lives in the repo-root `AGENTS.md` §7 and in
> `docs/technical/modules.md`.
>
> **`AGENTS.md` (repo root) is THE standard** — the auto-discovered, authoritative
> rulebook for this repo. When anything here conflicts with an older doc, `AGENTS.md`
> and `docs/technical/` win. Read [`../../AGENTS.md`](../../AGENTS.md) first if you
> have not already.

`botplatform` is a **Docker-first, modular Discord bot platform**: a Discord
audio/music bot plus **20 community modules** (see `modules.md`), fronted by a
Fastify server-side-rendered (SSR) admin panel. It is a pnpm-workspace monorepo
(npm scope `@botplatform`). **The host has no Node, pnpm, ffmpeg, psql, or
Playwright** — all of it runs inside Linux Docker containers. Every `pnpm`
command runs inside the `app` toolbox container.

---

## 1. Where to start reading (recommended order)

Read top-to-bottom; each builds on the previous.

1. **This file** (`docs/technical/agent-handoff.md`) — orientation, boot, fragile
   areas, future tasks.
2. **[`docs/technical/README.md`](./README.md)** — the documentation index +
   minimal command set.
3. **[`runtime-and-docker.md`](./runtime-and-docker.md)** — the operator runbook:
   dev/prod/validation contexts, services, volumes, health endpoints, first-run
   from zero, day-to-day loop, full command reference. **Boot the project from
   here.**
4. **[`architecture.md`](./architecture.md)** — layered hexagonal design, core
   contracts, module lifecycle, bot↔admin internal-API seam, where to add a
   feature, high-coupling areas.
5. **[`environment.md`](./environment.md)** — every env var (required vs
   optional, default, consumer, Docker-specific), secrets, Discord portal setup,
   ready-to-use `.env` recipes.
6. **[`discord-bot-flows.md`](./discord-bot-flows.md)** — end-to-end Discord
   usage flows (audio, moderation, role menus, welcome, scheduling).
7. **[`commands-and-events.md`](./commands-and-events.md)** — every slash command
   + subcommand, every platform/Discord event, interaction handlers, intents,
   permissions, module↔command matrix.
8. **[`testing.md`](./testing.md)** — unit/integration/e2e layers, how to run
   each, and the manual Discord smoke-test checklist (the only un-automated part).
9. **[`troubleshooting.md`](./troubleshooting.md)** — symptom → cause →
   investigation → solution, with a "Corrections to the old TROUBLESHOOTING.md"
   section.

Deeper working notes (per-agent analysis, with checkpoints) live in
**`docs/agent-memory/`** — the documentation-pass set is
`01-project-inventory.md`, `02-runtime-and-docker-analysis.md`,
`03-architecture-analysis.md`, `04-discord-bot-analysis.md`,
`05-environment-and-configuration.md`, `06-testing-and-validation.md`,
`07-documentation-review.md`, `99-final-orchestrator-report.md`. Start with
`01-project-inventory.md` for the exact file map (don't re-scan the tree).

This **remake** (the "tech-docs" orchestration that refreshed these docs to the
20-module reality) keeps its namespaced notes under
**`docs/agent-memory/tech-docs/`** — see `01-inventory.md`, `98-review.md`, and the
final report `99-final-report.md`. Per `AGENTS.md` §4.3, never write flat
`0X-*.md` into `docs/agent-memory/` root (that namespace is collided by three
efforts); always namespace under `docs/agent-memory/<workstream>/`.

> **Do not treat the `*-raise-hand*`, `*-feature-design*`,
> `*-current-bot-interaction*`, `*-permissions-and-discord-capabilities*`,
> `*-implementation-plan*` files or `docs/agent-memory/music/` as part of this
> documentation set** — they belong to two *separate, concurrent* efforts (a
> "Raise Hand / Speaker Queue" feature and a "Music System Extension"). See §1 of
> `99-final-orchestrator-report.md`.

---

## 2. Minimal command to boot the project (DEV, from zero)

Run from the repo root (`C:/Projects/Mods/Fable - Mod`). The host needs **only
Docker**.

```bash
cp .env.example .env                          # optional in dev (every var has a safe default)
docker compose up -d --build                  # build images + start db, app, bot, admin
docker compose exec app pnpm install          # populate the shared node_modules volume (once)
docker compose exec app pnpm db:setup         # = db:migrate && db:seed (creates admin@example.com)
```

Then open the admin panel at <http://localhost:3000> and log in with
`ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env` (defaults
`admin@example.com` / the value in `.env.example`).

> `bot` and `admin` start in a **wait loop** until `pnpm install` finishes (it
> writes `node_modules/.modules.yaml`), then their tsx watchers boot
> automatically. Confirm with `docker compose ps` — admin should become
> `healthy`. The `make` equivalents are `make up` / `make install` / `make
> migrate` + `make seed`.

---

## 3. Day-to-day commands

All run inside the `app` toolbox container. `make` wrappers are optional (Windows
without `make`: use the raw form).

```bash
docker compose up -d                 # start db + app + bot + admin   (make up)
docker compose ps                    # status + health                (make ps)
docker compose logs -f bot           # follow one service             (make logs = all)
docker compose down                  # stop; volumes kept             (make down)

docker compose exec app pnpm lint            # eslint .               (make lint)
docker compose exec app pnpm typecheck       # tsc across workspace   (make typecheck)
docker compose exec app pnpm test            # unit + integration     (make test)
docker compose exec app pnpm test:unit       #                        (make test-unit)
docker compose exec app pnpm test:integration#                        (make test-integration)
docker compose exec app pnpm test:e2e        # Playwright (needs admin healthy) (make e2e)
docker compose exec app pnpm build           # tsup bundles
docker compose exec app pnpm format          # prettier --write .

docker compose exec app pnpm db:migrate      # apply migrations       (make migrate)
docker compose exec app pnpm db:seed         # seed admin user(s)     (make seed)
docker compose exec app pnpm db:generate     # drizzle-kit: emit a migration from schema.ts
docker compose exec app pnpm discord:register-commands   # register slash commands (make register-commands)
```

**Pre-merge / CI-equivalent gate** (clean-room, identical to CI's `validate`
job — wipes volumes, rebuilds, runs every check):

```bash
bash scripts/clean-validate.sh
```

After editing code, the tsx watchers reload automatically (source is bind-
mounted). After adding/removing a dependency, re-run `docker compose exec app
pnpm install`. After editing `schema.ts`, run `db:generate` to emit a migration,
then `db:migrate`.

---

## 4. The most important files & directories

| Path | Why it matters |
|---|---|
| `apps/bot/src/main.ts` | **Composition root.** The only place that wires all 20 modules + DiscordAdapter + DB + scheduler jobs + health indicators into `BotKernel`. Source of truth for "what ships". |
| `apps/bot/src/register-commands.ts` | **Manual mirror** of command-owning modules — must be updated when adding a module with slash commands, or they never register. |
| `apps/bot/src/internal-api.ts` | The bot's internal HTTP API (`/healthz` + token-gated `/internal/*`) on `HEALTH_PORT` 8081. |
| `apps/admin/src/server.ts` | Fastify SSR app: plugins, auth guards, core pages, error boundary. `main.ts` builds it via `buildAdminServer`. |
| `apps/admin/src/routes/` | One `AdminRoutePlugin` per community module; `index.ts` lists them; `placeholders.ts` is the catch-all (kept LAST). |
| `packages/core/src/` | Contracts (`contracts/*.ts`) + engine: `BotKernel`, `ModuleRegistry` (command/event dispatch + error boundary), `Scheduler`, `HealthAggregator`, `CachedModuleState`. Depends only on config/logger/shared. |
| `packages/shared/src/types.ts` | `MODULE_KEYS` / `ADAPTER_KEYS` — canonical module-key set. |
| `packages/shared/src/internal-api.ts` | The bot↔admin internal-API contract (paths, header, status shape). |
| `packages/discord-adapter/src/adapter.ts` | The **only** place discord.js lives. Gateway intents block (base 4 + opt-in `GuildMembers`/`MessageContent`); maps gateway events ↔ core `PlatformEvent`. |
| `packages/database/src/schema.ts` | **Single** Drizzle schema file — source of truth for every table. Migrations are generated from it. |
| `packages/database/src/seed.ts` | Idempotent seeder: built-in module rows + bootstrap admin (+ optional E2E admin). |
| `packages/config/src/index.ts` | The zod `envSchema` + `loadConfig()` — authoritative env contract for the running apps. |
| `packages/*-module/src/index.ts` | Each module's `create<Name>Module(opts)` factory; follow to `commands.ts` / `service.ts` / `repo.ts`. |
| `Dockerfile` | Prod multi-stage (`builder`, `proddeps`, `runtime-base`, `bot`, `admin`); non-root; yt-dlp + ffmpeg + fonts baked in. |
| `Dockerfile.dev` | Dev/toolbox image (from `mcr.microsoft.com/playwright:v1.60.0-noble`); runs as root for Windows bind-mount perms. |
| `docker-compose.yml` / `docker-compose.prod.yml` | Dev vs prod stacks (distinct project names). |
| `scripts/clean-validate.sh` | The canonical local validation gate (= CI `validate`). |
| `scripts/dev-entry.sh` | `bot`/`admin` dev entrypoint — waits for `node_modules/.modules.yaml`, then execs the watcher. **Must stay LF.** |

---

## 5. Fragile areas — "do not touch without care"

1. **`node_modules` is a shared named volume, not on the bind mount.** It starts
   empty; `bot`/`admin` idle until `pnpm install` writes `.modules.yaml`. Don't
   "fix" the wait loop — it's by design. After dependency changes, re-run
   `pnpm install`.
2. **pnpm `node-linker=hoisted` (`.npmrc`).** A single flat root `node_modules`.
   Changing the linker breaks the prod `Dockerfile` `proddeps` caching strategy
   and the shared-volume model.
3. **ESM + raw-TS source consumption.** Every package's `main`/`types` point at
   `./src/index.ts`; the build relies on **tsup inlining** and dev on **tsx**.
   Relative imports use **`.js` suffixes** (NodeNext/ESM convention) even though
   the source is `.ts`. Don't drop the suffixes; don't add a runtime import to a
   "types-only" package (it will get bundled).
4. **Three-place module agreement.** Adding a module requires all of:
   `MODULE_KEYS` (`packages/shared/src/types.ts`) **+** wiring in
   `apps/bot/src/main.ts` **+** a seed row in `packages/database/src/seed.ts`. If
   it has slash commands, also add it to `apps/bot/src/register-commands.ts`. Miss
   one and it won't appear/enable/register correctly.
5. **Privileged-intent flags must match the Discord developer portal.**
   `DISCORD_ENABLE_GUILD_MEMBERS` / `DISCORD_ENABLE_MESSAGE_CONTENT` add
   privileged gateway intents. Enabling a flag without the matching portal toggle
   ⇒ gateway **close code 4014** (connection rejected). With `MessageContent`
   OFF, automod content rules silently DEGRADE; the value is read once at module
   construction, so changing it needs a **bot restart**.
6. **Audio opus is compiled from source.** `@discordjs/opus` (and `argon2`) are
   native; they build in the prod `Dockerfile` `proddeps` stage and need
   `python3 make g++`. `pnpm-workspace.yaml` `onlyBuiltDependencies` must keep
   listing `@discordjs/opus`, `argon2`, `esbuild`, or their build scripts won't
   run. `scripts/check-audio-stack.ts` verifies opus + ffmpeg are loadable.
7. **Prod `Dockerfile` `proddeps` stage lists manifests for caching.** It copies
   **only** `package.json` files (per package/app) then `pnpm install --prod`.
   Every package/app manifest must be present there or that workspace's prod deps
   go missing at runtime. Adding a package means updating this stage.
8. **`scripts/*.sh` must be LF** (enforced by `.gitattributes`). CRLF (easy on
   Windows) breaks bash inside the container.
9. **Database migrations are generated, never hand-edited.** Edit
   `schema.ts` → `pnpm db:generate` (drizzle-kit) emits a new migration in
   `packages/database/migrations/`. Never edit an already-applied migration.
10. **Postgres 18 data path is `/var/lib/postgresql`** (not the pre-18 `…/data`).
    The compose volumes mount the new path.
11. **Prod secrets fail loud.** `docker-compose.prod.yml` uses `${VAR:?}` for
    `DATABASE_URL`, `SESSION_SECRET` (≥32 chars), `INTERNAL_API_TOKEN` (≥8),
    `POSTGRES_PASSWORD`. Don't add dev fallbacks there. `COOKIE_SECURE=true` in
    prod assumes HTTPS upstream (no reverse proxy is bundled — operator
    responsibility).
12. **Playwright image tag pin.** `Dockerfile.dev` base
    (`mcr.microsoft.com/playwright:v1.60.0-noble`) MUST stay in lockstep with the
    `@playwright/test` catalog pin (`1.60.0`), or Playwright refuses to run.
    Browsers are preinstalled in the dev image — never run `playwright install`.
13. **`apps/admin` imports module-internal repos/validation.** Relocating a
    module's repo/validation export can break the admin build even though it's a
    different app.
14. **Bot↔admin coupling is operational.** `BOT_INTERNAL_URL` /
    `INTERNAL_API_TOKEN` must match between the two containers, or the admin's
    audio controls fail (the contract itself is type-checked via `shared`).
15. **Don't touch `docs/agent-memory/music/`** — owned by the Music System
    Extension orchestration.

---

## 6. Recommended future tasks (backlog)

Aggregated from the agents' "remaining" / problems. None are blocking.

**Documentation cleanup**
- Legacy `docs/TROUBLESHOOTING.md` (root, uppercase) is now a thin **redirect
  stub** pointing at `docs/technical/troubleshooting.md` (rewritten 2026-06-27);
  it keeps only Windows/WSL2 host notes and already corrects the old "bot
  unhealthy on bad token" claim. Remaining option: fold the few WSL2 notes into
  `docs/technical/troubleshooting.md` and delete the stub entirely.
- Add `UPLOADS_DIR`, `TEST_DATABASE_URL`, `BUILD_VERSION` to `.env.example`
  (commented, with defaults) — they're read in code and user-tunable.

**Admin panel coverage**
- **Add dedicated admin routes for the 9 newest modules** that today have **no
  real admin page** (they fall through to `placeholders.ts` / have none):
  raise-hand, fun-commands, engagement-prompts, giveaways, server-stats, trivia,
  minigames, economy, levels. Each needs an `AdminRoutePlugin` in
  `apps/admin/src/routes/` + an entry in `routes/index.ts` (before
  `registerPlaceholderRoutes`, which stays LAST) + a view in `apps/admin/views/`.
  `[verified in code 2026-06-27]`

**Prod image correctness**
- **Add the 9 missing module manifests to the prod `Dockerfile` `proddeps`
  stage.** It currently copies only the 6 infra + `discord-adapter` + 11 module
  `package.json` files; the 9 newest modules are absent. The prod build passes
  today only because tsup inlines workspace *source*; any **external runtime
  dependency** a new module adds would be missing in the prod image. Add a
  `COPY packages/<module>/package.json …` line for each. `[verified in code]`

**Source control**
- **Commit the large uncommitted working tree on a branch.** The tree carries
  substantial uncommitted changes (expected during these orchestrations). Create
  a feature branch and commit in logical chunks rather than leaving it
  uncommitted on `master`. Do not commit `.env` or any secret.

**Discord-domain fixes**
- Add `metadata` to the audio module declaring `requiredIntents:
  ['Guilds','GuildVoiceStates']` + `requiredPermissions: ['Connect','Speak']` so
  the admin panel can surface voice requirements.
- Either implement true emoji-reaction role menus (needs `GuildMessageReactions`
  intent + `MessageReactionAdd` listener + reaction rendering) or rename the
  `'reaction'` role-menu type / clarify `docs/REACTION_ROLES.md` to "buttons and
  select menus only".
- Make `clearwarnings` actually deactivate warning rows, or rename it (today it
  only records an "other" moderation case).
- Consider adding `default_member_permissions` to management subcommands
  (`announcement *`, `roles *`) to hide them from non-staff.

**Validation / ops**
- Run the **manual Discord smoke-test checklist** in `testing.md` against a live
  guild (slash registration, `/play` audio, member-join welcome, permission
  failure, restart persistence) — the only un-automated coverage.
- Do a live **prod bring-up** (`docker-compose.prod.yml up`) to healthy — gate 16
  only *built* the prod images, it did not run them to healthy.
- Add `pnpm format:check` to the executed gate set (wired but not run in the
  2026-06-27 pass).
- Document / add a reverse-proxy + TLS layer for prod (none is bundled;
  `COOKIE_SECURE=true` assumes HTTPS upstream).

**Coverage gaps**
- Add co-located unit tests for `packages/shared` and `packages/logger` (the only
  two without them).
- Line-verify per-column DB schema (`packages/database/src/schema.ts`) and audio
  resolver internals (`packages/audio-module/src/resolver/*`) — verified at the
  contract/usage level only in this pass.

---

## 7. The one-paragraph mental model

Two long-running processes share one Postgres DB. The **bot** (`apps/bot`)
connects to Discord via the single `DiscordAdapter`, runs all 20 feature modules
through `BotKernel` (which owns command/event dispatch, the error boundary, the
scheduler, and health), and serves a token-guarded internal HTTP API. The
**admin** (`apps/admin`, Fastify SSR) has **no Discord connection** — it writes
content/settings/module-toggles to the DB and the bot's scheduler delivers them;
the only live call admin makes to the bot is audio control over the internal API.
Core defines interfaces; Discord and Postgres live at the edges; modules speak
only core contracts. Everything builds/tests/runs in Docker via the `app`
toolbox. When extending, keep the three-place module wiring in sync, regenerate
migrations from `schema.ts`, and respect the privileged-intent ↔ portal pairing.
