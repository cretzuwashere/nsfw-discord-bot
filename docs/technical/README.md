# botplatform — Technical Documentation

This is the index for `docs/technical/`. These docs were written by a multi-agent
documentation pass, **verified against source**, and the project was run
end-to-end in Docker — **all validation gates passed on 2026-06-27** (lint,
typecheck, unit 471, integration 37, e2e 24+1, build, prod images build, admin +
bot `/healthz` OK, and the **bot connected to Discord**). The authoritative,
code-verified status (module/migration/event counts) lives in the repo-root
[`../../AGENTS.md`](../../AGENTS.md) §7 and in
[`modules.md`](./modules.md).

> **The repo standard is [`../../AGENTS.md`](../../AGENTS.md)** — the
> auto-discovered, authoritative rulebook. When this index or any technical doc
> conflicts with an older doc, `AGENTS.md` and `docs/technical/` win. A top-level
> map of the *entire* `docs/` tree is in [`../README.md`](../README.md).

## What this project is

`botplatform` is a **Docker-first, modular Discord bot platform**: a Discord
audio/music bot plus a large set of community modules (**20 modules total**, e.g.
moderation, announcements, role menus, welcome, birthdays, reminders, scheduled
messages, automod, custom commands, dynamic cards, raise-hand, fun-commands,
engagement-prompts, giveaways, server-stats, trivia, minigames, economy, levels),
fronted by a Fastify **server-side-rendered (SSR) admin panel**. It is a
pnpm-workspace monorepo under the npm scope `@botplatform`. See
[`modules.md`](./modules.md) for the full, code-verified module catalogue.

There are two long-running processes sharing one PostgreSQL database:

- **Bot worker** (`apps/bot`) — connects to Discord, runs all modules + the
  scheduler, exposes a token-guarded internal HTTP API on `HEALTH_PORT` (8081).
- **Admin panel** (`apps/admin`) — Fastify SSR app for operators; reads/writes
  the DB and calls the bot's internal API. **It has no Discord connection.**

**The host needs only Docker.** There is no Node, pnpm, ffmpeg, psql, or
Playwright on the host — everything runs in Linux containers, and every `pnpm`
command runs inside the `app` toolbox container.

## How to use this documentation

- **New agent or human picking up the project?** Start with
  **[`agent-handoff.md`](./agent-handoff.md)** — the single entry point
  (orientation, boot command, day-to-day commands, fragile areas, future tasks).
- **Need to boot or operate the stack?** Go to
  **[`runtime-and-docker.md`](./runtime-and-docker.md)** (the operator runbook).
- **Need to understand the code?** Read **[`architecture.md`](./architecture.md)**.
- **Configuring env / Discord?** Read **[`environment.md`](./environment.md)**.
- **Working on Discord features?** Read **[`discord-bot-flows.md`](./discord-bot-flows.md)**
  and **[`commands-and-events.md`](./commands-and-events.md)**.
- **Running or extending tests?** Read **[`testing.md`](./testing.md)**.
- **Something broken?** Read **[`troubleshooting.md`](./troubleshooting.md)**.

Every command in these docs matches root `package.json`, the `Makefile`, and the
compose files; every cited file path exists on disk (cross-checked in the
documentation review pass).

## Recommended reading order

1. [`agent-handoff.md`](./agent-handoff.md) — start here.
2. [`runtime-and-docker.md`](./runtime-and-docker.md) — boot & operate.
3. [`architecture.md`](./architecture.md) — code & layering.
4. [`environment.md`](./environment.md) — config, env vars, secrets, Discord setup.
5. [`discord-bot-flows.md`](./discord-bot-flows.md) — end-to-end usage flows.
6. [`commands-and-events.md`](./commands-and-events.md) — commands, events, intents, permissions.
7. [`testing.md`](./testing.md) — test layers + manual Discord smoke checklist.
8. [`troubleshooting.md`](./troubleshooting.md) — symptom → cause → fix.

## Minimal command set to start the project (DEV)

Run from the repo root (`C:/Projects/Mods/Fable - Mod`):

```bash
cp .env.example .env                          # optional in dev (every var has a safe default)
docker compose up -d --build                  # build images + start db, app, bot, admin
docker compose exec app pnpm install          # populate the shared node_modules volume (once)
docker compose exec app pnpm db:setup         # = db:migrate && db:seed (creates admin@example.com)
```

Then open <http://localhost:3000> and log in with `ADMIN_EMAIL` /
`ADMIN_PASSWORD` from your `.env`. `bot` and `admin` start in a wait loop until
`pnpm install` finishes, then their tsx watchers boot automatically — confirm
with `docker compose ps`.

Pre-merge / CI-equivalent clean-room gate:

```bash
bash scripts/clean-validate.sh
```

Full command reference (raw `docker compose` + `make` equivalents) is in
[`runtime-and-docker.md`](./runtime-and-docker.md).

## Where the agent-memory files live

Deeper per-agent working notes (with checkpoints, problems, and what-remains
sections) live in **[`../agent-memory/`](../agent-memory/)**. The
documentation-pass set:

- [`00-orchestrator-plan.docpass-archive.md`](../agent-memory/00-orchestrator-plan.docpass-archive.md) — the doc-pass plan (Agent 0). It lives at the `*-archive` name because a concurrent "Raise Hand" effort claimed `00-orchestrator-plan.md`; see the note below.
- [`01-project-inventory.md`](../agent-memory/01-project-inventory.md) — full file/package/test map.
- [`02-runtime-and-docker-analysis.md`](../agent-memory/02-runtime-and-docker-analysis.md)
- [`03-architecture-analysis.md`](../agent-memory/03-architecture-analysis.md)
- [`04-discord-bot-analysis.md`](../agent-memory/04-discord-bot-analysis.md)
- [`05-environment-and-configuration.md`](../agent-memory/05-environment-and-configuration.md)
- [`06-testing-and-validation.md`](../agent-memory/06-testing-and-validation.md)
- [`07-documentation-review.md`](../agent-memory/07-documentation-review.md) — troubleshooting authoring + cross-check.
- [`99-final-orchestrator-report.md`](../agent-memory/99-final-orchestrator-report.md) — the final report.

The **remake** that refreshed these docs to the 20-module reality (the
"tech-docs" orchestration) keeps its notes **namespaced** under
[`../agent-memory/tech-docs/`](../agent-memory/tech-docs/) —
`01-inventory.md`, `98-review.md`, and the final report
[`99-final-report.md`](../agent-memory/tech-docs/99-final-report.md). Per
`AGENTS.md` §4.3, never add flat `0X-*.md` to `docs/agent-memory/` root; always
namespace under `docs/agent-memory/<workstream>/`.

> **Note:** `docs/agent-memory/` also contains files from two *separate,
> concurrent* efforts that re-use the same flat numbering — a "Raise Hand /
> Speaker Queue" feature (`00-orchestrator-plan.md` and the `*-raise-hand*` /
> `*-feature-design*` / `*-current-bot-interaction*` /
> `*-permissions-and-discord-capabilities*` / `*-implementation-plan*` files) and
> a "Music System Extension" (`docs/agent-memory/music/`). Those are **not** part
> of this documentation set; see §1 of the final report for the disambiguation.
