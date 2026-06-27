# 00 — Orchestrator Plan (Documentation Pass) — ARCHIVE

> Agent: **AGENT 0 — ORCHESTRATOR / PLANNING** (read-only documentation pass)
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to root)
> Workstream: full technical analysis + documentation of the `botplatform`
> Docker-first modular Discord bot platform, so any future agent can take over
> without extra context.
>
> **Why this file is named `*.docpass-archive.md`:** the canonical
> `00-orchestrator-plan.md` was later claimed by a *separate, concurrent*
> "Raise Hand / Speaker Queue" feature orchestration that re-used the same flat
> `docs/agent-memory/` numbering and overwrote the doc-pass plan. To avoid
> deleting that other orchestration's work, the documentation-pass plan lives
> here instead. See `99-final-orchestrator-report.md` §1 for the full
> disambiguation of the three overlapping workstreams.

## Agent purpose

Inspect the project, lock the toolchain/run model, and define the 10-agent plan
(Agents 0–9) with execution order, deliverables, validation criteria and
dependencies, so the rest of the documentation pass executes deterministically.

## Project identification (verified)

- **Language / runtime:** TypeScript, Node 24 LTS, **ESM** (`"type":"module"`,
  `moduleResolution: Bundler`, `.js`-suffixed relative imports). `engines.node >= 22.12`.
- **Frameworks:** discord.js `^14.26` + `@discordjs/voice` (bot worker);
  **Fastify `^5.8`** SSR (EJS) admin panel.
- **Package manager:** **pnpm 10.34.3** workspaces (`node-linker=hoisted`,
  central catalog in `pnpm-workspace.yaml`), npm scope `@botplatform`.
- **Run system:** **Docker Compose**. The Windows host has **no Node** — every
  `pnpm` command runs inside the `app` toolbox container.
- **Persistence:** PostgreSQL 18 + Drizzle ORM 0.45 (migrations in
  `packages/database/migrations`).
- **Tests:** Vitest 4 (unit + integration projects) + Playwright 1.60 (e2e).
- **Shape:** 18 workspace packages + 2 apps (`apps/bot`, `apps/admin`) + `tests/e2e`;
  11 Discord modules; ~32 DB tables; 174 TS source files; 49 test files.

## Infra files confirmed present

`Dockerfile` (prod, multi-stage; targets `builder`, `proddeps`, `runtime-base`,
`bot`, `admin`), `Dockerfile.dev`, `docker-compose.yml`, `docker-compose.prod.yml`,
`Makefile`, `.dockerignore`, `scripts/` (`dev-entry.sh`, `clean-validate.sh`,
`check-admin-pages.sh`, `check-audio-stack.ts`), `.github/workflows/ci.yml`,
`vitest.config.ts`, `eslint.config.js`, `tsconfig.base.json`, `.env.example`,
`pnpm-workspace.yaml`.

## Output locations (fixed by the brief)

- Agent memory → `docs/agent-memory/` (this dir).
- Final technical docs → `docs/technical/`.

## The agent plan (0–9)

| # | Agent | Deliverable(s) | Depends on | Validation criterion |
|---|---|---|---|---|
| 0 | Orchestrator / plan | this plan (`00-orchestrator-plan.md`, archived here) | — | Plan is executable; infra files confirmed |
| 1 | Project inventory | `01-project-inventory.md` | 0 | Later agents can locate any file without re-scanning |
| 2 | Runtime & Docker | `02-runtime-and-docker-analysis.md`, `technical/runtime-and-docker.md` | 1 + validation | A new agent can boot the stack with zero guessing |
| 3 | Architecture | `03-architecture-analysis.md`, `technical/architecture.md` | 1 | Clear "where to add a feature" guidance |
| 4 | Discord bot domain | `04-discord-bot-analysis.md`, `technical/discord-bot-flows.md`, `technical/commands-and-events.md` | 1 | Every command/event/intent/permission documented & verified |
| 5 | Environment & config | `05-environment-and-configuration.md`, `technical/environment.md` | 1 | A working `.env` can be built without reading code |
| 6 | Testing & validation | `06-testing-and-validation.md`, `technical/testing.md` | 1,2 + validation | Validated/deduced/unvalidated split is explicit |
| 7 | Troubleshooting | `technical/troubleshooting.md`, `07-documentation-review.md` (Part A) | 2,4,5 | Practical, project-specific, not generic |
| 8 | Documentation review | fixes across `technical/*`, `07-documentation-review.md` (Part B) | 2–7 | Docs consistent; paths/commands/env verified vs source |
| 9 | Final report | `99-final-orchestrator-report.md`, `technical/agent-handoff.md`, `technical/README.md` | all | Single entry point for any future agent |

## Execution model actually used

- **Read-only analysis** (Agents 0,1,3,4,5) ran in parallel via an ultracode
  Workflow (`wf_7a8c06aa-943`) while Docker booted.
- **Real validation** (the safe-commands requirement of Agents 2 & 6) was
  performed by the **main orchestrator process** in "full validation" mode: a
  clean-room run mirroring `scripts/clean-validate.sh` + CI, with every gate's
  exit code / duration / output captured. Agents 2, 6 and 9 consume those REAL
  results (no fabricated "validated" claims).
- **Validation-informed + finalize** (Agents 2,6,7,8,9) ran in a second Workflow
  (`wf_99cd4820-dbf`) as a 4-phase pipeline.

## Quality rules enforced for every agent

English docs; no invented behaviour; "verified in code" vs "deduced" vs
"documented-elsewhere-unverified" always distinguished; never expose secrets (use
`<DISCORD_BOT_TOKEN>` / `<DISCORD_CLIENT_ID>` / `<DISCORD_GUILD_ID>`); every
command in a fenced code block; every important file referenced by repo-root
relative path; each memory file ends with the PASS/PARTIAL/FAIL Checkpoint block.

## Checkpoint

Status: PASS

### Validat
- Project identity, toolchain, run model, and the presence of all infra files
  confirmed on disk.
- 10-agent plan defined with order, deliverables, dependencies, and validation
  criteria; both Workflows executed to completion (all 10 agents PASS).

### Nevalidat
- This plan agent ran no build/test commands; real validation was the main
  orchestrator's 2026-06-27 clean-room run (see `99-final-orchestrator-report.md` §3).

### Probleme
- The canonical `00-orchestrator-plan.md` filename was overwritten by a separate
  concurrent "Raise Hand" feature orchestration; this doc-pass plan was relocated
  here to avoid deleting that work (lossless coexistence).

### Următorul agent poate continua?
Da. The plan executed fully; enter the documentation via
`docs/technical/agent-handoff.md`.
