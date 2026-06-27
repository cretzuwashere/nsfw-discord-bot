# Feature 02 — Engagement Prompts (QOTD / WYR / Party Games)

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot + scheduler job). Live slash invocation pending command registration.

> Module key: `engagement-prompts`

## Scop

Rotating conversation prompts from bundled banks — Question of the Day, Would-You-Rather, Truth-or-Dare, Never-Have-I-Ever, Most-Likely-To — on demand and as an optional daily auto-post, with an 'Ask another' button.

## De ce a fost ales

QOTD/WYR are proven daily-activity drivers in large servers; recurring prompts beat one-off novelty. First feature to combine persistence + a daily scheduler + a button, so it doubles as the template for later scheduled features. No external API (bundled banks), no privileged intents.

## User Flow

A member runs `/qotd` (or `/wyr`, `/truthordare`, `/neverhaveiever`, `/mostlikelyto`) → the bot posts a prompt embed with an '🔁 Another' button. Clicking it replaces the embed with a fresh prompt from the same category (cooldown-guarded). Optionally, each day the bot auto-posts a QOTD to a configured channel.

## Moderator/Admin Flow

`/promptconfig channel:#x hour:int enabled:bool` (requires `ManageGuild`) sets the daily QOTD channel, the UTC hour, and on/off. Enable/disable the whole module from `/modules`.

## Commands / Interactions

**Commands**
- `/qotd` — post a Question of the Day.
- `/wyr` — Would You Rather (two options).
- `/truthordare kind:string?` — truth, dare, or random.
- `/neverhaveiever` — a Never-Have-I-Ever prompt.
- `/mostlikelyto` — a 'Most likely to…' prompt.
- `/promptconfig channel hour enabled` — (ManageGuild) configure daily QOTD.

**Interactions**
- `prompt:another:<category>` button → `event.update()` with a new prompt from the same category (avoids repeats via a recent-id ring buffer; per-user cooldown).

## Permissions

`SendMessages`. `/promptconfig` gated by Discord `ManageGuild`.

## Data / Persistence

`prompt_settings` (one row per guild): `guildId` PK, `qotdChannelId`, `qotdEnabled`, `qotdHourUtc`, `lastQotdDate`, plus per-category recent-id ring buffers (jsonb) to avoid repeats. Prompt banks are bundled in-repo (TS data), not in the DB.

## Cooldown / Anti-spam

Per-user cooldown on each command + the 'Another' button (~5s). Recent-id ring buffer prevents repeating the last N prompts per category per guild. Output is fixed-length embeds.

## Edge Cases

- Daily QOTD with no channel configured → daily stays off.
- Configured channel deleted/forbidden → catch, skip, log (don't crash the tick).
- Bank exhausted within the recent window → fall back to full bank.
- `/truthordare` invalid kind → defaults to random.

## Failure Scenarios

- Scheduler post fails (perms/channel) → logged, lastQotdDate NOT advanced only if it's a transient send error; otherwise advance to avoid retry storms (documented).

## Implementation Notes

New package `packages/engagement-prompts-module`. Banks in `banks.ts`. `repo.ts` for `prompt_settings`. `service.ts` picks a non-recent prompt (pure, testable) + builds the embed/button. `commands.ts` builds 6 commands. Daily scheduler job mirrors `birthdays.announce` (5-min tick, UTC hour match, per-day dedup). Event handler for `component.interaction` (customId prefix `prompt:`).

## Testing

Unit: non-repeating selection over the ring buffer; truth/dare kind parsing; daily-due predicate (hour/date). Smoke: commands collected; migration generated.

## Troubleshooting

Daily not posting → check `/promptconfig` channel+hour (UTC) and that the module is enabled. 'Another' not working → ensure the module's `component.interaction` handler is registered.

## Rollback / Disable Strategy

Remove module from wiring + drop the `prompt_settings` table migration, or disable via `/modules`.

## Future Improvements

Submission queue for community-suggested questions (moderated); threads per QOTD; localized banks.

