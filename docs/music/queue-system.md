# Queue System

How the playback queue works: a bounded FIFO of resolved tracks, one playback
session per guild, and best-effort persistence that is **not** restored after a
restart.

Source: `packages/audio-module/src/engine/queue.ts` (the queue),
`engine/session.ts` (one session per guild), `engine/manager.ts` (one session
per guild map).

See also: [commands.md](commands.md) for the queue commands,
[youtube-playlists.md](youtube-playlists.md) for batch enqueue, and
[online-radio.md](online-radio.md) for radio takeover.

## The queue: a bounded FIFO

`PlaybackQueue` (`queue.ts`) is a pure, in-memory, bounded FIFO of
`ResolvedTrack`s — no I/O. It is constructed with `maxSize = MAX_QUEUE_SIZE`
(default `50`, max `1000`; `index.ts:55`, `config/src/index.ts:45`).

| Method | Behavior |
|---|---|
| `enqueue(track)` | Appends one track; returns `{ ok:false, reason:'full' }` when at `maxSize` (1-based `position` otherwise). |
| `enqueueMany(tracks)` | Appends as many as fit; returns `{ accepted, rejected }`. Used by playlist expansion. |
| `dequeue()` | Removes and returns the front track (FIFO). |
| `peekAll()` | Read-only view of upcoming tracks (used by `/queue` and the queue mirror). |
| `clear()` | Empties the queue; returns how many were removed. |
| `size` | Current length. |

It is **not** reordered, shuffled, or de-duplicated — items play strictly in the
order they were added. Shuffle/loop/move are roadmap items
([future-music-roadmap.md](future-music-roadmap.md)).

## One session per guild

`PlayerManager` (`manager.ts`) holds **one `GuildPlaybackSession` per guild** in
a `Map`. `ensureSession(guildId, voice)` creates or re-binds a session;
`get(guildId)` looks one up; `destroySession(guildId)` tears one down (clears the
queue, stops, disconnects). `PlayerManager` is also the entry point for the
bot's internal admin API (`skip`/`stop`/`clearQueue`/`pause`/`resume`/
`getSnapshots`), which has no command context.

A `GuildPlaybackSession` (`session.ts`) owns the now-playing track + the bounded
queue and the playback bookkeeping (history, elapsed clock, watchdog).

### `nowPlaying` vs. the queue

The currently-playing track is held **separately** in `nowPlaying`; it is **not**
in the queue. `isActive` is simply `nowPlaying !== null`. So `/queue` shows
`nowPlaying` plus up to 10 upcoming queued items.

## Adding and advancing

- **`enqueueOrPlay(track)`** (`session.ts:67-80`) — if nothing is playing, the
  track plays immediately (`status: 'playing'`); otherwise it is appended and
  returns `status: 'queued'` with its 1-based position. A full queue throws
  `UserFacingError('QUEUE_FULL', 'The queue is full (max N).')`. This is the
  single-track path used by `/play`.
- **`enqueueMany(tracks)`** (`session.ts:88-108`) — appends a batch (e.g. a
  playlist), then starts the first track if idle. Returns
  `{ startedPlaying, accepted, rejected }`. This is the playlist path.
- **`skip()`** (`session.ts:111-130`) — ends the current track, dequeues the
  next, and plays it; returns `{ hadTrack, next }`. When the queue is empty it
  stops but stays connected.
- **`stop()`** (`session.ts:133-144`) — ends the current track **and** clears the
  queue; **keeps the voice connection**. Resets the consecutive-failure counter.
- **`clearQueue()`** (`session.ts:147-151`) — clears upcoming tracks only; the
  current track keeps playing. (Exposed via the internal API, not a slash
  command.)
- **`advance()`** (`session.ts:270-284`) — internal: after a track finishes or
  fails, dequeues and plays the next, recursing past failures.

When a track finishes naturally, the voice layer emits a `finished` event and the
session auto-advances (`handleEvent`, `session.ts:235-268`).

## Consecutive-failure cutoff

`MAX_CONSECUTIVE_FAILURES = 3` (`session.ts:17`). The counter:

- **increments** on each playback error or failed start
  (`session.ts:230,257`),
- **resets to 0** only when a track **finishes successfully** (`session.ts:247`)
  — merely *starting* a track does not reset it (`session.ts:222-223`), and
- `stop()` also resets it (`session.ts:142`).

When it reaches 3, the session logs an error, **clears the queue**, and stops
advancing (`session.ts:258-266`, `:271-275`). This prevents a run of dead links
(e.g. a playlist full of broken entries) from churning forever.

## Persistence: history + a queue mirror (display/audit only)

When a `PlaybackRepo` is wired in (it is `null` in tests and in
`register-commands`), the session persists **best-effort** — a database hiccup
must never interrupt audio (every write is `void`/`.catch`ed):

- **History** — `startHistoryEntry` on play, `finishHistoryEntry` with
  `completed`/`skipped`/`failed`/`stopped` on end (`session.ts:206-218,
  318-328`). For display/audit (e.g. the admin panel).
- **Queue mirror** — `persistQueue()` calls `playback.replaceQueue(guildId,
  tracks)` after every queue change (`session.ts:330-336`).

> **Caveat — the queue is NOT restored after a restart.** The mirror is
> write-only from the engine's side: the bot never reads it back on startup.
> After a restart the in-memory queue is empty. Restoring from the mirror is a
> roadmap item — see [future-music-roadmap.md](future-music-roadmap.md).

## How playlists and radio interact with the queue

- **Playlists batch-enqueue.** `/play` (pure playlist link) and `/playlist` both
  call `enqueueMany`, appending the whole expanded list up to `MAX_QUEUE_SIZE`;
  anything that doesn't fit is reported as "didn't fit the queue." See
  [youtube-playlists.md](youtube-playlists.md).
- **Radio takes over.** Starting a station calls `session.stop()` first — which
  clears the queue — and then plays the station as a single LIVE track
  (`radio/commands.ts:64-74`). So picking radio replaces whatever was queued. See
  [online-radio.md](online-radio.md).
