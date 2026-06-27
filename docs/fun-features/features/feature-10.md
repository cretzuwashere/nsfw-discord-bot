# Feature 10 — Levels — XP & Leaderboards

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot; live message XP active). Live slash invocation pending command registration.

> Module key: `levels`

## Scop

Count-based XP from message activity (no message content read), levels via a curve, optional level-reward roles and level-up announcements, plus `/rank` and a button-paginated XP leaderboard.

## De ce a fost ales

The richest progression feature and a flagship engagement driver (MEE6/Arcane). Count-based XP needs no privileged intent. Built last because it's the largest and benefits from the activity-counting approach proven in Server Stats.

## User Flow

As members chat, they earn XP (per-user cooldown), level up (optional announcement + reward role), check `/rank` for their level/XP/progress/position, and compete on `/levels` (leaderboard).

## Moderator/Admin Flow

`/levelconfig enabled announceChannel xpMin xpMax cooldown` and `/levelrewards add level role` / `remove` / `list` (ManageGuild) configure XP, announcements, no-XP channels, and reward roles.

## Commands / Interactions

**Commands**
- `/rank user:user?` — level, XP, progress to next level, leaderboard position.
- `/levels` — XP leaderboard (button paginated).
- `/levelconfig …` — (ManageGuild) XP settings + no-XP channels + announcements.
- `/levelrewards add level:integer role:role` / `remove level:integer` / `list` — (ManageGuild) reward roles.

**Interactions**
- `lvl:lb:<page>` buttons for leaderboard pagination.

## Permissions

`SendMessages`; `ManageRoles` (only if level-reward roles are enabled). `/levelconfig` + `/levelrewards` gated by `ManageGuild`.

## Data / Persistence

`level_members` (id, guildId, userExternalId, xp bigint, level int, messages int, lastAwardAt; unique(guildId,user); index(guildId,xp)). `level_rewards` (id, guildId, level, roleId; unique(guildId,level)). `level_settings` (guildId PK, enabled, announceChannelId, levelUpMessage, noXpChannelIds[jsonb], xpMin, xpMax, cooldownSeconds).

## Cooldown / Anti-spam

Per-user XP cooldown (default 60s) via `lastAwardAt`; randomized xpMin..xpMax per award; no-XP channel denylist; bots excluded; output caps. This is the anti-farm core.

## Edge Cases

- Cooldown not elapsed → no XP (silent).
- Channel in no-XP list → skip.
- Reward role above bot in hierarchy → skip + log (no crash).
- Multiple level-ups in one award → grant all reward roles up to the new level.
- XP only ever increases (no decay/level-down) unless an admin resets.

## Failure Scenarios

- Reward-role grant failure is non-fatal (logged); XP/level still recorded.

## Implementation Notes

New package `packages/levels-module`. `curve.ts` (`xpForLevel`, `levelForXp`) + `award.ts` (cooldown/denylist decision) pure + tested. `repo.ts` members/rewards/settings. `message.create` handler awards XP. Leaderboard pagination handler (prefix `lvl:`).

## Testing

Unit: curve monotonicity + round-trip, award decision (cooldown/denylist/bot), multi-level-up reward set, leaderboard ranking. Smoke: handler wired; migration generated.

## Troubleshooting

No XP gained → cooldown, no-XP channel, or module disabled. Reward role not granted → hierarchy (move bot role up). Leaderboard empty → no XP yet.

## Rollback / Disable Strategy

Remove module + drop the three tables, or disable via `/modules`.

## Future Improvements

Profile cards (resvg) for `/rank`, weekly/monthly XP windows, voice XP once voice-state events exist, XP boosters/multipliers, achievements layered on top.

