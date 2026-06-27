# Speaker Queue — Troubleshooting

Common problems and fixes. Commands run in Docker (`docker compose exec app …`).

## The slash commands don't appear in Discord
- **Not registered.** Run `docker compose exec app pnpm discord:register-commands`.
  Guild-scoped registration (when `DISCORD_GUILD_ID` is set) is instant; global
  registration can take up to an hour.
- **Module disabled.** The Speaker Queue ships **default-OFF**. Enable it (Admin
  panel → Modules → "Speaker Queue"). A disabled module's commands are rejected by
  the dispatcher.
- **Bot not restarted** after install/changes: `docker compose restart bot` and
  watch for `raise-hand module ready` in the logs.

## The moderator commands are missing for a moderator
- They are gated by Discord **Mute Members**. The member must have that permission
  (or be the guild owner). Grant Mute Members to the moderator role, or override
  command permissions in **Server Settings → Integrations → your bot**.

## A non-moderator could click the Next/Clear panel buttons
- Discord cannot hide buttons by permission. The bot **re-checks** server-side and
  replies "Only moderators (Mute Members) can use that control." If a real
  moderator gets that message, confirm they actually hold Mute Members — the check
  uses the live Discord permission, not a role name.

## "Join a voice channel first" even though I'm in one
- The command reads your **current** voice state. If you just joined, retry after
  a second. Ensure the bot has the **View Channel** permission on that voice
  channel (it must be able to see your voice state).

## The panel doesn't update / "I could not post the panel"
- The bot needs **View Channel, Send Messages, Embed Links, Read Message History**
  in the panel's text channel. Check the channel permission overwrites for the bot.
- If the original panel message was deleted, run `/speaker-panel` again to post a
  fresh one (the old reference is replaced).

## Someone left the voice channel but is still in the queue
- Auto-removal fires on the `voice.state.update` event. It needs the
  **GuildVoiceStates** intent — which the bot enables by default, so this normally
  just works. If it doesn't:
  - Confirm the bot can see the voice channel (View Channel).
  - As a moderator, run `/remove-speaker @member` to remove them manually.
- Note: someone who joined the queue via the **panel Raise button without being in
  the VC** never triggers a leave event (they were never in the channel). Remove
  them with `/remove-speaker`. (See the known limitation in
  [`commands-and-interactions.md`](commands-and-interactions.md).)

## Duplicates in the queue
- Should be impossible: a partial unique index
  (`speaker_queue_entries_active_user_idx ... WHERE status <> 'done'`) guarantees
  one live entry per user per queue, and `/raise-hand` is idempotent. If you
  suspect a problem, inspect:
  ```bash
  docker compose exec db psql -U botplatform -d botplatform \
    -c "select user_external_id, status, count(*) from speaker_queue_entries group by 1,2 having count(*)>1;"
  ```

## The queue vanished after a restart
- It should persist (Postgres). If it's gone, the migration may not have run:
  `docker compose exec app pnpm db:migrate`, then confirm the tables exist:
  ```bash
  docker compose exec db psql -U botplatform -d botplatform -c "\dt speaker_queue*"
  ```

## `pnpm typecheck` fails in `packages/audio-module`
- That failure (`flatPlaylist` on `YtDlpRunner`) is **unrelated** to the Speaker
  Queue — it comes from a separate, concurrent change to the audio module. To
  typecheck just this feature:
  `docker compose exec app pnpm --filter @botplatform/raise-hand-module typecheck`.

## Bot won't start after adding the module
- A new workspace package needs linking: `docker compose exec app pnpm install`,
  then `docker compose restart bot`.
- Check logs for the failing import: `docker compose logs bot --tail 50`.
