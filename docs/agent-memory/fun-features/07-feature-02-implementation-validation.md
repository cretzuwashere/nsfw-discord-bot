# 07 — Feature 02 (Engagement Prompts) — Implementation & Validation

> Agent: **AGENT 7 — FEATURE 02** · Date: 2026-06-27 · Module key: `engagement-prompts`

## Checkpoint — Feature 02

Status: PASS

### Funcționalitate implementată
- 5 prompt commands (`/qotd`, `/wyr`, `/neverhaveiever`, `/mostlikelyto`,
  `/truthordare kind?`) that post an embed with a "🔁 Another" button, plus
  `/promptconfig` (ManageGuild) for the daily QOTD. A scheduler job posts the
  daily QOTD to each configured guild at its UTC hour. Bundled SFW banks; recent
  prompts are not repeated (per-category ring buffer); per-user cooldown.

### Modificări făcute
- New package `packages/engagement-prompts-module` (banks, pure logic + tests,
  repo, service, commands, factory with `component.interaction` handler + scheduler job).
- New table `prompt_settings` (migration `0003_public_purifiers.sql`).
- Wiring: `MODULE_KEYS.engagementPrompts`, seed row (disabled), apps/bot dep,
  `main.ts` (module + scheduler job), `register-commands.ts` (commands).

### Fișiere modificate / create
- `packages/engagement-prompts-module/{package.json,tsconfig.json,src/{banks,logic,logic.test,repo,service,commands,index}.ts}`
- `packages/database/src/schema.ts` (+`promptSettings`)
- `packages/database/migrations/0003_public_purifiers.sql` (+ snapshot/journal)
- `packages/shared/src/types.ts`, `packages/database/src/seed.ts`
- `apps/bot/package.json`, `apps/bot/src/main.ts`, `apps/bot/src/register-commands.ts`

### Comenzi rulate (Docker `app`)
- `pnpm install` (link new pkg) · `pnpm db:generate` → `0003_public_purifiers.sql`
  (only `prompt_settings`) · `pnpm db:migrate` → applied.
- `pnpm typecheck` clean · `pnpm lint` clean · `pnpm test:unit` → **415 passed
  (40 files)** incl. `engagement-prompts` (12 tests).
- `docker compose restart bot` → `engagement-prompts module ready`, scheduler job
  `engagement-prompts.daily-qotd` registered, `discord connected`. No errors.

### Validat efectiv
- Pure logic (non-repeating selection ring, daily-due predicate, hour clamp,
  cooldown) + bank integrity unit-tested.
- Migration applies; workspace typechecks + lints; bot boots with module + job.

### Nevalidat
- Live slash invocation / button click / actual daily post in Discord (needs
  command registration + waiting for the configured hour). Logic is unit-tested;
  the scheduler job is registered and runs every 5 min.

### Probleme găsite
- None.

### Feature 03 poate începe?
Da. Persistence + scheduler + component-interaction pattern proven. Feature 03
(Giveaways) adds button entry collection + a scheduled draw.
