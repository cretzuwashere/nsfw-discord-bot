# Feature 07 — Economy — Currency Core

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot). Live slash invocation pending command registration.

> Module key: `economy`

## Scop

A per-server virtual currency (no real money): balances, member-to-member transfers, a richest-members leaderboard, and admin grant/remove. The ledger that Daily (8) and Shop (9) build on.

## De ce a fost ales

Currency is the foundation of the most engaging economy loops (daily, shop, future games). Built and validated alone first so its dependents are safe. No external deps, no privileged intents.

## User Flow

A member runs `/balance` to see their coins, `/give @member 50` to transfer (validated), and `/baltop` to see the richest members.

## Moderator/Admin Flow

`/economy grant user amount` and `/economy take user amount` (ManageGuild) adjust balances; `/economy config currencyName emoji startingBalance` (ManageGuild) sets cosmetics.

## Commands / Interactions

**Commands**
- `/balance user:user?` — show a balance.
- `/give user:user amount:integer` — transfer coins to another member.
- `/baltop` — richest-members leaderboard (button paginated).
- `/economy grant user amount` / `/economy take user amount` — (ManageGuild) adjust balances.
- `/economy config name emoji starting` — (ManageGuild) currency cosmetics + starting balance.

**Interactions**
- `eco:baltop:<page>` buttons for leaderboard pagination.

## Permissions

`SendMessages`. Admin subcommands gated by `ManageGuild`.

## Data / Persistence

`economy_accounts` (id, guildId, userExternalId, balance bigint, lastDailyDate, streak [added in F8]; unique(guildId,user); index(guildId,balance)). `economy_transactions` (id, guildId, userExternalId, delta bigint, reason, createdAt) — audit trail. `economy_settings` (guildId PK, currencyName, currencyEmoji, startingBalance).

## Cooldown / Anti-spam

`/give`: positive integer only, sender ≠ recipient, recipient not a bot, sufficient balance, per-transfer cap + per-user cooldown to throttle laundering. All balance changes recorded in `economy_transactions` for traceability.

## Edge Cases

- Account auto-created at starting balance on first touch.
- Give more than you have → friendly error.
- Give to self/bot → rejected.
- Negative/zero amount → rejected.

## Failure Scenarios

- Transfer is a single transactional update (debit+credit+two ledger rows) so a partial failure cannot create/destroy currency.

## Implementation Notes

New package `packages/economy-module`. `logic.ts` (transfer validation, daily computation [F8], purchase validation [F9]) pure + tested. `repo.ts` accounts/transactions/settings with a transactional `transfer()`. Built in three checkpoints (core → daily → shop).

## Testing

Unit: transfer validation + conservation (sum unchanged), starting-balance creation, leaderboard ordering. Smoke: commands collected; migration generated.

## Troubleshooting

Balances reset? They are per-guild; check guildId resolution. Negative balances should be impossible (guarded).

## Rollback / Disable Strategy

Remove the Daily/Shop commands first, then the module + drop economy tables. Disable via `/modules`.

## Future Improvements

Work/beg/rob mini-jobs (with strong anti-abuse), interest, leaderboards by net worth.

