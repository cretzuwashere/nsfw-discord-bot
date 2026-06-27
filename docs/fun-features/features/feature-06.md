# Feature 06 — Mini-games (PvP: Tic-Tac-Toe, Connect Four)

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot + scheduler job). Live slash invocation pending command registration.

> Module key: `minigames`

## Scop

Head-to-head button-board games — Tic-Tac-Toe (3×3) and Connect Four (7 columns) — with challenge/accept, turn enforcement, win/draw detection, and stale-game expiry.

## De ce a fost ales

Interactive PvP fun with deeply unit-testable pure win-detection logic; fits the button model (≤25 buttons per message). No external deps; minimal persistence so games survive restarts.

## User Flow

A member runs `/tictactoe @opponent` (or `/connect4 @opponent`) → the opponent sees Accept/Decline. On accept, the board appears as buttons; players alternate turns by clicking; the bot enforces turns, detects wins/draws, and ends the game with a result.

## Moderator/Admin Flow

None beyond enable/disable via `/modules`.

## Commands / Interactions

**Commands**
- `/tictactoe opponent:user` — challenge to Tic-Tac-Toe.
- `/connect4 opponent:user` — challenge to Connect Four.

**Interactions**
- `mg:accept:<gameId>` / `mg:decline:<gameId>` — opponent accepts/declines.
- `mg:ttt:<gameId>:<cell>` — place a mark (Tic-Tac-Toe).
- `mg:c4:<gameId>:<col>` — drop a disc (Connect Four).

## Permissions

`SendMessages`. No special permissions.

## Data / Persistence

`minigame_sessions` (id, guildId, channelId, messageId, game[ttt|c4], playerX, playerO, board[jsonb], turn, status[pending|active|finished|expired], winner, createdAt, updatedAt). Persisted so an in-flight game survives a restart.

## Cooldown / Anti-spam

Only the two players can interact (and only on their turn) — enforced server-side. Self-challenge and bot-challenge rejected. Cap concurrent games per user. Stale games expire.

## Edge Cases

- Non-player clicks → ephemeral 'this isn't your game'.
- Out-of-turn click → ephemeral 'not your turn'.
- Occupied cell / full column → ignored with ephemeral note.
- Draw (board full, no winner) → declared draw.
- Challenge not accepted in 5 min → auto-expire; idle active game > 15 min → expire.
- Opponent is a bot or self → rejected at command time.

## Failure Scenarios

- Board edit fails → game state still authoritative in DB; next valid click re-renders.

## Implementation Notes

New package `packages/minigames-module`. `ttt.ts` + `connect4.ts` pure logic (applyMove, checkWinner, isDraw, render) — extensively tested. `repo.ts` sessions. Scheduler expires stale games. `component.interaction` handler (prefix `mg:`).

## Testing

Unit: all win lines for ttt (rows/cols/diagonals), c4 (horizontal/vertical/both diagonals), draw detection, illegal moves, turn switching. Smoke: commands collected; migration generated.

## Troubleshooting

Buttons inert → game finished/expired or wrong player. Board not updating → check session row + handler.

## Rollback / Disable Strategy

Remove module + drop the table, or disable via `/modules`.

## Future Improvements

Vs-bot AI, Connect Four win highlight, best-of-N, rematch button, optional point wagers via economy.

