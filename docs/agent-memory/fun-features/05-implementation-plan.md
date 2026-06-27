# 05 — Implementation Plan

> Agent: **AGENT 5 — IMPLEMENTATION PLAN** · Date: 2026-06-27
> Incremental, one-feature-at-a-time plan with per-step validation gates and
> rollback. Implementation runs **inline & sequential** (shared wiring files can't
> be parallel-edited). Source of truth for build order + sub-steps.

## Waves & order (locked)

- **Wave 1 — Quick wins:** 1 Random Fun Commands · 2 Engagement Prompts · 3 Giveaways · 4 Server Stats
- **Wave 2 — Games:** 5 Trivia · 6 Mini-games
- **Wave 3 — Economy (currency-core-first):** 7 Economy core · 8 Daily/Streak · 9 Shop
- **Wave 4 — Progression:** 10 Levels (XP + leaderboards)

Dependencies: 8 and 9 require 7 (same `economy` module). 10 is standalone but
benefits from the activity-counting approach proven in 4. Everything else is
independent.

## Per-feature sub-steps (the same checklist each time)

For each feature, in this order:

1. **Package scaffold** — `packages/<key>-module/{package.json, tsconfig.json, src/index.ts}`.
2. **Schema + migration** (if persistent) — add tables/columns to
   `packages/database/src/schema.ts`; `pnpm db:generate`; review the emitted SQL.
3. **Repo** — `src/repo.ts` (Drizzle, mirror `reminders-module/src/repo.ts`).
4. **Pure logic** — `src/logic.ts` / `bank.ts` / `curve.ts` etc. + co-located `*.test.ts`.
5. **Service** (if needed) — `src/service.ts` (sends messages, manages roles via GuildService).
6. **Commands** — `src/commands.ts` (`CommandDefinition[]`).
7. **Interactions** — `module.events` `component.interaction` handler (if any).
8. **Scheduler** — `schedulerJob` on the handle (if any).
9. **Wiring** — `MODULE_KEYS` (shared) · `seed.ts` row · `apps/bot/src/main.ts`
   (instantiate + add module + register scheduler job) · `register-commands.ts`
   (if it owns slash commands).
10. **Validate** — `typecheck`, `lint`, `db:migrate`, `test:unit` (new + all prior),
    and periodically `build`. Confirm bot container still healthy.
11. **Docs** — flip `feature-XX.md` Status, fill Implementation Notes/Testing/
    Troubleshooting; append to `testing.md` + `troubleshooting.md`; write
    `docs/agent-memory/fun-features/<NN>-feature-XX-implementation-validation.md`
    with the mandatory checkpoint block.

### Files touched per feature (shared wiring — edited additively, one at a time)
`packages/database/src/schema.ts`, `packages/shared/src/types.ts`,
`packages/database/src/seed.ts`, `apps/bot/src/main.ts`,
`apps/bot/src/register-commands.ts` (slash-owning modules only),
plus the new `packages/<key>-module/*`. Admin: modules appear on `/modules`
automatically via their seed row (a dedicated admin route is optional and deferred
unless a feature clearly needs richer config UI).

## Validation gate (PASS / PARTIAL / FAIL) per feature

- **PASS:** typecheck + lint clean, migration applies, new unit tests + all prior
  green, commands collected by register-commands, bot container healthy.
- **PARTIAL:** code + unit tests green but something can't be validated locally
  (e.g. live Discord slash invocation needs a valid token) — documented explicitly.
- **FAIL:** a gate fails and isn't fixed within the step → stop the feature,
  document the blocker, mark `BLOCKED`, continue with the next independent feature.

## Stop rule (per the brief)

If a feature becomes too risky/blocked mid-build, **do not block the pipeline**:
record the blocker in its validation file, mark it `BLOCKED`/`PARTIAL`, and proceed
to the next independent feature. If a TOP-10 slot is abandoned, the next-best
deferred candidate (see `future-roadmap.md`) may be promoted.

## Rollback strategy (per feature)

Each feature is removable by (a) disabling it on the admin `/modules` page
(runtime off-switch), or (b) reverting its wiring edits (main.ts, register-commands,
MODULE_KEYS, seed) + dropping its tables via a down migration. Because each feature
is its own module + its own tables/migration, removing one does not affect the
others. The economy trio shares a module, so roll back shop → daily → core in
reverse dependency order.

## Risk register

| Risk | Mitigation |
|---|---|
| Per-message DB writes (Stats/Levels) on a large server | In-memory accumulator + batched upserts (Stats); per-user DB cooldown gate (Levels). |
| Role-hierarchy failures (Shop/Levels rewards) | `canManageRole` guard, fail-safe, clear admin message. |
| Migration ordering (economy 3 steps) | Generate + apply migrations in feature order; never hand-edit applied SQL. |
| Shared-file merge mistakes | Sequential edits, typecheck after each wiring change. |
| No live Discord token | Validate via build/test/lint/migrate; document live-only steps as PARTIAL. |

## Checkpoint

Status: PASS

### Validat
- Build order, per-feature sub-steps, shared-file touch list, validation gate,
  stop rule, rollback, and risk register defined and consistent with the verified
  codebase + design (04).
### Nevalidat
- No feature code yet (next agents implement).
### Probleme
- None blocking; economy migration ordering is the main discipline item.
### Următorul agent poate continua?
Da. Begin Feature 01 (Random Fun Commands) — the zero-persistence pipeline de-risker.
