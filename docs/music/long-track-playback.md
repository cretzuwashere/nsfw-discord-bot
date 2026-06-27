# Long-Track Playback

The music system supports multi-hour tracks (long DJ sets, lectures, full
albums, ambient/lofi streams). A single config knob,
`MAX_TRACK_DURATION_SECONDS`, controls the per-track duration cap — and setting
it to `0` makes playback **unlimited**.

See also: [troubleshooting-music.md](troubleshooting-music.md) for the
"track too long" fix and [online-radio.md](online-radio.md) for continuous LIVE
streams (which are exempt from the cap entirely).

## The duration cap

By default the bot enforces a **maximum track duration** so a single link cannot
occupy a voice channel for hours by accident. The limit is
`MAX_TRACK_DURATION_SECONDS` (default **3600** = 1 hour) and is enforced in two
places:

1. **Before queueing.** When you `/play` a link, the bot reads the track's
   duration from its metadata. If the known duration exceeds the limit, the bot
   rejects it with *"That track is too long (limit Ns)."* and it is never queued.
   This is enforced in both the yt-dlp provider (YouTube/SoundCloud,
   `ytdlp-provider.ts:68-77`) and the Spotify provider (whose matched YouTube
   result is checked the same way, `spotify-provider.ts:69-78`).
2. **A safety watchdog while playing.** A track whose duration is **unknown** (so
   it slipped past the check above) is guarded by a watchdog that skips it once
   it reaches the limit (`session.ts:294-309`, `armDurationTimer`).

Live streams (`is_live`) from yt-dlp are blocked entirely
(`ytdlp-provider.ts:60-62`), since they have no end. (Online radio is a separate
LIVE source that *is* allowed — see below.)

There is **no** hidden timeout that cuts a normal track short: the 15-second
`AUDIO_REQUEST_TIMEOUT_MS` only applies to *looking up* a link's metadata, **not**
to playback. Once a track is allowed to play, it plays to its end (or to the
duration limit).

## Unlimited / longer tracks (`MAX_TRACK_DURATION_SECONDS`)

| Value | Meaning |
| --- | --- |
| `3600` (default) | Reject/skip tracks longer than 1 hour. |
| any positive number | Reject/skip tracks longer than that many seconds. |
| **`0`** | **Unlimited** — no pre-queue rejection and no watchdog skip. Tracks of any length are allowed. |

The config validator accepts `0` (`packages/config/src/index.ts:49`,
`z.coerce.number().int().min(0).default(3600)`), so `0` is a valid, supported
value. Set it in your `.env` / environment:

```env
# Allow tracks up to 4 hours
MAX_TRACK_DURATION_SECONDS=14400

# Allow tracks of ANY length
MAX_TRACK_DURATION_SECONDS=0
```

When `0` is set, **both** protections switch off together: the pre-queue reject
in both providers (the `maxTrackDurationSeconds > 0` guard short-circuits) and
the watchdog (`armDurationTimer` returns immediately when the limit is `<= 0`,
`session.ts:296-299`). Nothing else is removed — the bot still:

- blocks yt-dlp live streams,
- stops after too many consecutive playback failures (3 — see
  [queue-system.md](queue-system.md)),
- kills the underlying downloader the moment a track is skipped/stopped,
- enforces the maximum **queue size**,
- enforces the audio domain allowlist (`ALLOWED_AUDIO_DOMAINS`).

The limit is read once from global config and passed into the providers and the
session at module construction (`index.ts:45-57`). It is **global to the bot** —
there is no per-server override yet (the dormant
`guild_settings.max_track_duration_seconds` column is on the roadmap; see
[future-music-roadmap.md](future-music-roadmap.md)).

Tracks whose length is unknown render as **🔴 LIVE / streaming** with a running
elapsed time on the now-playing panel (`now-playing.ts:34-35`).

## Reliability for multi-hour playback

A multi-hour track is a single continuous download (`yt-dlp`) fed through the
transcoder (`ffmpeg`, in the voice layer) for the whole duration. Over hours,
brief network hiccups can happen. The streaming path is hardened with **finite**
retries so a momentary blip does not end the track, but a genuinely dead source
still terminates instead of hanging forever:

```
--retries 10 --fragment-retries 10 --retry-sleep 3
```

These `STREAM_ROBUSTNESS_ARGS` are applied to the **streaming** invocation only
(not metadata lookups) — `ytdlp-runner.ts:57-64` and `:155`.

> Why the bot does not just "reconnect ffmpeg": ffmpeg reads from the downloader
> through a local pipe, not directly from the network, so ffmpeg's own reconnect
> options would not help. The reliability work is on the downloader side — the
> part that actually talks to the network. (ffmpeg transcode plus the
> reconnect/cleanup logic live in
> `packages/discord-adapter/src/voice-session.ts`, not in the audio module.)

There is **no** automatic same-track retry today: if a stream errors out, the
session advances to the next queued item (and stops after 3 consecutive
failures). An optional "retry the same track once on early failure" is on the
roadmap (off by default) — see [future-music-roadmap.md](future-music-roadmap.md).

### Why long links don't suffer the "expired URL" problem

The bot does **not** store a temporary, expiring media URL when you queue a
track. Queued items hold only the original link; the downloader fetches a fresh
stream the instant the track starts playing (the `createStream` callback is lazy
— `ytdlp-provider.ts:133-148`). So a long link sitting in the queue for hours
before it plays will not fail with an "expired URL" error — the URL is created at
play time, not at queue time.

## Stopping a long track

All controls work normally during a long track and take effect immediately:

- **`/skip`** — stops the current track, kills its downloader, plays the next.
- **`/stop`** — stops playback and clears the queue (stays in the channel).
- **`/leave`** — disconnects the bot and frees everything.
- The **Pause / Resume / Skip / Stop / Leave** buttons on the now-playing panel
  behave identically.

Killing the consumer kills the downloader: when the stream's `stdout` closes,
the yt-dlp child is `SIGKILL`ed (`ytdlp-runner.ts:180-184`).

## Operator notes

- Unlimited (`0`) is a per-deployment setting via `MAX_TRACK_DURATION_SECONDS`.
  A per-server override is a roadmap item; today the setting is global.
- Allowing very long tracks means a single track can hold a voice channel for a
  long time. Combine with a sensible `MAX_QUEUE_SIZE` and your server's own
  moderation if needed.
