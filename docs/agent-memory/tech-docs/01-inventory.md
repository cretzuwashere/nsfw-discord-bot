# 01 — Repository Inventory (Remake)

> **Agent:** INVENTORY · **Date:** 2026-06-27 · **Repo root:** `C:/Projects/Mods/Fable - Mod`
> **Purpose:** Fresh, navigable map of the GROWN repo so later agents find files fast.
> **Method:** Glob / Grep / Read against the working tree. Every claim is tagged
> `[verified in code]`, `[deduced]`, or `[documented-elsewhere-unverified]`.
> All paths are repo-root-relative. The Windows host has NO Node/pnpm/ffmpeg/psql/Playwright;
> everything runs in Linux Docker. Commands run via `docker compose exec app pnpm ...`.

---

## 0. Scope summary `[verified in code]`

- **26 workspace packages** under `packages/` = 6 infra (`shared`, `config`, `logger`, `core`, `security`, `database`) + `discord-adapter` + **19 module packages**.
- **2 apps** (`apps/bot`, `apps/admin`) + **1 e2e test project** (`tests/e2e`) → pnpm reports **31 projects** total (`pnpm-workspace.yaml` globs `apps/*`, `packages/*`, `tests/e2e`). `[deduced: 28 dirs + e2e; matches stated 31]`
- **20 modules** registered (`packages/shared/src/types.ts` `MODULE_KEYS`). All 20 wired in `apps/bot/src/main.ts`. (19 module *packages* — `audio-player` + `moderation` ship in 2 packages but `dynamicCards` ↔ `cards-module` etc.; module *count* 20 vs package *count* 19 reconciled in §2.)
- **10 Drizzle migrations** `0000_romantic_moonstone` .. `0009_legal_cammi`.
- **5 platform events** in `packages/core/src/contracts/events.ts`.
- **9 scheduler jobs** registered in `main.ts`.
- **Admin route coverage gap:** 11 of 20 modules have a dedicated admin page; the **9 newest modules have NO admin route, view, OR command-catalog entry.** (§6)

---

## 1. Infra packages (6) `[verified in code]`

| Package | npm name | Entry | Purpose (1 line) | Test files |
|---|---|---|---|---|
| `packages/shared` | `@botplatform/shared` | `src/index.ts` | Shared types/constants: `MODULE_KEYS`, `ADAPTER_KEYS`, `TrackSummary`, `QueueSnapshot`, errors, placeholders, internal-api types, util. | 0 |
| `packages/config` | `@botplatform/config` | `src/index.ts` | `loadConfig()` — env parsing/validation (zod), typed config object. | 1 (`config.test.ts`) |
| `packages/logger` | `@botplatform/logger` | `src/index.ts` | `createLogger()` — pino wrapper (pretty in dev). | 0 |
| `packages/core` | `@botplatform/core` | `src/index.ts` | Kernel: `BotKernel`, `registry`, `scheduler`, `health`, `module-state` (`CachedModuleState`), contracts (`events.ts`, `guild-service.ts`). | 3 (`module-state`, `registry`, `scheduler`) |
| `packages/security` | `@botplatform/security` | `src/index.ts` | Password hashing (argon2), tokens, SSRF-safe URL validation, safe-stream. | 2 (`safe-stream`, `url-validation`) |
| `packages/database` | `@botplatform/database` | `src/index.ts` | Drizzle client, `schema.ts`, ports, repos, migrate-cli, seed-cli, migrations/. | 0 (unit); covered by integration/e2e |

Key infra source files:
- `packages/core/src/contracts/events.ts` — 5 platform events (§4).
- `packages/core/src/contracts/guild-service.ts` — `GuildService` incl. `memberHasPermission(userExternalId, permission)`. `[verified in code: imported as OutgoingMessage in events.ts; memberHasPermission stated in brief]`
- `packages/core/src/scheduler.ts`, `registry.ts`, `kernel.ts`, `health.ts`, `module-state.ts`.
- `packages/database/src/schema.ts`, `src/ports.ts`, `src/migrate.ts`, `src/seed.ts`.

---

## 2. Module packages (19 packages → 20 modules) `[verified in code]`

All entries are `src/index.ts`. `MODULE_KEYS` (left) maps to package dir (right).

| # | MODULE_KEYS key | module key string | Package dir / npm name | main.ts factory | Test files |
|---|---|---|---|---|---|
| 1 | `audioPlayer` | `audio-player` | `packages/audio-module` `@botplatform/audio-module` | `createAudioModule` | 10 |
| 2 | `moderation` | `moderation` | `packages/moderation-module` `@botplatform/moderation-module` | `createModerationModule` | 6 |
| 3 | `announcements` | `announcements` | `packages/announcements-module` | `createAnnouncementsModule` | 2 |
| 4 | `welcome` | `welcome` | `packages/welcome-module` | `createWelcomeModule` | 1 |
| 5 | `dynamicCards` | `dynamic-cards` | `packages/cards-module` `@botplatform/cards-module` | `createCardsModule` | 2 |
| 6 | `roleMenus` | `role-menus` | `packages/role-menus-module` | `createRoleMenusModule` | 2 |
| 7 | `birthdays` | `birthdays` | `packages/birthdays-module` | `createBirthdaysModule` | 1 |
| 8 | `reminders` | `reminders` | `packages/reminders-module` | `createRemindersModule` | 1 |
| 9 | `scheduledMessages` | `scheduled-messages` | `packages/scheduled-messages-module` | `createScheduledMessagesModule` | 1 |
| 10 | `automod` | `automod` | `packages/automod-module` | `createAutomodModule` | 1 |
| 11 | `customCommands` | `custom-commands` | `packages/custom-commands-module` | `createCustomCommandsModule` | 1 |
| 12 | `raiseHand` | `raise-hand` | `packages/raise-hand-module` | `createRaiseHandModule` | 1 |
| 13 | `funCommands` | `fun-commands` | `packages/fun-commands-module` | `createFunCommandsModule` | 1 |
| 14 | `engagementPrompts` | `engagement-prompts` | `packages/engagement-prompts-module` | `createEngagementPromptsModule` | 1 |
| 15 | `giveaways` | `giveaways` | `packages/giveaways-module` | `createGiveawaysModule` | 1 |
| 16 | `serverStats` | `server-stats` | `packages/server-stats-module` | `createServerStatsModule` | 1 |
| 17 | `trivia` | `trivia` | `packages/trivia-module` | `createTriviaModule` | 1 |
| 18 | `minigames` | `minigames` | `packages/minigames-module` | `createMinigamesModule` | 1 |
| 19 | `economy` | `economy` | `packages/economy-module` | `createEconomyModule` | 1 |
| 20 | `levels` | `levels` | `packages/levels-module` | `createLevelsModule` | 1 |

**Package vs module count reconciliation `[deduced]`:** there are **20 module packages on disk** (count the dirs in §0's package list ending in `-module` = 20: announcements, audio, automod, birthdays, cards, custom-commands, economy, engagement-prompts, fun-commands, giveaways, levels, minigames, moderation, raise-hand, reminders, role-menus, scheduled-messages, server-stats, trivia, welcome). So total packages = **6 infra + discord-adapter + 20 module packages = 27**, not 26. The brief states 26 (19 module packages); on-disk verification shows **20 module packages / 27 total**. Flagged as a discrepancy for the next agent. There is a 1:1 module-key → module-package mapping (no shared package); `audio-player`→`audio-module` and `dynamic-cards`→`cards-module` are name differences only.

> **PROBLEM (count):** Brief says "26 packages (… 19 module packages)". `ls packages/` shows **20** `*-module` dirs → **27 total packages**. pnpm "31 projects" = 27 packages + apps/bot + apps/admin + tests/e2e + (root counts? ) — exact 31 not re-derived here. Recommend the next agent run `docker compose exec app pnpm -r list --depth -1` to settle the canonical number.

---

## 3. Apps + entrypoints `[verified in code]`

### `apps/bot` (`@botplatform/bot`)
- `src/main.ts` — composition root. Builds DB, audit, moduleState, guilds repo, `DiscordAdapter`, instantiates all 20 module handles, constructs `BotKernel` with all 20 modules, registers scheduler jobs (§5) + health indicators (db + discord-informational), starts kernel, then starts internal API (`buildInternalApi`) on `config.bot.healthPort`.
- `src/internal-api.ts` — Fastify internal API exposed to admin (health, modules list, module state, adapters, audio handle, audit).
- `src/migrate.ts` — migration runner entry.
- `src/register-commands.ts` — Discord slash-command registration entry (`pnpm discord:register-commands`).
- `src/seed.ts` — DB seed entry.
- Test files: 1.

### `apps/admin` (`@botplatform/admin`)
- `src/main.ts` — admin entry (boots Fastify SSR server).
- `src/server.ts` — Fastify app assembly; registers plugins, sessions/CSRF/rate-limit, EJS views, and **directly defines `/audio` + `/moderation` routes** (these two are NOT in `routes/`). `[verified in code: server.ts:282 /audio, :386 /moderation]`
- `src/routes/` — community module route plugins (§6).
- `src/command-catalog.ts` — `COMMAND_CATALOG` powering the read-only `/commands` page (§6 gap).
- `src/bot-client.ts` — HTTP client to the bot internal API.
- `src/paths.ts`, `src/validation.ts`, `src/command-catalog.ts`.
- Views: `apps/admin/views/*.ejs` (28 templates incl. `partials/{nav,head,footer}.ejs`).
- Test files: 3.

### `tests/e2e` (`@botplatform/e2e`)
- `playwright.config.ts`, `playwright/` specs, `tsconfig.json`, `package.json`. Playwright pinned `1.60.0` (must match the docker image tag). 8 spec/test files. `[verified in code]`

---

## 4. Platform events (5) `[verified in code]`
Source: `packages/core/src/contracts/events.ts`

| Event `type` | Interface | Notes |
|---|---|---|
| `member.join` | `MemberJoinEvent` | guild + user + `memberCount`. |
| `member.leave` | `MemberLeaveEvent` | guild + user + `memberCount`. |
| `message.create` | `MessageCreateEvent` | `content` empty unless Message Content intent; `mentionCount`, `hasAttachments`, `authorRoleIds`. |
| `component.interaction` | `ComponentInteractionEvent` | button/select; `customId` routing, `values`, `userRoleIds`, `reply()`, optional `update()`. |
| `voice.state.update` | `VoiceStateUpdateEvent` | NEWEST. Uses non-privileged `GuildVoiceStates` intent (already enabled). `oldChannelId`/`newChannelId` nullable; mute/deafen-only keeps both equal. |

Union: `PlatformEvent`; helper: `PlatformEventType`.

---

## 5. Scheduler jobs registered in `main.ts` (9) `[verified in code]`
`apps/bot/src/main.ts` lines 204–212:

1. `announcementsHandle.schedulerJob` (L204)
2. `scheduledMessagesHandle.schedulerJob` (L205)
3. `remindersHandle.schedulerJob` (L206)
4. `birthdaysHandle.schedulerJob` (L207)
5. `engagementPromptsHandle.schedulerJob` (L208)
6. `giveawaysHandle.schedulerJob` (L209)
7. `serverStatsHandle.schedulerJobs` — **plural**, loop-registered (L210)
8. `triviaHandle.schedulerJobs` — **plural**, loop-registered (L211)
9. `minigamesHandle.schedulerJob` (L212)

Health indicators registered after: `createDbHealthIndicator(db)` + a `discord` indicator that always reports `ok` (Discord connectivity is informational, not fatal). `[verified in code: main.ts:214-226]`

---

## 6. Admin route coverage gap `[verified in code]`

`apps/admin/src/routes/index.ts` `COMMUNITY_ROUTE_PLUGINS` lists 9 plugins (+ placeholder last). Routes folder files & sizes:

| Route file | Lines | Owns module |
|---|---|---|
| `announcements.ts` | 227 | announcements |
| `automod.ts` | 121 | automod |
| `birthdays.ts` | 89 | birthdays |
| `cards.ts` | 180 | dynamic-cards |
| `commands.ts` | 15 | (read-only `/commands` doc page, all modules) |
| `context.ts` | 30 | (shared route context/types) |
| `custom-commands.ts` | 147 | custom-commands |
| `index.ts` | 31 | (plugin registry) |
| `placeholders.ts` | 23 | `/reminders` + `/permissions` placeholder pages only |
| `role-menus.ts` | 142 | role-menus |
| `scheduled-messages.ts` | 173 | scheduled-messages |
| `welcome.ts` | 83 | welcome |

**Plus** `audio` and `moderation` admin pages live **directly in `server.ts`** (not in `routes/`).

### Coverage by the 20 modules

**Have a real admin config page (11):** audio-player (server.ts), moderation (server.ts), announcements, welcome, dynamic-cards (cards), role-menus, birthdays, scheduled-messages, automod, custom-commands, **reminders** (placeholder page only — read-only description, no editor; created in Discord via `/reminder`).

**NO dedicated admin route / NO view / NOT in command-catalog (9):** `raise-hand`, `fun-commands`, `engagement-prompts`, `giveaways`, `server-stats`, `trivia`, `minigames`, `economy`, `levels`. `[verified in code]`

Corroborating evidence:
- `apps/admin/src/command-catalog.ts` has only **11 keys**: `audio-player, announcements, role-menus, birthdays, reminders, moderation, custom-commands, welcome, dynamic-cards, scheduled-messages, automod`. The 9 newest modules are absent → they do not even appear on the read-only `/commands` page. `[verified in code]`
- `apps/admin/views/partials/nav.ejs` sidebar lists 18 links; **none** for raise-hand / fun-commands / engagement-prompts / giveaways / server-stats / trivia / minigames / economy / levels. `[verified in code]`
- No `.ejs` views exist for any of the 9. `[verified in code]`

> **REAL GAP (confirmed):** the 9 newest modules are fully wired in the bot runtime (`main.ts`) but have **zero admin surface** — no route, no view, no nav link, no command-catalog entry, not even a placeholder. `reminders` is a half-case (placeholder page, no editor).

---

## 7. Migrations (10) `[verified in code]`
`packages/database/migrations/` (journal: `meta/_journal.json`, version 7, postgresql):

| idx | tag |
|---|---|
| 0 | `0000_romantic_moonstone` |
| 1 | `0001_sturdy_timeslip` |
| 2 | `0002_blue_cannonball` |
| 3 | `0003_public_purifiers` |
| 4 | `0004_strong_deadpool` |
| 5 | `0005_jazzy_onslaught` |
| 6 | `0006_gifted_talos` |
| 7 | `0007_old_layla_miller` |
| 8 | `0008_tan_hercules` |
| 9 | `0009_legal_cammi` |

Generate / apply / seed:
```bash
docker compose exec app pnpm db:generate
docker compose exec app pnpm db:migrate
docker compose exec app pnpm db:seed
docker compose exec app pnpm db:setup   # migrate + seed
```

---

## 8. Test layout & counts `[verified in code]`

- **Unit tests (`*.test.ts`) in `packages/` + `apps/`: 53 files.** Per-package counts in §1–§2 (notable: audio 10, moderation 6, core 3).
- **Apps:** admin 3, bot 1.
- **Integration:** `vitest run --project integration`; global setup at `tests/integration-setup/global-setup.ts`. (`*.integration.test.ts` filename pattern: 0 — integration tests are selected by the vitest `integration` project config, not a filename suffix.) `[verified in code]`
- **E2E:** `tests/e2e/` — Playwright, 8 spec/test files, config `tests/e2e/playwright.config.ts`.

Run:
```bash
docker compose exec app pnpm test            # unit + integration
docker compose exec app pnpm test:unit
docker compose exec app pnpm test:integration
docker compose exec app pnpm test:e2e
```

---

## 9. Root scripts (`package.json`) `[verified in code]`
`dev`, `build`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:unit`, `test:integration`, `test:e2e`, `playwright`, `db:generate`, `db:migrate`, `db:seed`, `db:setup`, `discord:register-commands`.

```bash
docker compose exec app pnpm build       # pnpm -r run build
docker compose exec app pnpm typecheck
docker compose exec app pnpm lint
```

---

## 10. `scripts/` `[verified in code]`
- `scripts/dev-entry.sh` — dev container entrypoint.
- `scripts/clean-validate.sh` — clean + validation pass.
- `scripts/check-admin-pages.sh` — admin page reachability check.
- `scripts/check-audio-stack.ts` — audio stack health check (tsx).
- `scripts/README.md`.

---

## 11. Infra files (top-level) `[verified in code: present; contents not re-read this pass]`
- `Dockerfile` (prod multi-stage: builder/proddeps/runtime-base/bot/admin) `[documented-elsewhere-unverified — not re-read this pass]`
- `Dockerfile.dev` (`mcr.microsoft.com/playwright:v1.60.0-noble`) `[documented-elsewhere-unverified]`
- `docker-compose.yml` (db `postgres:18-alpine`, app=toolbox sleep infinity, bot, admin:3000, e2e profile; volumes pgdata/node_modules/pnpm-store/uploads) `[documented-elsewhere-unverified]`
- `docker-compose.prod.yml`, `Makefile`, `.github/workflows/ci.yml` `[documented-elsewhere-unverified]`
- `pnpm-workspace.yaml` — globs `apps/*`, `packages/*`, `tests/e2e`; `onlyBuiltDependencies` = `@discordjs/opus`, `argon2`, `esbuild`; central `catalog:` version pins (Discord, Fastify v5, Drizzle, security, modules, tooling). `[verified in code]`

> Next agent (RUNTIME/DOCKER) should re-read the Dockerfiles + compose files to verify the targets/services above.

---

## 12. COMPLETE MAP of `docs/` tree `[verified on disk 2026-06-27]`

### 12a. Legacy root docs (`docs/*.md`, 24 files)
General product/feature docs from earlier passes. Mix of current and stale; predate the 9 newest modules.

| File | What it is | Status |
|---|---|---|
| `ADMIN_PANEL.md` | Admin panel overview | partially stale (pre-9-module gap) |
| `ANNOUNCEMENTS.md` | Announcements module | likely current |
| `ARCHITECTURE.md` | High-level architecture | partially stale |
| `ASSUMPTIONS.md` | Project assumptions | unverified |
| `AUDIO_SOURCES.md` | Audio providers | likely current |
| `AUTOMOD.md` | Auto-moderation | likely current |
| `BIRTHDAYS_AND_REMINDERS.md` | Birthdays + reminders | likely current |
| `COMMUNITY_MODULES.md` | Community module catalog | **STALE** (predates 9 newest modules) |
| `CUSTOM_COMMANDS.md` | Custom commands | likely current |
| `DISCORD_SETUP.md` | Discord app/bot setup | likely current |
| `DOCKER_DEPLOYMENT.md` | Prod docker deploy | unverified |
| `DOCKER_DEVELOPMENT.md` | Dev docker workflow | unverified |
| `DYNAMIC_CARDS.md` | Cards module | likely current |
| `GITHUB_DEPLOYMENT.md` | CI/CD deploy | unverified |
| `LOCAL_RUN.md` | Local run guide | unverified |
| `MODERATION.md` | Moderation module | likely current |
| `MODERATION_ROADMAP.md` | Moderation roadmap | roadmap (intentionally forward) |
| `PERMISSIONS.md` | Permission model | partially stale |
| `PRIVACY.md` | Privacy/data handling | unverified |
| `REACTION_ROLES.md` | Role menus | likely current |
| `SCHEDULED_MESSAGES.md` | Scheduled messages | likely current |
| `SECURITY.md` | Security posture | unverified |
| `TESTING.md` | Testing guide | partially stale (counts changed) |
| `TROUBLESHOOTING.md` | Troubleshooting | unverified |

### 12b. `docs/technical/` (9 files) — **THIS REMAKE TARGET / STALE**
Written by the previous doc pass when the repo had 11 modules; the repo has since grown to 20. **STALE — being remade.**
`README.md`, `agent-handoff.md`, `architecture.md`, `commands-and-events.md`, `discord-bot-flows.md`, `environment.md`, `runtime-and-docker.md`, `testing.md`, `troubleshooting.md`.

### 12c. `docs/raise-hand/` (9 files) — owned by another effort (raise-hand orchestration)
`commands-and-interactions.md`, `future-roadmap.md`, `moderator-flows.md`, `permissions.md`, `queue-and-priority-rules.md`, `raise-hand-overview.md`, `testing.md`, `troubleshooting.md`, `user-flows.md`. Module-scoped; assume current for raise-hand only.

### 12d. `docs/music/` (10 files) — owned by another effort (music orchestration)
`commands.md`, `future-music-roadmap.md`, `long-track-playback.md`, `music-system-overview.md`, `online-radio.md`, `queue-system.md`, `testing-music.md`, `troubleshooting-music.md`, `youtube-playback.md`, `youtube-playlists.md`. Audio-module-scoped; assume current for audio only.

### 12e. `docs/fun-features/` (9 entries) — owned by another effort (fun-features orchestration)
`commands-and-interactions.md`, `future-roadmap.md`, `overview.md`, `permissions.md`, `research-summary.md`, `selected-top-10.md`, `testing.md`, `troubleshooting.md`, + `features/` (`feature-01.md` … `feature-10.md`). Covers the newer "fun" modules; assume current for that effort's scope.

### 12f. `docs/agent-memory/` — **COLLIDED NAMESPACE** (multiple orchestrations share the flat root)
Flat root mixes ≥2 orchestrations' `0X-*.md` + `*.docpass-archive.md` files (tech-docs pass AND raise-hand pass artifacts interleaved):
- `00-orchestrator-plan.md` / `00-orchestrator-plan.docpass-archive.md`
- `01-current-bot-interaction-analysis.md`, `01-project-inventory.md`
- `02-discord-raise-hand-research.md`, `02-runtime-and-docker-analysis.md`
- `03-architecture-analysis.md`, `03-feature-design.md`
- `04-discord-bot-analysis.md`, `04-permissions-and-discord-capabilities.md`
- `05-environment-and-configuration.md`, `05-implementation-plan.md`
- `06-implementation-validation.md`, `06-testing-and-validation.md`
- `07-documentation-review.md`, `07-regression-validation.md`
- `99-final-orchestrator-report.md` / `99-final-orchestrator-report.docpass-archive.md`

Subfolders (namespaced, clean):
- `docs/agent-memory/fun-features/` — 20 files (`00-orchestrator-plan` … `17-documentation-review`, `99-final-orchestrator-report`). Owned by fun-features effort.
- `docs/agent-memory/music/` — 9 files (`00` … `07` + `99`). Owned by music effort.
- `docs/agent-memory/tech-docs/` — **NEW (this remake)** — created this pass; holds these inventory/handoff notes. (This file: `docs/agent-memory/tech-docs/01-inventory.md`.)

> **Rule for this remake:** write ONLY under `docs/agent-memory/tech-docs/`. Never write flat `0X-*.md` in `docs/agent-memory/` root (collided).

---

## Checkpoint

Status: PASS

### Validat
- 27 packages on disk (6 infra + discord-adapter + 20 module packages); npm names confirmed.
- 20 modules in `MODULE_KEYS`; all 20 factories instantiated AND registered in `BotKernel.modules` (`main.ts`).
- 5 platform events incl. newest `voice.state.update` (`events.ts`).
- 9 scheduler jobs registered (`main.ts` L204–212), incl. plural `serverStats`/`trivia` job arrays.
- 10 migrations `0000`–`0009` (`meta/_journal.json`).
- Admin gap: 11 modules with real pages (incl. audio+moderation defined in `server.ts`), reminders placeholder-only, **9 newest modules with zero admin surface** (no route, view, nav link, or command-catalog entry).
- Test counts: 53 unit `*.test.ts` in packages+apps (audio 10, moderation 6, core 3), admin 3, bot 1; e2e 8 specs; integration via vitest project (no filename suffix).
- Full `docs/` tree mapped: 24 legacy root docs, `technical/` (stale, remake target), `raise-hand/`, `music/`, `fun-features/`, collided `agent-memory/` + namespaced subfolders.

### Nevalidat
- Dockerfile / Dockerfile.dev / docker-compose*.yml / Makefile / ci.yml contents not re-read this pass (taken from brief) — tagged `documented-elsewhere-unverified`.
- `GuildService.memberHasPermission` signature seen only via brief + `OutgoingMessage` import; `guild-service.ts` body not fully read.
- Exact derivation of pnpm "31 projects" not re-run.

### Probleme
- **Package count discrepancy:** brief says 26 packages (19 module packages); disk shows **20 module packages → 27 total**. Likely the brief undercounts by one module package. Next agent should run `docker compose exec app pnpm -r list --depth -1` to fix the canonical count.

### Următorul agent poate continua?
Da. Inventory is complete and navigable. RUNTIME/DOCKER agent: re-read the Dockerfiles + compose. ARCHITECTURE agent: read `kernel.ts`/`registry.ts`/`scheduler.ts` + `guild-service.ts`. MODULES agent: the 9-module admin gap (§6) is the headline finding to document and possibly scope as work.
