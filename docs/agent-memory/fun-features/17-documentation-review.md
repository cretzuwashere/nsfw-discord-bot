# 17 — Documentation Review

> Agent: **AGENT 17 — DOCUMENTATION REVIEW** · Date: 2026-06-27
> Reviewed `docs/fun-features/**` against the shipped code as if by a fresh agent.

## What was checked
- Every doc in `docs/fun-features/` and `docs/fun-features/features/`.
- That module keys, table names, commands and customId prefixes in the docs match
  the implemented code (`packages/*-module/src/**`, `schema.ts`, `seed.ts`,
  `main.ts`, `register-commands.ts`).
- That the validation commands in `testing.md` are real and runnable.

## Corrections applied this pass
- **`commands-and-interactions.md` rewritten** from the *shipped* commands (the
  initial version was generated from the design and a few names changed during
  implementation). Notably:
  - Shop admin is `/shopadmin add|remove` (not `/shop add` — `/shop` is the
    members' read-only browse command; admin verbs can't share one command because
    `default_member_permissions` is per top-level command).
  - Levels added `/levelnoxp` (no-XP channel toggle) beyond the designed
    `/levelconfig` + `/levelrewards`.
  - Trivia ships `/trivia` with no category/difficulty options (design listed
    them); kept simple — filters are a roadmap item.
  - Server-stats config option is `day` (0–6) for the recap weekday.

## Known design → implementation deltas (intentional, documented)
| Area | Design said | Shipped | Why |
|---|---|---|---|
| Economy shop admin | `/shop add\|remove` | `/shopadmin add\|remove` | per-command permission gating |
| Trivia start | `/trivia category difficulty` | `/trivia` (random) | scope; filters deferred |
| Economy (F7–9) | 3 migrations | 1 migration `0008` (all economy tables) | one module; cleaner |
| Daily (F8) | separate column migration | columns in `0008` | same module shipped together |
| Buttons | disable used cells | reject invalid clicks ephemerally | adapter has no `disabled` button field |
| TTT layout | 3×3 button grid | 5+4 (adapter chunks buttons by 5) | board shown in the embed grid |

These deltas are recorded in each feature's validation file (06–15) and the feature
spec sheets carry a PASS status note.

## Verified accurate
- `selected-top-10.md`, `permissions.md`, `research-summary.md`, `overview.md`,
  `future-roadmap.md` — consistent with the code (no privileged intents; per-module
  enable/disable via `/modules`; role-grant hierarchy guard).
- `testing.md` validation commands all run as written (`docker compose exec app
  pnpm typecheck|lint|test|build|db:generate|db:migrate`).
- All 8 module keys in docs exist in `MODULE_KEYS` + seed + DB rows (verified:
  `select key from modules ...` returns all 8).
- All 9 migrations (`0000`→`0009`) replay on a clean DB (integration test green).

## Gaps a future agent should know
- The feature spec sheets' "Commands / Interactions" sections describe the
  designed UX; for the authoritative shipped list use `commands-and-interactions.md`.
- Live, in-guild behaviour is documented as **NOT VALIDATED (needs slash
  registration)** consistently — it is the one class of validation not run here.
- No dedicated admin web pages were added for the fun modules; they appear on the
  `/modules` page for enable/disable (per the design), and are configured via their
  ManageGuild slash commands. A richer admin UI is a roadmap item.

## Checkpoint
Status: PASS — documentation is coherent and matches the code; a new agent can
continue from these docs. The only intentional doc/impl deltas are tabulated above.
