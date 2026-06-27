# Feature 03 — Giveaways

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot + scheduler job). Live slash invocation pending command registration.

> Module key: `giveaways`

## Scop

Run giveaways with a one-tap 'Enter' button and an automatic scheduled draw, plus end-early, reroll, list and cancel.

## De ce a fost ales

High-impact community event with a clear 'winnable moment'. Self-contained, exercises button entry collection + a scheduled draw + anti-multi-entry guards. Button-only (no reactions), no external deps.

## User Flow

A member clicks '🎉 Enter' on a giveaway message and gets an ephemeral confirmation (idempotent — entering twice just says 'already entered'). When the timer ends, the bot draws winners, edits the message to show them, and announces them in-channel.

## Moderator/Admin Flow

`/giveaway start prize duration winners? channel?` (ManageGuild) posts the giveaway; `/giveaway end id`, `/giveaway reroll id`, `/giveaway cancel id` manage it; `/giveaway list` shows active ones.

## Commands / Interactions

**Commands**
- `/giveaway start prize:string duration:string winners:integer? channel:channel?` — (ManageGuild) start a giveaway.
- `/giveaway end id:string` — (ManageGuild) end early and draw now.
- `/giveaway reroll id:string` — (ManageGuild) draw new winners.
- `/giveaway cancel id:string` — (ManageGuild) cancel without drawing.
- `/giveaway list` — list active giveaways.

**Interactions**
- `giveaway:enter:<id>` button → record one entry per user (unique index), ephemeral confirm.

## Permissions

`SendMessages`, `EmbedLinks`. Admin subcommands gated by `ManageGuild`.

## Data / Persistence

`giveaways` (id, guildId, channelId, messageId, prize, winnersCount, hostExternalId, endsAt, status[active|ended|canceled], createdAt). `giveaway_entries` (id, giveawayId FK, userExternalId, createdAt; unique(giveawayId,userExternalId)).

## Cooldown / Anti-spam

One entry per user (DB unique). Winners clamped 1..20. Duration parsed + clamped (min 10s, max 30d). Entry button has a light per-user cooldown to avoid double-tap races.

## Edge Cases

- Fewer entrants than winners → all entrants win.
- Zero entrants at draw → announce 'no valid entrants', mark ended.
- Giveaway message deleted → post results as a new message.
- Reroll on a non-ended giveaway → friendly error.
- End/cancel an already-ended giveaway → friendly error.

## Failure Scenarios

- Draw send fails → retry next scheduler tick (status stays active with a short backoff) until delivered, then mark ended.

## Implementation Notes

New package `packages/giveaways-module`. `drawWinners(entries, count, rng)` pure + tested. Small local `parseDuration`. `repo.ts` for both tables. Scheduler tick (30s) draws due giveaways. `component.interaction` handler (prefix `giveaway:`).

## Testing

Unit: drawWinners (no dupes, count > entries, deterministic via rng); duration parse/clamp; winners clamp. Smoke: commands collected; migration generated.

## Troubleshooting

Entries not recording → check unique index + that the handler is registered. Draw not firing → confirm the scheduler job is registered in main.ts and endsAt is in the past.

## Rollback / Disable Strategy

Remove module from wiring + drop the two tables, or disable via `/modules`.

## Future Improvements

Entry requirements (must have role / min level), multiple prizes, DM the winners.

