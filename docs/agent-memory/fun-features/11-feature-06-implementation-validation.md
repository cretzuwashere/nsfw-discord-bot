# 11 — Feature 06 (Mini-games PvP) — Implementation & Validation

> Agent: **AGENT 11 — FEATURE 06** · Date: 2026-06-27 · Module key: `minigames`

## Checkpoint — Feature 06

Status: PASS

### Funcționalitate implementată
- `/tictactoe @opponent` and `/connect4 @opponent` start a head-to-head game.
  The opponent gets Accept/Decline; play proceeds with button moves, turn
  enforcement, win/draw detection, and stale-game expiry (pending 5 min, idle
  active 15 min) via a scheduler job. Board state persists so games survive a
  restart. Only the two players (and only on their turn) can move.

### Modificări făcute
- New package `packages/minigames-module` (pure `ttt.ts` + `connect4.ts` with
  exhaustive win/draw/move tests; repo; service; commands; factory with
  `component.interaction` handler + scheduler job).
- New table `minigame_sessions` (migration `0007_old_layla_miller.sql`).
- Wiring: `MODULE_KEYS.minigames`, seed row (disabled), apps/bot dep, `main.ts`
  (module + scheduler job), `register-commands.ts` (commands).

### Fișiere modificate / create
- `packages/minigames-module/{package.json,tsconfig.json,src/{ttt,connect4,games.test,repo,service,commands,index}.ts}`
- `packages/database/src/schema.ts` (+`minigameSessions`) · `migrations/0007_old_layla_miller.sql`
- `packages/shared/src/types.ts`, `packages/database/src/seed.ts`
- `apps/bot/package.json`, `apps/bot/src/main.ts`, `apps/bot/src/register-commands.ts`

### Comenzi rulate (Docker `app`)
- `pnpm install` · `pnpm db:generate` → `0007_old_layla_miller.sql` (1 table) ·
  `pnpm db:migrate` → applied.
- `pnpm typecheck` clean · `pnpm lint` clean · `pnpm test:unit` → **455 passed
  (44 files)** incl. `minigames` (12 tests: all ttt lines, c4 horizontal/vertical/
  diagonal, draws, illegal moves, full-column).
- `docker compose restart bot` → `minigames module ready`, job
  `minigames.expire-stale`, `discord connected`.

### Validat efectiv
- Win/draw/move logic for both games unit-tested exhaustively. Turn ownership and
  illegal moves rejected server-side. Migration applies; typecheck + lint clean;
  bot boots.

### Nevalidat
- Live button play in Discord (needs command registration + two players). The
  button-row layout for Tic-Tac-Toe is 5+4 (the adapter chunks buttons by 5); the
  3×3 board is shown in the embed grid.

### Probleme găsite
- None. (No `disabled` button support in the contract → invalid clicks are rejected
  with an ephemeral message instead of disabling cells. Documented.)

### Feature 07 poate începe?
Da. Wave 2 complete. Wave 3 (economy) begins: Feature 07 = currency core, then
Feature 08 (daily/streak) + Feature 09 (shop) extend the same `economy` module.
