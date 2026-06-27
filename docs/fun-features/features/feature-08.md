# Feature 08 — Economy — Daily / Streak

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot). Live slash invocation pending command registration. Daily columns shipped in migration `0008` (no separate migration needed).

> Module key: `economy`

## Scop

A once-per-day `/daily` claim that pays currency and tracks a consecutive-day streak with a (capped) streak bonus. Extends the economy module.

## De ce a fost ales

The cheapest, stickiest recurring economy hook — a daily reason to return. Depends only on the currency ledger from Feature 7.

## User Flow

A member runs `/daily` once per UTC day to claim coins; claiming on consecutive days grows a streak (bigger bonus, capped); missing a day resets the streak.

## Moderator/Admin Flow

`/economy config` (F7) can set the base daily amount + streak bonus + cap (ManageGuild).

## Commands / Interactions

**Commands**
- `/daily` — claim the daily reward (shows amount, streak, time until next).

**Interactions**
- None.

## Permissions

`SendMessages`.

## Data / Persistence

Adds `lastDailyDate` (date) and `streak` (int) columns to `economy_accounts` (migration on top of F7). Daily config values live in `economy_settings`.

## Cooldown / Anti-spam

One claim per UTC day (enforced by `lastDailyDate`). `computeDaily(now, lastClaimDate, streak, config)` is a pure function returning `{canClaim, amount, newStreak}`.

## Edge Cases

- Already claimed today → 'come back in Xh'.
- Claimed yesterday → streak +1; gap >1 day → streak resets to 1.
- Streak bonus capped to avoid runaway payouts.
- First-ever claim → streak 1.

## Failure Scenarios

- Claim is a single transactional update (credit + set lastDailyDate/streak + ledger row).

## Implementation Notes

Extends `economy-module`: add `computeDaily` to `logic.ts` (tested), a `claimDaily()` repo method, and the `/daily` command. New migration adds the two columns.

## Testing

Unit: computeDaily across same-day / consecutive / gap / cap / first-claim cases. Smoke: `/daily` collected; migration applies.

## Troubleshooting

`/daily` says already claimed right after midnight → it's UTC-based (documented).

## Rollback / Disable Strategy

Remove the `/daily` command; the two columns can stay (nullable/defaulted) or be dropped via a down migration. Disable via `/modules`.

## Future Improvements

Configurable reset timezone per guild, weekend bonuses, milestone rewards at streak thresholds.

