# Feature 01 — Random Fun Commands

## Status
PASS — implemented & validated (typecheck, lint, unit tests, live bot boot). Live slash invocation pending command registration (see Testing).

> Module key: `fun-commands`

## Scop

Instant, no-state RNG fun commands: magic 8-ball, dice roller, coin flip, random chooser, and rock-paper-scissors vs the bot. Zero persistence — the de-risking first build that exercises the whole new-module pipeline.

## De ce a fost ales

Highest fit + trivial complexity (research fit 5, no DB, no intents). Quick, low-friction fun used constantly. Built first so the new-module wiring (package → command → main.ts → register-commands → seed → tests) is proven at minimal risk before any migration-bearing feature.

## User Flow

A member runs `/8ball question:...` and gets a random classic answer; `/roll 2d6+3` rolls dice; `/flip` flips a coin; `/choose a, b, c` picks one; `/rps rock` plays a round vs the bot. All replies are immediate and public (8ball/choose can be public; nothing sensitive).

## Moderator/Admin Flow

None — no moderator workflow. The whole module is enable/disable from the admin `/modules` page.

## Commands / Interactions

**Commands**
- `/8ball question:string` — random magic-8-ball answer (question echoed, truncated).
- `/roll notation:string?` — dice notation `NdM(+/-K)`, default `1d6`; clamps N≤100, M 2..1000; shows rolls + total.
- `/flip` — heads or tails.
- `/choose options:string` — pick one from a comma/`|`-separated list (≤20 items).
- `/rps move:string` — rock/paper/scissors vs bot; reports win/lose/draw.

**Interactions**
- None (no buttons/selects).

## Permissions

None beyond default slash usage + `SendMessages`. Not guild-gated (works in DMs too).

## Data / Persistence

None. No tables, no migration.

## Cooldown / Anti-spam

Per-user in-memory cooldown (~3s) keyed by `userId:command` to stop spam. Output caps: question/choose items truncated; dice/choose counts clamped. Pure logic takes an injectable `rng` for deterministic tests.

## Edge Cases

- Empty `/8ball` question → still answers (question optional in effect).
- `/choose` with <2 items → friendly error.
- Invalid dice notation → friendly error with example.
- Oversized dice (e.g. 9999d9999) → clamped, noted in reply.
- `/rps` invalid move → friendly error listing valid moves.

## Failure Scenarios

- No external calls → effectively no failure modes beyond bad input, which is validated and returns a UserFacingError-style message.

## Implementation Notes

New package `packages/fun-commands-module`. Pure functions in `logic.ts` (parseDice, roll, choose, rps, eightball) unit-tested with a seeded rng. `commands.ts` builds the 5 CommandDefinitions; `index.ts` factory returns `{ module }`. Wire into main.ts + register-commands + MODULE_KEYS + seed. No scheduler, no events, no repo.

## Testing

Unit tests for dice parsing/clamping, chooser, rps outcome table, 8-ball answer selection (seeded rng). Smoke: register-commands collects 5 commands.

## Troubleshooting

If a command is missing in Discord, confirm the module is added to `register-commands.ts` and commands were re-registered. Cooldown messages are expected if spammed.

## Rollback / Disable Strategy

Remove the module from `apps/bot/src/main.ts` + `register-commands.ts`, the `MODULE_KEYS` entry, and the seed row. No migration to revert. Or disable via the admin `/modules` page.

## Future Improvements

Add `/8ball` custom answer packs; per-guild cooldown config; `/rps` best-of-N via buttons.

