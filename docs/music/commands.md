# Music Commands & Controls — Reference

All audio-player slash commands and the now-playing panel buttons. Behavior is
taken directly from `packages/audio-module/src/commands.ts` (core handlers),
`radio/commands.ts` (the `/radio` group) and `now-playing.ts` (buttons). Every
command is **guild-only** (`guildOnly: true`) — it only works inside a server.

The registered commands are: `join`, `leave`, `play`, `playlist`, `queue`,
`skip`, `pause`, `resume`, `stop`, `nowplaying`, `controls`, and `radio` (with
`list` / `play` / `stop` / `nowplaying` subcommands). They are auto-registered
with Discord via `apps/bot/src/register-commands.ts`
(`docker compose exec app pnpm discord:register-commands`).

Related docs: [youtube-playlists.md](youtube-playlists.md),
[online-radio.md](online-radio.md), [long-track-playback.md](long-track-playback.md),
[queue-system.md](queue-system.md), [troubleshooting-music.md](troubleshooting-music.md).

Common preconditions:
- **Voice unavailable** — if the adapter exposes no voice support, commands
  that need it throw `UserFacingError('VOICE_UNAVAILABLE')` ("Voice is not
  available here.") via `requireVoice` (`commands.ts:21-26`).
- **Not in a server** — `requireGuildId` throws `VOICE_UNAVAILABLE` ("This
  command only works inside a server.") (`commands.ts:28-33`).

## Slash commands

### `/join`
- **Description**: "Join your current voice channel".
- **Options**: none.
- **Behavior**: joins the invoking user's current voice channel and binds a
  session.
- **Edge cases**:
  - User not in a voice channel → ephemeral "You need to join a voice channel
    first."
  - Bot already in that same channel → "I'm already in #<name>. Ready when you
    are!" (no re-join).
- Source: `commands.ts:38-58`.

### `/leave`
- **Description**: "Leave the voice channel".
- **Options**: none.
- **Behavior**: destroys the guild's session (clears queue, stops, disconnects)
  via `manager.destroySession`; defensively also disconnects a stray active
  voice session the manager didn't know about.
- **Edge cases**: not connected → ephemeral "I'm not in a voice channel."
- Source: `commands.ts:60-80`.

### `/play`
- **Description**: "Play from YouTube, SoundCloud, Spotify or a direct audio
  link (or queue it)".
- **Options**: `url` (string, **required**) — "YouTube / SoundCloud / Spotify
  link, or a direct audio file URL".
- **Behavior**: `defer()` → ensure voice (auto-join the user's channel if the
  bot isn't connected) → classify the URL. If the link is a **pure YouTube
  playlist** (`playlist?list=…`, i.e. `classifyYouTubeUrl(...).kind ===
  'playlist'`), it auto-expands the whole list and batch-enqueues it (same code
  path as `/playlist`, see below). Otherwise it resolves a **single** track via
  `resolver.resolve(url)` (SSRF guard + provider pick), tags it with the
  requester, and `enqueueOrPlay`s it. If it starts playing, replies with the
  visual now-playing panel (or "Now playing: **title**" without rich replies);
  if queued, "Queued (#n): **title**".
- **Playlist links**:
  - A `watch?v=…&list=…` link (a video opened from inside a playlist) **plays
    the chosen video right away, then loads the rest of the playlist** behind it
    (the chosen video is de-duplicated). Loading the rest is best-effort — if it
    fails, the chosen video still plays. Use `/playlist` to load the whole list
    **from the top** instead.
  - A `list=RD…` auto-mix is treated as a **single** video (auto-mixes are
    endless and per-viewer; `youtube-url.ts`).
  - See [youtube-playlists.md](youtube-playlists.md) for the full link table.
- **Search by text is NOT supported**: a non-URL fails URL validation and
  returns the existing "not a valid link" error. There is no `ytsearch` from a
  query.
- **Edge cases**:
  - Bot not connected AND user not in a voice channel → ephemeral "You need to
    join a voice channel first." (no resolution attempted).
  - Invalid/unsafe URL, unsupported host, blocked (SSRF), live stream, or track
    over the duration limit → safe `UserFacingError` (`URL_INVALID`,
    `URL_UNSUPPORTED`, `URL_BLOCKED`, `AUDIO_RESOLVE_FAILED`, `TRACK_TOO_LONG`).
  - Queue already full → `UserFacingError('QUEUE_FULL')` ("The queue is full
    (max N).").
- Source: the `play` command in `commands.ts` (`playSingle` /
  `playVideoWithPlaylist` / `enqueuePlaylist` helpers). Resolution detail in
  `youtube-playback.md`.

### `/playlist`
- **Description**: "Add every track from a YouTube playlist link to the queue".
- **Options**: `url` (string, **required**) — "A YouTube playlist link
  (playlist?list=… or watch?v=…&list=…)".
- **Behavior**: `defer()` → classify the URL. Accepts **both** a pure playlist
  (`playlist?list=…`) and a video-in-playlist (`watch?v=…&list=…`) link, and
  **force-expands** the whole list via `resolver.resolvePlaylist(url, ctx,
  maxPlaylistItems)`. Tags each track with the requester and `enqueueMany`s
  them. Replies with a one-line summary, e.g.:
  ```
  Added **N** of M track(s) from the playlist · K unavailable · J over the 100-track limit · L didn't fit the queue.
  ```
  Only the parts that apply are shown. If nothing was playing, the first track
  starts immediately and the reply adds "▶️ Now playing the first track — use
  `/queue` to see what's next."
- **Edge cases**:
  - Link has **no playlist** (a plain video or non-YouTube link) → ephemeral
    "That link has no playlist. Use `/play <link>` for a single track."
  - Empty playlist / all items unavailable → "That playlist is empty (or its
    items are all unavailable)." or "No playable tracks were found (N
    unavailable)."
- Source: `commands.ts:200-228` (handler) + `commands.ts:56-88` (shared
  `enqueuePlaylist`). See [youtube-playlists.md](youtube-playlists.md).

### `/queue`
- **Description**: "Show the current queue".
- **Options**: none.
- **Behavior**: shows "Now playing" + up to **10** upcoming tracks (with
  `[mm:ss]` when duration known), then "…and N more." for the rest.
- **Edge cases**: nothing playing and empty queue → "The queue is empty."
- Source: `commands.ts:230-257`. (Queue model: [queue-system.md](queue-system.md).)

### `/skip`
- **Description**: "Skip the current track".
- **Options**: none.
- **Behavior**: skips the current track; if a next track exists, "Skipped. Now
  playing: **title**"; if the queue is empty, "Skipped. The queue is empty —
  stopping." (stays in the channel).
- **Edge cases**: nothing playing → ephemeral "Nothing is playing."
- Source: `commands.ts:259-276`.

### `/pause`
- **Description**: "Pause playback".
- **Options**: none.
- **Behavior**: pauses; freezes the elapsed clock. Replies "Paused."
- **Edge cases**: already paused → ephemeral "Already paused."; nothing playing
  → ephemeral "Nothing is playing."
- Source: `commands.ts:278-293`.

### `/resume`
- **Description**: "Resume paused playback".
- **Options**: none.
- **Behavior**: resumes; restarts the elapsed clock. Replies "Resumed."
- **Edge cases**: nothing paused → ephemeral "Nothing is paused."
- Source: `commands.ts:295-308`.

### `/stop`
- **Description**: "Stop playback and clear the queue (stays in the channel)".
- **Options**: none.
- **Behavior**: stops the current track and clears the queue; **keeps the voice
  connection**. Replies "Stopped playback and cleared the queue."
- **Edge cases**: nothing playing and empty queue → ephemeral "Nothing is
  playing."
- Source: `commands.ts:310-323`.

### `/nowplaying`
- **Description**: "Show the current track with a visual progress bar".
- **Options**: none.
- **Behavior**: renders the now-playing panel (embed + progress bar +
  buttons). Without `replyRich`, falls back to plain text ("**title** —
  playing/paused\nSource: <provider> · <url>"), or "Nothing is playing right
  now." when idle.
- Source: `commands.ts:330-352`.

### `/controls`
- **Description**: "Show the audio player controls and live status".
- **Options**: none.
- **Behavior**: renders the now-playing panel (idle-safe — shows an idle panel
  if nothing is playing). Plain-text fallback lists the control commands.
- Source: `commands.ts:354-368`.

### `/radio …`

`/radio` is a **subcommand group** built separately
(`radio/commands.ts:128-233`) and registered alongside the other audio commands
(`index.ts:86`). It is **guild-only**. Full details and the station model are in
[online-radio.md](online-radio.md); the quick reference:

| Subcommand | Options | Behavior |
|---|---|---|
| `/radio list` | `category` (string, optional) | Posts an embed grouping stations by category **plus a string select menu** (≤25 options, `customId="radio:select"`) to pick & play. Filters by category when given; "No stations in …" when the category is empty. Plain-text fallback when rich replies are unavailable. (`radio/commands.ts:131-159`) |
| `/radio play` | `station` (string, **required**) | Resolves the query (id → exact name → contains; `registry.ts:42-51`), joins voice, and **takes over** playback — stops the current track and clears the queue (`radio/commands.ts:64-74`). Unknown station → ephemeral guidance to `/radio list`. Replies with the now-playing panel. |
| `/radio stop` | none | Stops playback and clears the queue (`session.stop()`). "Nothing is playing." when idle. |
| `/radio nowplaying` | none | Renders the now-playing panel (or "Nothing is playing."). |

- Radio plays as a **LIVE** track — no duration, shows `🔴 LIVE / streaming`, and
  is exempt from the duration watchdog (`radio-source.ts:15-31`).
- Selecting from the `/radio list` menu plays on the guild's **active** session;
  if the bot is not connected it replies "I'm not in a voice channel. Use
  `/radio play <id>` …" (components carry no voice capability —
  `radio/commands.ts:255-261`).

## Now-playing panel buttons

The panel (`buildNowPlayingPanel`, `now-playing.ts:55-112`) carries control
buttons. Clicking one emits a `component.interaction` event with
`customId = "audio:<control>"`, handled by `buildAudioComponentHandler`
(`commands.ts:378-417`): it performs the action via the `PlayerManager`, then
**refreshes the panel in place** (`event.update`) or replies with the result
text when in-place edit is unavailable.

| Button | customId | Action |
|--------|----------|--------|
| ⏸ Pause | `audio:pause` | `manager.pause` (shown while playing) |
| ▶ Resume | `audio:resume` | `manager.resume` (shown while paused) |
| ⏭ Skip | `audio:skip` | `manager.skip` |
| ⏹ Stop | `audio:stop` | `manager.stop` |
| 👋 Leave | `audio:leave` | `manager.destroySession` |
| 🔄 Refresh | `audio:refresh` | no-op action; just re-renders the panel |

- The Pause/Resume button is **contextual** — the panel shows Pause while
  playing and Resume while paused (`now-playing.ts:102-104`).
- The **idle** panel (nothing playing) shows only **Refresh** and **Leave**
  (`now-playing.ts:58-71`).
- The progress bar shows `🔴 LIVE / streaming · m:ss` when duration is unknown
  or 0 (`now-playing.ts:34-35`); otherwise a Unicode bar `████▒▒▒▒ 1:23 / 4:56`.
- Buttons ignore non-audio `customId`s and interactions without a guild
  (`commands.ts:382-385`).
- The radio station **select menu** (`customId = "radio:select"`) is handled by
  a separate handler; both run from one `component.interaction` event and each
  ignores the other's prefix (`index.ts:90-98`). See
  [online-radio.md](online-radio.md).

## Internal-API actions (not user commands)

`PlayerManager` also exposes `skip / stop / clearQueue / pause / resume /
getSnapshots`, surfaced through `AudioModuleHandle` (`index.ts:23-29,100-106`)
for the bot's internal admin API. These return `InternalActionResult`
(`{ ok, message }`) and have no command context. Listed here so later agents
know the engine has a second caller besides slash commands.

---

## Roadmap

Playlists, long-track (`MAX_TRACK_DURATION_SECONDS=0`) and online radio are all
**shipped** — see their dedicated docs above. Features that are still not built
(text search in `/play`, per-server duration limits, DB-backed radio, queue
restore after restart, Spotify playlists/albums, shuffle/loop) are tracked in
[future-music-roadmap.md](future-music-roadmap.md).
