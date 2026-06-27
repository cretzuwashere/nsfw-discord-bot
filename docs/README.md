# botplatform — Documentation Map (all the docs)

This is the **top-level index for the entire `docs/` tree**. Use it to find which
document answers your question, and which documents are authoritative vs.
reference. `botplatform` is a **Docker-first, modular Discord bot platform**: a
Discord audio/music bot plus **20 community modules**, fronted by a Fastify
server-side-rendered (SSR) admin panel; a pnpm-workspace monorepo (npm scope
`@botplatform`). The host has **no Node, pnpm, ffmpeg, psql, or Playwright** —
everything runs in Linux Docker containers (`docker compose exec app pnpm …`).

> **The repo standard is [`../AGENTS.md`](../AGENTS.md)** — the auto-discovered,
> authoritative rulebook every agent and human MUST follow. **Authority order
> when docs conflict:** `AGENTS.md` → `docs/technical/` → per-feature
> `docs/<feature>/` → legacy root `docs/*.md`. Verified status (2026-06-27):
> 20 modules, 10 DB migrations (`0000`..`0009`), 5 platform events, all
> validation gates green, bot connected to Discord.

## Start here

- **New agent or human?** Read **[`../AGENTS.md`](../AGENTS.md)** (the standard),
  then **[`technical/agent-handoff.md`](technical/agent-handoff.md)** (the
  technical entry point: boot, fragile areas, backlog).
- **Just want the canonical technical docs?** Open
  **[`technical/README.md`](technical/README.md)**.

## Minimal boot command set (DEV, from the repo root)

```bash
cp .env.example .env                          # optional in dev (every var has a safe default)
docker compose up -d --build                  # build images + start db, app, bot, admin
docker compose exec app pnpm install          # populate the shared node_modules volume (once)
docker compose exec app pnpm db:setup         # = db:migrate && db:seed (creates admin@example.com)
```

Then open <http://localhost:3000> and log in with `ADMIN_EMAIL` /
`ADMIN_PASSWORD` from your `.env`. Clean-room / CI-equivalent gate:
`bash scripts/clean-validate.sh`.

---

## 1. `docs/technical/` — canonical, code-verified technical docs (START HERE)

The authoritative technical reference, kept in lockstep with the code. Entry
point: `technical/agent-handoff.md`. If a technical doc disagrees with the code,
the code wins and the doc is a bug to fix.

| File | Purpose | Status |
|---|---|---|
| [`technical/README.md`](technical/README.md) | Index for `docs/technical/` + minimal command set. | Canonical |
| [`technical/agent-handoff.md`](technical/agent-handoff.md) | **The entry point.** Orientation, boot, day-to-day commands, fragile areas, future-tasks backlog. | Canonical |
| [`technical/architecture.md`](technical/architecture.md) | Layered hexagonal design, core contracts, module lifecycle, bot↔admin internal-API seam, coupling. | Canonical |
| [`technical/modules.md`](technical/modules.md) | The 20-module catalogue: commands/events/intents and admin-page coverage per module. | Canonical |
| [`technical/commands-and-events.md`](technical/commands-and-events.md) | Every slash command + subcommand, every platform/Discord event, intents, permissions, module↔command matrix. | Canonical |
| [`technical/discord-bot-flows.md`](technical/discord-bot-flows.md) | End-to-end Discord usage flows (audio, moderation, role menus, welcome, scheduling). | Canonical |
| [`technical/environment.md`](technical/environment.md) | Every env var (required/optional, default, consumer), secrets, Discord portal setup, `.env` recipes. | Canonical |
| [`technical/runtime-and-docker.md`](technical/runtime-and-docker.md) | Operator runbook: dev/prod/validation contexts, services, volumes, health endpoints, command reference. | Canonical |
| [`technical/testing.md`](technical/testing.md) | Unit/integration/e2e layers + the manual Discord smoke-test checklist. | Canonical |
| [`technical/troubleshooting.md`](technical/troubleshooting.md) | Symptom → cause → fix; corrections to the legacy troubleshooting doc. | Canonical |

## 2. `docs/<feature>/` — per-feature deep docs (owned by feature efforts)

Deep dives owned by specific feature workstreams. Do not retitle or merge these
into `docs/technical/`; cross-link instead.

| Folder | Purpose | Status |
|---|---|---|
| [`music/`](music/) (10 files) | Music System Extension deep docs: queue, YouTube playback/playlists, long-track playback, online radio, commands, testing, troubleshooting, roadmap. | Feature-owned |
| [`raise-hand/`](raise-hand/) (9 files) | Raise Hand / Speaker Queue deep docs: overview, commands/interactions, user & moderator flows, queue/priority rules, permissions, testing, troubleshooting, roadmap. | Feature-owned |
| [`fun-features/`](fun-features/) (8 files + [`features/`](fun-features/features/) with 10 per-feature specs) | Fun-features deep docs: overview, research, top-10 selection, commands/interactions, permissions, testing, troubleshooting, roadmap. | Feature-owned |

## 3. `docs/agent-memory/` — per-orchestration working notes

Per-agent analysis with `## Checkpoint` blocks. **RULE (`AGENTS.md` §4.3,
non-negotiable):** each orchestration MUST namespace its notes in its own
subfolder. **Never write flat `0X-*.md` into `docs/agent-memory/` root.**

| Location | Purpose | Status |
|---|---|---|
| [`agent-memory/tech-docs/`](agent-memory/tech-docs/) | **This remake's** namespaced notes (`01-inventory.md`, module groups, `98-review.md`, [`99-final-report.md`](agent-memory/tech-docs/99-final-report.md)). | Working notes — namespaced (correct) |
| [`agent-memory/music/`](agent-memory/music/) (9 files) | Music orchestration's notes. | Working notes — do not edit if not yours |
| [`agent-memory/fun-features/`](agent-memory/fun-features/) (19 files) | Fun-features orchestration's notes. | Working notes — do not edit if not yours |
| `agent-memory/*.md` (flat root, ~18 files) | Mixed flat `0X-*` notes from **three** efforts (original doc pass + Raise Hand + leftovers), incl. an awkward `*.docpass-archive.md` rename. | **Collided — do not add more; namespace instead** |

> **The collision is intentional history, not a bug to fix:** the original doc
> pass wrote flat `00..99` notes, then two later efforts reused the same numbers,
> so `00-orchestrator-plan.md` was claimed twice (hence
> `00-orchestrator-plan.docpass-archive.md`). Leave the existing flat files;
> only ever add new notes under a namespaced subfolder.

## 4. Legacy root `docs/*.md` — original per-feature reference (some stale)

The original uppercase per-feature docs. Useful background, but **some predate
the 20-module growth and are stale**. When a legacy doc conflicts with
`docs/technical/`, defer to `docs/technical/`.

| File | Purpose | Status |
|---|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Original architecture overview. | Reference — superseded by `technical/architecture.md` |
| [`ADMIN_PANEL.md`](ADMIN_PANEL.md) | Admin panel overview. | Reference |
| [`ANNOUNCEMENTS.md`](ANNOUNCEMENTS.md) | Announcements module. | Reference |
| [`ASSUMPTIONS.md`](ASSUMPTIONS.md) | Project assumptions. | Reference |
| [`AUDIO_SOURCES.md`](AUDIO_SOURCES.md) | Audio/music source resolution. | Reference — see also `music/` |
| [`AUTOMOD.md`](AUTOMOD.md) | Auto-moderation module. | Reference |
| [`BIRTHDAYS_AND_REMINDERS.md`](BIRTHDAYS_AND_REMINDERS.md) | Birthdays & reminders modules. | Reference |
| [`COMMUNITY_MODULES.md`](COMMUNITY_MODULES.md) | Community modules overview. | Reference — predates the 9 newest modules; trust `technical/modules.md` |
| [`CUSTOM_COMMANDS.md`](CUSTOM_COMMANDS.md) | Custom commands module. | Reference |
| [`DISCORD_SETUP.md`](DISCORD_SETUP.md) | Discord developer-portal setup. | Reference — see also `technical/environment.md` |
| [`DOCKER_DEPLOYMENT.md`](DOCKER_DEPLOYMENT.md) | Docker prod/local-server deployment. | Reference — see also `technical/runtime-and-docker.md` |
| [`DOCKER_DEVELOPMENT.md`](DOCKER_DEVELOPMENT.md) | Docker dev command reference. | Reference — see also `technical/runtime-and-docker.md` |
| [`DYNAMIC_CARDS.md`](DYNAMIC_CARDS.md) | Dynamic cards module. | Reference |
| [`GITHUB_DEPLOYMENT.md`](GITHUB_DEPLOYMENT.md) | GitHub-based deployment. | Reference |
| [`LOCAL_RUN.md`](LOCAL_RUN.md) | Guided first start. | Reference — see also `technical/runtime-and-docker.md` |
| [`MODERATION.md`](MODERATION.md) | Moderation module. | Reference |
| [`MODERATION_ROADMAP.md`](MODERATION_ROADMAP.md) | Moderation roadmap. | Reference |
| [`PERMISSIONS.md`](PERMISSIONS.md) | Permission model. | Reference |
| [`PRIVACY.md`](PRIVACY.md) | Data handling & privacy. | Reference |
| [`REACTION_ROLES.md`](REACTION_ROLES.md) | Reaction roles / role menus. | Reference — note: role menus are buttons/select menus, not emoji reactions |
| [`SCHEDULED_MESSAGES.md`](SCHEDULED_MESSAGES.md) | Scheduled messages module. | Reference |
| [`SECURITY.md`](SECURITY.md) | Security model. | Reference |
| [`TESTING.md`](TESTING.md) | Original testing notes. | Reference — superseded by `technical/testing.md` |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | Thin **redirect stub** → `technical/troubleshooting.md`; keeps only Windows/WSL2 host notes. | Redirect — authoritative copy is `technical/troubleshooting.md` |

---

## Current verified status (2026-06-27)

`[verified in code]` unless tagged otherwise.

- **20 modules** wired in `apps/bot/src/main.ts` and keyed in
  `packages/shared/src/types.ts` `MODULE_KEYS`.
- **10 Drizzle migrations** (`0000_romantic_moonstone` … `0009_legal_cammi`).
- **5 platform events** (`packages/core/src/contracts/events.ts`).
- **All validation gates green** `[verified by execution 2026-06-27]` (lint,
  typecheck, unit 471, integration 37, e2e 24+1, build, prod images build, admin
  + bot `/healthz` OK, bot connected to Discord).
- **Known gaps:** the 9 newest modules (raise-hand, fun-commands,
  engagement-prompts, giveaways, server-stats, trivia, minigames, economy,
  levels) have **no dedicated admin page**, and the prod `Dockerfile` `proddeps`
  stage is **missing those 9 module manifests**. See `AGENTS.md` §8 and
  `technical/agent-handoff.md` §6.
