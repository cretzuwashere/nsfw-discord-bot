# YouTube Playlists

Whole-YouTube-playlist support is **shipped**. You can expand a playlist into
the queue in one command — `/play` auto-expands a *pure* playlist link, and
`/playlist` force-expands *any* YouTube playlist link (including a video opened
from inside a list). Single-video playback is unchanged.

See also: [commands.md](commands.md) for the full command reference and
[queue-system.md](queue-system.md) for how a batch of tracks fills the queue.

## How links are interpreted

Classification is pure and I/O-free (`resolver/youtube-url.ts`,
`classifyYouTubeUrl`). `/play` checks the link's `kind` before resolving and
branches into single / playlist / video-in-playlist; `/playlist` checks it too
(both in `commands.ts`).

| You paste… | `kind` | `/play` | `/playlist` |
|---|---|---|---|
| `youtube.com/watch?v=ID` or `youtu.be/ID` | `video` | Plays that one video. | Rejected — "That link has no playlist." |
| `youtube.com/playlist?list=PL…` (pure playlist) | `playlist` | **Expands the whole playlist.** | **Expands the whole playlist.** |
| `youtube.com/watch?v=ID&list=PL…` (video opened inside a playlist) | `video-in-playlist` | **Plays the chosen video, then loads the rest of the playlist** behind it. | **Expands the whole playlist from the top.** |
| An auto-generated mix/radio (`list=RD…`, `UL…`, `RDMM…`, `RDCLAK…`, `RDEM…`) | `video` | Plays the single video; the endless mix is **not** expanded. | Rejected — auto-mixes are treated as a single video. |
| Free text (a song name) | — | **Not supported** — fails URL validation with the "not a valid link" error. There is no text search. | Same. |

Auto-mix detection: `isAutoMix()` (`youtube-url.ts`) strips
`RD/UL/RDMM/RDCLAK/RDEM` `list=` values so they classify as a plain video.

**Video-in-playlist (`/play`)** — when you paste a link that *contains* a
playlist (a video opened from inside one), `/play` first plays the chosen video
right away, then loads the rest of the playlist behind it (the chosen video is
de-duplicated so it is not queued twice). Loading the rest is best-effort: if
the playlist lookup fails, the chosen video still plays. The reply reads e.g.
`Now playing: **Song** — and queued **47** more track(s) from the playlist.`
Use `/playlist <link>` instead when you want the whole list **from the top**,
ignoring which video was selected.

## What you see

When a playlist is expanded, the bot batch-enqueues it and replies with a
one-line summary (`commands.ts:78-87`), for example:

```
Added **48** of 50 track(s) from the playlist · 2 unavailable.
```

All applicable parts are shown, joined by ` · `:

- `Added **N** of M track(s) from the playlist` — `N` accepted, `M` = raw entry
  count the playlist reported.
- `K unavailable` — entries dropped as private/deleted/unavailable or too long.
- `J over the 100-track limit` — playable entries beyond `MAX_PLAYLIST_ITEMS`.
- `L didn't fit the queue` — entries dropped because `MAX_QUEUE_SIZE` was hit
  mid-expansion.

If nothing was playing, the first track starts immediately and the reply adds
`▶️ Now playing the first track — use /queue to see what's next.`
(`commands.ts:83-86`). Use `/queue`, `/skip`, `/pause`, `/resume`, `/stop`,
`/leave`, or the visual `/controls` panel from there.

## Limits & safety

- **Per-playlist cap** — `MAX_PLAYLIST_ITEMS` (default `100`, range `1–1000`)
  caps how many tracks one playlist may add. The provider keeps counting beyond
  the cap so the "over the limit" number is accurate
  (`ytdlp-provider.ts:112-119`).
- **Queue limit still applies** — `MAX_QUEUE_SIZE` (default `50`, max `1000`)
  bounds the total queue. `enqueueMany` takes only as many as fit and reports
  the rest as `rejected` (`queue.ts:24-32`).
- **Unavailable / private / deleted videos are skipped and counted**, so one
  broken entry never blocks the rest (`ytdlp-provider.ts:160-173`). If a video
  breaks between queueing and playing, the session skips to the next
  automatically (and stops after 3 consecutive failures — see
  [queue-system.md](queue-system.md)).
- **Too-long entries are skipped** during expansion when
  `MAX_TRACK_DURATION_SECONDS > 0` (`ytdlp-provider.ts:112-113`); set it to `0`
  to allow any length (see [long-track-playback.md](long-track-playback.md)).
- **Empty playlist** — if a playlist has no playable videos, the bot says so and
  plays nothing (`commands.ts:62-69`).

These combine: a playlist adds at most
`min(MAX_PLAYLIST_ITEMS, remaining queue space)` playable tracks.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MAX_PLAYLIST_ITEMS` | `100` (range `1–1000`) | Max videos a single playlist may add to the queue. Defined in `packages/config/src/index.ts:47` → `audio.maxPlaylistItems`. |
| `MAX_QUEUE_SIZE` | `50` (max `1000`) | Total-queue cap; also bounds playlist expansion. |
| `MAX_TRACK_DURATION_SECONDS` | `3600` (`0` = unlimited) | Entries longer than this are skipped during expansion (unless `0`). |

## How it works under the hood

Playlist support is **additive** — it does not change single-video playback:

- `/play` and `/playlist` share `enqueuePlaylist()` (`commands.ts:56-88`), which
  calls `resolver.resolvePlaylist(url, ctx, maxPlaylistItems)`
  (`resolver.ts:42-70`).
- The resolver routes to the first provider that both `canResolve`s the URL
  **and** implements `resolvePlaylist` — currently only `YtDlpAudioProvider`
  (YouTube). Non-YouTube playlist links get `URL_UNSUPPORTED`.
- `YtDlpAudioProvider.resolvePlaylist` (`ytdlp-provider.ts:95-131`) flat-lists
  the playlist once: `yt-dlp --yes-playlist --flat-playlist -J -- <url>`
  (`ytdlp-runner.ts:118-152`). `--yes-playlist` overrides the global
  `--no-playlist` (last flag wins); `--flat-playlist` avoids per-item extraction
  so it scales to large playlists.
- Each entry becomes a `ResolvedTrack` whose audio stream is opened **lazily**,
  only when it reaches the front of the queue — queued items hold no processes
  or sockets, exactly like single-video playback.
- The session's `enqueueMany` (`session.ts:88-108`) appends the batch and starts
  the first track if idle.

See [youtube-playback.md](youtube-playback.md) for the single-video pipeline and
`docs/agent-memory/music/02-youtube-playlist-analysis.md` for the design
rationale.
