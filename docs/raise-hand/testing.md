# Speaker Queue — Testing

The host has no Node — every command runs in the Docker `app` workbench:
`docker compose exec app pnpm <script>` (drop `-T` for an interactive TTY).

## Automated tests (validated 2026-06-27)

| What | Command | Last result |
|---|---|---|
| Unit (logic) | `docker compose exec app pnpm test:unit` | 35 files / **346 tests pass** (14 are raise-hand) |
| Integration (DB) | `docker compose exec app pnpm test:integration` | 7 files / **37 tests pass** |
| Just this module | `docker compose exec app pnpm exec vitest run --project unit packages/raise-hand-module` | 14 pass |
| Lint | `docker compose exec app pnpm lint` | clean for raise-hand files¹ |
| Typecheck (module) | `docker compose exec app pnpm --filter @botplatform/raise-hand-module typecheck` | clean |
| Typecheck (bot) | `docker compose exec app pnpm --filter @botplatform/bot typecheck` | clean |
| Build | `docker compose exec app pnpm build` | both apps build clean |
| Migration | `docker compose exec app pnpm db:migrate` | `migrations applied` |

¹ A whole-repo `pnpm typecheck` currently fails inside `packages/audio-module`
test mocks (`flatPlaylist`) due to an unrelated concurrent change — **not** part of
this feature. Every package the Speaker Queue touches typechecks clean.

The unit tests (`packages/raise-hand-module/src/logic.test.ts`) cover the pure
logic: ordering (`priority DESC, raisedAt ASC`), promote-priority, waiting
position / dedupe, the `rh:<action>:<vc>` customId round-trip, moderator-action
classification, and panel rendering.

## Deploy the commands for manual testing

```bash
# 1. Make sure the module is enabled (it ships default-OFF):
#    Admin panel → Modules → enable "Speaker Queue", OR run the bot with it on.
# 2. Register the slash commands with your guild (instant):
docker compose exec app pnpm discord:register-commands
# 3. Restart the bot so it loads the module:
docker compose restart bot
docker compose logs -f bot   # expect: "raise-hand module ready"
```

## Manual test script (needs a live voice channel + ≥2 members)

This is the part that **cannot** be automated locally — it requires real people
in a Discord voice channel.

**Normal user**
1. Join a voice channel. Run `/raise-hand` → "🙋 Hand raised — you are **#1**".
2. Run `/raise-hand` again → "You already raised your hand — you are **#1**"
   (idempotent, no duplicate).
3. A second member joins the same VC and runs `/raise-hand` → they are **#2**.
4. Run `/speaker-queue` → shows the ordered list.
5. Run `/lower-hand` → "✋ Hand lowered". `/speaker-queue` shows the other member
   now at #1.
6. Leave the voice channel while queued → you are auto-removed (check
   `/speaker-queue` from someone still in the VC, or the panel refresh).
7. From a text channel with **no** VC: `/raise-hand` → "Join a voice channel
   first…".

**Moderator** (needs Mute Members or be the owner)
8. `/speaker-panel` → a panel with 5 buttons appears.
9. `/next-speaker` (or the ⏭️ button) → the #1 waiter becomes the active speaker
   and a "🎤 @user is next to speak" message is posted.
10. `/promote-speaker @member` → that member jumps to the front of the waiting
    list (verify with `/speaker-queue`).
11. `/remove-speaker @member` → that member is removed.
12. `/clear-speaker-queue` (or 🧹) → the queue empties.

**Permissions**
13. As a non-moderator, confirm `/next-speaker` is hidden/blocked by Discord.
14. As a non-moderator, click the ⏭️ Next button → "Only moderators (Mute
    Members) can use that control."

**Persistence**
15. Build a queue, then `docker compose restart bot`. After it reloads, run
    `/speaker-queue` → the queue is unchanged; the panel buttons still work.

**Edge cases**
16. Empty queue + `/next-speaker` → "No one is waiting…".
17. Two different voice channels each keep an independent queue.

## Where to look if something fails

- Bot logs: `docker compose logs bot` (look for `raise-hand module ready` and any
  error around `speaker`/`voice state`).
- Database state:
  `docker compose exec db psql -U botplatform -d botplatform -c "select * from speaker_queue_entries;"`
- See [`troubleshooting.md`](troubleshooting.md).
