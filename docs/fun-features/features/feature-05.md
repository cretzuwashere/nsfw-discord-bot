# Feature 05 — Trivia / Quiz

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot + scheduler jobs). Live slash invocation pending command registration.

> Module key: `trivia`

## Scop

Channel trivia rounds with a bundled question bank: a question embed + four answer buttons, first-correct-wins, a wins leaderboard, and optional scheduled auto-trivia.

## De ce a fost ales

Classic, repeatable engagement game. Button answers fit the bot's interaction model; a bundled bank avoids fragile external APIs. Pure answer-checking/scoring logic is highly testable.

## User Flow

A member runs `/trivia` → the bot posts a question with A/B/C/D buttons. Members click an answer; each gets ephemeral 'Correct/Wrong' feedback and may answer only once. The first correct answer wins; when the round resolves (first correct or timeout) the message reveals the answer + winner. `/trivia leaderboard` shows top winners.

## Moderator/Admin Flow

`/triviaconfig channel interval enabled` (ManageGuild) schedules auto-trivia. Enable/disable via `/modules`.

## Commands / Interactions

**Commands**
- `/trivia category:string? difficulty:string?` — start a round in this channel.
- `/trivia-leaderboard` — top trivia winners (button paginated).
- `/triviaconfig channel:channel interval:integer enabled:boolean` — (ManageGuild) auto-trivia.

**Interactions**
- `trivia:ans:<roundId>:<optionIndex>` buttons → record answer (one per user/round, unique), ephemeral feedback; first correct resolves the round and reveals via `event.update()`/edit.

## Permissions

`SendMessages`, `EmbedLinks`. `/triviaconfig` gated by `ManageGuild`.

## Data / Persistence

Bundled question bank in-repo (`bank.ts`: category, difficulty, question, options[4], correctIndex). `trivia_rounds` (id, guildId, channelId, messageId, questionId, correctIndex, status[open|resolved], startedAt, winnerExternalId). `trivia_answers` (roundId FK, userExternalId, correct; unique(roundId,user)). `trivia_scores` (guildId, userExternalId, wins; unique).

## Cooldown / Anti-spam

One open round per channel at a time; one answer per user per round; per-user cooldown on `/trivia` start. Recent-question ring buffer per guild to avoid repeats.

## Edge Cases

- Start while a round is open → 'a round is already running here'.
- No correct answer before timeout → reveal answer, no winner.
- User answers twice → blocked by unique index, ephemeral note.
- Message deleted mid-round → resolve in DB, post result as new message.

## Failure Scenarios

- Reveal edit fails → fall back to a new message; round still marked resolved.

## Implementation Notes

New package `packages/trivia-module`. `bank.ts` (≥40 questions). `logic.ts` (question pick avoiding repeats, answer check, scoring) pure + tested. `repo.ts` rounds/answers/scores. Scheduler resolves timed-out rounds + posts auto-trivia. `component.interaction` handler (prefix `trivia:`).

## Testing

Unit: question selection (no recent repeat), answer correctness, first-correct resolution, score increment. Smoke: commands collected; migration generated.

## Troubleshooting

Buttons do nothing → ensure handler registered and round still open. Repeats → ring buffer size vs bank size.

## Rollback / Disable Strategy

Remove module + drop the three tables, or disable via `/modules`.

## Future Improvements

Categories/difficulty filters, streaks, OpenTDB import behind a feature flag, per-round point payouts via the economy module.

