# AGENTS.md — the botplatform standard

> **This is the single authoritative standard for `botplatform`.** Every agent
> (and human) working in this repo MUST read and follow this file. It is the
> auto-discovered standard at the repo root. When anything here conflicts with an
> older doc, **this file and `docs/technical/` win** — older docs are demoted to
> reference (see the Documentation Standard below).
>
> Verified status (2026-06-27): **20 modules, 10 DB migrations (0000..0009),
> 5 platform events, all validation gates green, bot connected to Discord.**
> Facts in this file are tagged `[verified in code]`, `[verified by execution
> 2026-06-27]`, `[deduced]`, or `[documented-elsewhere-unverified]`.

---

## 1. Prime directive — Docker-first; the host has no toolchain

The Windows host has **no Node, pnpm, ffmpeg, psql, or Playwright**. Everything
runs inside Linux Docker containers. **Every `pnpm` command runs inside the `app`
toolbox container** `[verified in code: docker-compose.yml app service is the
toolbox; root scripts are all pnpm]`:

```bash
docker compose exec app pnpm <anything>
```

Do not try to run Node/pnpm/tsc/eslint/vitest/drizzle/playwright on the host —
they are not installed and are not expected to be.

**The canonical validation gate is `scripts/clean-validate.sh`** — a clean-room
(`down -v`, rebuild from zero) run of every check, identical to CI's `validate`
job `[verified in code: scripts/clean-validate.sh + .github/workflows/ci.yml]`:

```bash
bash scripts/clean-validate.sh
```

This MUST stay green before any merge. In a warm dev stack you can run the
individual gates instead (faster, no volume wipe) — see §2. `clean-validate.sh`
drives `docker compose` from the host, so run it from the repo root.

---

## 2. Quick start

Run from the repo root (`C:/Projects/Mods/Fable - Mod`). The host needs **only
Docker** `[verified in code: docs/technical/agent-handoff.md §2, compose files]`.

### Boot from zero (DEV)

```bash
cp .env.example .env                 # optional in dev — every var has a safe default
docker compose up -d --build         # build images + start db, app, bot, admin
docker compose exec app pnpm install # populate the shared node_modules volume (once)
docker compose exec app pnpm db:setup # = db:migrate && db:seed (creates admin@example.com)
```

Then open the admin panel at <http://localhost:3000> and log in with
`ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. `bot` and `admin` idle in a wait
loop until `pnpm install` writes `node_modules/.modules.yaml`, then their tsx
watchers boot automatically — confirm with `docker compose ps`
`[verified in code: scripts/dev-entry.sh]`.

### Individual gates (warm stack, no volume wipe)

```bash
docker compose exec app pnpm install          # frozen lockfile in CI form: add --frozen-lockfile
docker compose exec app pnpm lint             # eslint .
docker compose exec app pnpm typecheck        # tsc across all workspace projects
docker compose exec app pnpm test:unit        # vitest unit project
docker compose exec app pnpm db:migrate       # apply migrations 0000..0009
docker compose exec app pnpm test:integration # vitest integration project (needs DB)
docker compose exec app pnpm db:seed          # idempotent module rows + bootstrap admin
docker compose exec app pnpm build            # tsup ESM bundles, all packages
docker compose --profile e2e run --rm e2e     # Playwright chromium (needs admin healthy)
docker compose -f docker-compose.prod.yml build # build the 3 prod images
```

Health endpoints (from inside `app`, or via mapped ports):

```bash
docker compose exec app curl -fsS http://bot:8081/healthz    # bot internal API
docker compose exec app curl -fsS http://admin:3000/healthz  # admin
```

### Where to go next

1. **`docs/technical/agent-handoff.md`** — the technical entry point (orientation,
   fragile areas, backlog).
2. **`README.md`** (repo root) — project overview.
3. **`docs/technical/`** — the canonical, code-verified technical docs (full map
   in §4).

---

## 3. GOLDEN RULES — invariants (non-negotiable)

Each is one line. Violating any of these breaks the build, the runtime, or a
merge. All `[verified in code]` unless noted.

1. **ESM everywhere + `.js` import suffixes.** Source is `.ts`, but relative
   imports use the `.js` suffix (NodeNext/ESM); never drop them.
2. **Run everything in Docker.** No host toolchain — always
   `docker compose exec app pnpm …`.
3. **THE THREE-PLACE MODULE WIRING** — adding/removing a module requires ALL of:
   (a) the key in `MODULE_KEYS` (`packages/shared/src/types.ts`), (b) the factory
   wired into `apps/bot/src/main.ts`, (c) a seed row in
   `packages/database/src/seed.ts`. Miss one ⇒ the module won't appear / enable /
   register correctly.
4. **PLUS the register-commands mirror** — if the module owns slash commands, also
   add it to `apps/bot/src/register-commands.ts` (manual mirror), or the commands
   never register with Discord.
5. **DB change ⇒ Drizzle migration.** Edit `packages/database/src/schema.ts`, then
   `docker compose exec app pnpm db:generate` (emits a new migration) → `db:migrate`.
   Never hand-edit `schema.ts`-generated migrations; never edit an already-applied
   migration.
6. **Never commit `.env` or secrets.** Use placeholders in docs
   (`<DISCORD_BOT_TOKEN>`, `<DISCORD_CLIENT_ID>`, `<DISCORD_GUILD_ID>`); never copy
   real `.env` values anywhere.
7. **`scripts/*.sh` must be LF** (enforced by `.gitattributes`). CRLF breaks bash
   inside the container.
8. **Prod `Dockerfile` `proddeps` stage must list EVERY module manifest.** It
   copies `package.json` files one-by-one then runs `pnpm install --prod`; a
   missing manifest means that package's prod deps are absent at runtime.
   **⚠ Currently 9 manifests are MISSING here — see §6 and §8.**
9. **Privileged-intent flags must match the Discord developer portal.**
   `DISCORD_ENABLE_GUILD_MEMBERS` / `DISCORD_ENABLE_MESSAGE_CONTENT` add
   privileged gateway intents; enabling a flag without the matching portal toggle
   ⇒ gateway **close code 4014**. (`GuildVoiceStates` is NOT privileged and is
   always on.)
10. **pnpm `node-linker=hoisted` + the `node_modules` named volume** (`.npmrc` +
    `docker-compose.yml`). A single flat root `node_modules` shared via one named
    volume — do not change the linker or volume model.
11. **Catalog pins are central** (`pnpm-workspace.yaml` `catalog:`); bump versions
    there only. `@playwright/test` (1.60.0) MUST equal the
    `mcr.microsoft.com/playwright` image tag (`v1.60.0-noble`) in `Dockerfile.dev`.
12. **Native builds are gated** — `pnpm-workspace.yaml` `onlyBuiltDependencies`
    must keep listing `@discordjs/opus`, `argon2`, `esbuild`, or their build
    scripts won't run (audio opus + password hashing break).
13. **`clean-validate.sh` (or all individual gates) must be green before merge.**
14. **Commit only when asked; never commit the working tree's large uncommitted
    changes** (they are expected/in-progress). If you must branch, branch off
    `main`.

---

## 4. THE DOCUMENTATION STANDARD (all the docs)

This is the core of the standard. There are four documentation areas, each with a
distinct owner and authority level. **When they conflict, authority order is:
this `AGENTS.md` → `docs/technical/` → per-feature `docs/<feature>/` → legacy root
`docs/*.md`.**

### 4.1 `docs/technical/` — canonical, code-verified technical docs (START HERE)

The authoritative technical reference, kept in lockstep with the code. Entry
point: **`docs/technical/agent-handoff.md`**. Keep these current with every code
change. If a technical doc disagrees with the code, the code wins and the doc is a
bug to fix.

### 4.2 `docs/<feature>/` — per-feature deep docs (owned by feature efforts)

Deep dives owned by a specific feature workstream:
`docs/music/`, `docs/raise-hand/`, `docs/fun-features/`. Do not retitle or merge
these into `docs/technical/`; cross-link instead. Add a new `docs/<feature>/`
folder when you ship a substantial feature.

### 4.3 `docs/agent-memory/<workstream>/` — per-orchestration working notes

**RULE (non-negotiable): each orchestration MUST namespace its notes in its own
subfolder** — e.g. `docs/agent-memory/tech-docs/`, `docs/agent-memory/music/`,
`docs/agent-memory/fun-features/`. **NEVER write flat `0X-*.md` files into
`docs/agent-memory/` root.**

**Cautionary example (this actually happened):** the original documentation pass
wrote flat `00-orchestrator-plan.md … 99-final-orchestrator-report.md` into
`docs/agent-memory/` root. Then a "Raise Hand / Speaker Queue" effort AND a
"Music System Extension" effort *also* used the same flat numbering. The result:
`00-orchestrator-plan.md` was claimed by two efforts, forcing an awkward
`00-orchestrator-plan.docpass-archive.md` rename, and the flat `01..07` numbers
now mix three unrelated workstreams in one directory. Namespacing each workstream
in its own subfolder prevents this collision entirely.

Each memory file ends with a Checkpoint block:

```text
## Checkpoint

Status: PASS | PARTIAL | FAIL

### Validat
### Nevalidat
### Probleme
### Următorul agent poate continua?
```

### 4.4 Legacy root `docs/*.md` — original per-feature reference (some stale)

The original uppercase per-feature docs (`ARCHITECTURE.md`, `AUTOMOD.md`,
`DOCKER_DEVELOPMENT.md`, etc.). Useful background, but **some are stale**; when a
legacy root doc conflicts with `docs/technical/`, defer to `docs/technical/`.

### 4.5 Documentation conventions (apply to ALL areas)

- English; kebab-case `.md` filenames; one topic per file.
- Every command in a fenced code block; every important file cited by
  repo-root-relative path.
- Never expose secrets — use placeholders (`<DISCORD_BOT_TOKEN>` etc.).
- Mark claims as `[verified in code]` / `[deduced]` /
  `[documented-elsewhere-unverified]` where it matters.

### 4.6 When you add a module/feature, update the docs

- Update `docs/technical/modules.md` and `docs/technical/commands-and-events.md`.
- Update the doc map in §5 of this file.
- Add per-feature docs under `docs/<feature>/`.
- Put your orchestration's working notes under
  `docs/agent-memory/<your-workstream>/` (a new subfolder).

---

## 5. CURRENT DOC MAP

`[verified in code: directory listing 2026-06-27]`

| Area / file | Purpose | Status |
|---|---|---|
| **`AGENTS.md`** (this file) | The authoritative standard for the repo. | **Authoritative** |
| `README.md` (root) | Project overview, top-level pointers. | Current |
| **`docs/technical/agent-handoff.md`** | Technical entry point: boot, fragile areas, backlog. | Canonical |
| `docs/technical/README.md` | Index for `docs/technical/`. | Canonical |
| `docs/technical/architecture.md` | Layered hexagonal design, contracts, lifecycle, coupling. | Canonical |
| `docs/technical/runtime-and-docker.md` | Operator runbook: dev/prod/validation, services, volumes. | Canonical |
| `docs/technical/environment.md` | Every env var, secrets, Discord portal setup. | Canonical |
| `docs/technical/modules.md` | The module catalogue (commands/events/intents per module). | Canonical — keep the live module count here |
| `docs/technical/commands-and-events.md` | Every slash command + every platform/Discord event. | Canonical |
| `docs/technical/discord-bot-flows.md` | End-to-end Discord usage flows. | Canonical |
| `docs/technical/testing.md` | Unit/integration/e2e layers + manual Discord smoke checklist. | Canonical |
| `docs/technical/troubleshooting.md` | Symptom → cause → fix; corrections to legacy. | Canonical |
| `docs/music/` (10 files) | Music System Extension deep docs. | Feature-owned |
| `docs/raise-hand/` (9 files) | Raise Hand / Speaker Queue deep docs. | Feature-owned |
| `docs/fun-features/` (9 files + `features/`) | Fun-features deep docs. | Feature-owned |
| `docs/agent-memory/tech-docs/` | This (tech-docs) orchestration's namespaced notes. | Working notes |
| `docs/agent-memory/music/` | Music orchestration's notes. | Working notes (do not edit if not yours) |
| `docs/agent-memory/fun-features/` | Fun-features orchestration's notes. | Working notes |
| `docs/agent-memory/*.md` (flat root) | Mixed flat `0X-*` notes from 3 efforts. | **Collided — do not add more; namespace instead** |
| Legacy root `docs/*.md` (24 files) | Original per-feature reference. | Reference; some stale |

---

## 6. Fragile areas — "do not touch without care"

Summary only; see `docs/technical/architecture.md` and
`docs/technical/troubleshooting.md` for the full treatment, and
`docs/technical/agent-handoff.md §5` for the detailed fragile-area list.

- **The three-place module wiring + register-commands mirror** (Golden Rules
  3–4). The most common source of "my module doesn't show up".
- **Prod `Dockerfile` `proddeps` stage manifest list** (Golden Rule 8). It must
  enumerate every workspace manifest. `[verified in code]` it currently lists only
  the 6 infra packages + `discord-adapter` + **10** module manifests; the **9
  newest module manifests are missing** (raise-hand, fun-commands,
  engagement-prompts, giveaways, server-stats, trivia, minigames, economy,
  levels). The prod image build still passes today because tsup inlines workspace
  *source* into each bundle; the risk is any **external runtime dependency** a new
  module adds would be absent in the prod image. Treat this as a real gap to fix
  before relying on those modules in prod.
- **`node_modules` shared named volume + the dev wait loop** (Golden Rule 10) —
  `bot`/`admin` idle until `pnpm install` writes `.modules.yaml`. By design; don't
  "fix" it. Re-run `pnpm install` after dependency changes.
- **Privileged-intent ↔ Discord portal pairing** (Golden Rule 9) — mismatch ⇒
  gateway close 4014; `MessageContent` OFF silently degrades content automod;
  intent values are read once at construction, so changing them needs a bot
  restart.
- **Native opus/argon2 build gating** (Golden Rule 12) — `onlyBuiltDependencies`
  must keep listing them; `scripts/check-audio-stack.ts` verifies opus + ffmpeg
  are loadable.
- **Playwright pin lockstep** (Golden Rule 11) — `@playwright/test` catalog pin
  MUST equal the `Dockerfile.dev` base image tag; browsers are preinstalled, never
  run `playwright install`.
- **Migrations are generated, never hand-edited** (Golden Rule 5); never edit an
  applied migration.
- **Bot↔admin operational coupling** — `BOT_INTERNAL_URL` / `INTERNAL_API_TOKEN`
  must match between containers, or admin's audio controls fail. The contract
  itself is type-checked via `packages/shared/src/internal-api.ts`.
- **Admin imports module-internal repos/validation** — relocating a module's
  repo/validation export can break the admin build even though it's a different app.

---

## 7. Current verified status (2026-06-27)

`[verified in code]` unless tagged otherwise.

- **20 modules** wired in `apps/bot/src/main.ts`, all keyed in
  `packages/shared/src/types.ts` `MODULE_KEYS`, all seeded in
  `packages/database/src/seed.ts`:
  audio-player, moderation, announcements, welcome, dynamic-cards, role-menus,
  birthdays, reminders, scheduled-messages, automod, custom-commands, raise-hand,
  fun-commands, engagement-prompts, giveaways, server-stats, trivia, minigames,
  economy, levels.
- **10 Drizzle migrations** applied: `0000_romantic_moonstone` …
  `0009_legal_cammi` (`packages/database/migrations/`).
- **5 platform events** (`packages/core/src/contracts/events.ts`): `member.join`,
  `member.leave`, `message.create`, `component.interaction`,
  `voice.state.update` (newest; uses the non-privileged `GuildVoiceStates` intent).
- **4 base gateway intents** (`packages/discord-adapter/src/adapter.ts`): `Guilds`,
  `GuildVoiceStates`, `GuildMessages`, `GuildModeration`; plus opt-in privileged
  `GuildMembers` / `MessageContent`.
- **`GuildService.memberHasPermission(userExternalId, permission)`** exists for
  server-side per-member button gating
  (`packages/core/src/contracts/guild-service.ts` + discord-adapter impl).
- **27 packages** = 6 infra (`shared`, `config`, `logger`, `core`, `security`,
  `database`) + `discord-adapter` + **20 module packages** (one package per module
  key; `audio-player`→`audio-module` and `dynamic-cards`→`cards-module` are
  name-only differences). With `apps/bot`, `apps/admin`, `tests/e2e` and the repo
  root that is **31 pnpm workspace projects** (`pnpm install` reports "31").
- **Admin routes** (`apps/admin/src/routes/`) cover ~11 modules:
  `announcements`, `automod`, `birthdays`, `cards`, `commands`, `custom-commands`,
  `role-menus`, `scheduled-messages`, `welcome` (+ `index`, `context`,
  `placeholders`). **GAP:** the 9 newest modules (raise-hand, fun-commands,
  engagement-prompts, giveaways, server-stats, trivia, minigames, economy, levels)
  have **no dedicated admin route** — they fall through to `placeholders.ts`
  `[verified in code]`.

**Validation gates — all green** `[verified by execution 2026-06-27 against the
running dev stack]`: `pnpm install` (lockfile up to date, 31 projects),
`db:migrate` (10 applied), `lint`, `typecheck` (31 projects), `test:unit` (471
tests / 46 files), `test:integration` (37 tests / 7 files), `build` (tsup ESM,
all), bot `/healthz` ok + **connected to Discord**, admin `/healthz` ok, e2e (24
passed / 1 skipped, Playwright chromium), `docker-compose.prod.yml build` (3 prod
images). Counts are point-in-time; this pass ran against the warm running stack
(not a fresh `down -v`). The canonical clean-room gate remains
`bash scripts/clean-validate.sh`.

---

## 8. Known gaps for the next agent

- **Prod `Dockerfile` `proddeps` stage is missing 9 module manifests** (§6,
  Golden Rule 8) — add a `COPY packages/<module>/package.json …` line for each of
  raise-hand, fun-commands, engagement-prompts, giveaways, server-stats, trivia,
  minigames, economy, levels.
- **9 newest modules have no dedicated admin route** (§7) — they only have the
  `placeholders.ts` catch-all; add real `AdminRoutePlugin`s as the admin surface
  catches up.
- **`docs/agent-memory/` root is collided** (§4.3) — do not add flat `0X-*.md`
  there; always namespace under `docs/agent-memory/<workstream>/`.
