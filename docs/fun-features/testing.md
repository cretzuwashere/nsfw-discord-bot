# Fun Features — Testing

How the fun features are validated. The project has **no Node on the host** — all
commands run in the Docker `app` workbench:

```bash
docker compose exec -T app pnpm typecheck      # all packages
docker compose exec -T app pnpm lint
docker compose exec -T app pnpm test:unit      # vitest unit project
docker compose exec -T app pnpm db:generate    # drizzle-kit: emit migration after schema edits
docker compose exec -T app pnpm db:migrate      # apply migrations
docker compose exec -T app pnpm build           # tsup build of both apps
```

Baseline before this initiative: typecheck clean, lint clean, **332 unit tests
passing**.

## What is automated (unit-tested pure logic)

Each fun module puts its decision logic in pure functions with co-located
`*.test.ts` (vitest), so it runs under `pnpm test:unit` with no Discord/DB needed.
Injected RNG makes random features deterministic in tests.

| Feature | Automated unit tests |
|---|---|
| 01 Random Fun Commands | `fun-commands-module/src/logic.test.ts` — dice parse/clamp, chooser split/cap, rps outcomes, 8-ball/flip, cooldown window |
| 02 Engagement Prompts | `engagement-prompts-module/src/logic.test.ts` — non-repeating selection ring, daily-due predicate, hour clamp, bank integrity, cooldown |
| 03 Giveaways | `giveaways-module/src/logic.test.ts` — drawWinners (no dupes / overflow / determinism), duration parse, winner+duration clamps |
| 04 Server Stats | `server-stats-module/src/logic.test.ts` — accumulator record/drain/clear, UTC window math, recap-due predicate, clamps |
| 05 Trivia | `trivia-module/src/logic.test.ts` — bank integrity, non-repeating question pick, round-expiry + auto-due predicates, interval clamp |
| 06 Mini-games | `minigames-module/src/games.test.ts` — Tic-Tac-Toe all win lines/draw/invalid moves; Connect Four horizontal/vertical/diagonal wins, full-column, drop mechanics |
| 07–09 Economy | `economy-module/src/logic.test.ts` — transfer/amount validation, daily streak (same-day/consecutive/gap/cap/first), purchase validation |
| 10 Levels | `levels-module/src/logic.test.ts` — XP curve monotonicity + level round-trip, progress, award cooldown gate, rollXp bounds |

## What is NOT automated (manual / live)

- **Live Discord behaviour** (real slash invocation, button clicks, role grants)
  needs a valid `DISCORD_TOKEN` + the bot in a guild. Where the token is
  unavailable, these are documented as **NOT VALIDATED (needs live token)**.
- **Slash registration** to Discord (`pnpm discord:register-commands`) needs a
  valid token; locally we verify the command set is *collected* by the
  register-commands entrypoint instead.

## Per-feature test log

<!-- Each feature appends its automated test summary here. -->

### Feature 01 — Random Fun Commands (PASS)
- `pnpm typecheck` clean · `pnpm lint` clean · `pnpm test:unit` 403 passed (39 files).
- Live bot restart loaded `fun-commands module ready`; Discord connected.
- Not validated: live slash invocation (commands not yet registered).
