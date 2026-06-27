# Looping & the auto-reposted now-playing panel

Two related playback features: **looping** (repeat a track or the whole queue,
a set number of times or forever) and the **auto-reposted now-playing panel**
(the `/controls` panel re-appears on every track change).

## Looping — `/loop`

`/loop` is a subcommand group (discoverable in the Discord UI):

| Command | Effect |
|---|---|
| `/loop track [times]` | Repeat the **current track**. `times` = number of repeats; omit for **forever**. |
| `/loop queue [times]` | Repeat the **whole queue** (as it is now). `times` = number of full passes; omit for **forever**. |
| `/loop off` | Stop looping. |

- `times` is an optional integer. **Omitted = infinite** (until `/loop off`,
  `/stop`, or the bot leaves).
- The active loop is shown on the now-playing panel as a **🔁 Loop** field
  (e.g. `🔁 Queue · forever` or `🔁 Track · 3 left`).

### How it works (implementation)

State lives on the per-guild `GuildPlaybackSession` (`engine/session.ts`):

- **Track loop** — when the current track finishes naturally, it is replayed
  (its stream is re-opened). A finite count decrements each replay; at 0 the loop
  resets to off and playback advances to the next queued track. `/skip` overrides
  a track loop (it moves to the next track).
- **Queue loop** — when `/loop queue` is enabled, the current track list
  (now-playing + queue) is captured as the **loop set**. The queue drains
  normally; when it empties, the loop set is re-queued for the next pass and the
  pass counter decrements. At 0 passes it stops. `times = N` ⇒ the queue plays
  `N` extra times after the current pass.

### Notes & limits

- **Tracks added after** enabling `/loop queue` play in the current pass but are
  **not** part of the captured loop set, so they don't repeat on later passes.
  Re-run `/loop queue` to re-capture the queue.
- `/stop` and leaving the channel reset looping. Clearing the queue
  (`/stop`, mix `Clear queue`) turns a queue loop off (nothing left to repeat).
- Radio/live tracks never "finish", so a track loop on radio simply never
  triggers.

## Auto-reposted now-playing panel

Every time a **new track starts** (the queue advances, you `/skip`, or a loop
replays), the bot **re-posts the now-playing panel** to the text channel where
playback was started — so the latest message always shows the **current track,
its progress, and the remaining queue** (plus the control buttons).

- The **previous** auto-posted panel is **deleted** first, so there is a single,
  always-current panel at the bottom of the channel (no spam). Reposts are
  **serialized per guild**, so rapid track changes can't leave orphaned panels.
- The **initial** `/play` shows the panel as its command reply and does not
  auto-repost for that first track. (That first reply is an interaction reply,
  not tracked, so it may linger for one cycle until the next track's auto-panel
  appears — a minor cosmetic artifact.)
- A **track loop** does **not** re-post on every repeat (the song is unchanged).
- On **`/stop`** the panel is refreshed to the idle state; on **`/leave`** it is
  deleted.
- Wiring: the bot passes its `GuildServiceProvider` (the Discord adapter) into
  the audio module (`createAudioModule({ …, guildServiceProvider })`), which the
  `PlayerManager` uses to send/delete messages. The session remembers the text
  channel from the play command (`setTextChannel`).

### Requirements & notes

- The bot needs **Send Messages** (and Manage Messages to delete the previous
  panel) permission in the channel. If it can't post, playback continues; only
  the panel is skipped (failures are logged, never fatal).
- Clicking a button on an already-replaced (deleted) panel does nothing — use the
  newest panel, `/controls`, or `/nowplaying`.

See also [commands.md](commands.md), [queue-system.md](queue-system.md).
