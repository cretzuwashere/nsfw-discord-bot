# Agent 2 — YouTube Playlist Support: Analysis + Proposed Design

> Read-only analysis. NO source code was modified. This is an analysis and a
> *proposed* design for adding YouTube playlist support to the existing music
> system; implementation is Agent 6's job (per `00-orchestrator-plan.md`).
>
> Author: Agent 2. Date: 2026-06-27. Language: English.
> Every claim is marked **CONFIRMED** (read in code this session, cited to
> `file:line`) or **DEDUCED** (reasoned from code + documented yt-dlp behavior,
> not executed — yt-dlp was NOT run).

---

## 0. Scope & headline conclusions

The brief asks: can we add "add a whole YouTube playlist to the queue" without
breaking single-video `/play`, and how. Short answer: **yes, cleanly, additively.**

Three things this proposal guarantees (expanded in §7):

- **(a) Single-video play is NOT broken.** The single-track `resolve()` contract
  is left untouched; playlist support is a *new* parallel path
  (`resolvePlaylist()` + a runner method that omits `--no-playlist`). The
  existing `YtDlpAudioProvider.resolve()` keeps passing `--no-playlist` via
  `COMMON_ARGS`, so `watch?v=ID&list=ID` and bare `watch?v=ID` behave exactly as
  today unless the new playlist path is deliberately taken.
- **(b) Very large playlists are handled** — flat extraction (no per-item
  metadata fetch), a hard `MAX_PLAYLIST_ITEMS` cap, and the existing
  `maxQueueSize` bound, with a clear "added N of M" message stating how many were
  dropped.
- **(c) Partial / unavailable items are handled** — unavailable / private /
  deleted entries are skipped and counted at extraction time; failures at play
  time already fall through the existing per-track error path
  (`MAX_CONSECUTIVE_FAILURES`, `advance()`).

**Recommended decisions** (justified in §3.3 and §6):
- URL classification: a small pure helper that inspects host + query params.
  For `watch?v=ID&list=ID` (a video *inside* a playlist) → **default to playing
  just the selected video** (current behavior), and only expand the playlist when
  the user explicitly opts in. See §3.3 for the recommendation and an alternative.
- Eager vs lazy per-item resolution: **lazy per-item resolution at dequeue
  time** (flat-extract cheaply up front, resolve full metadata + stream only when
  a track reaches the front of the queue). See §6.

---

## 1. Current YouTube extraction stack — CONFIRMED

| Fact | Evidence |
|---|---|
| yt-dlp is the extractor, wrapped behind an injectable `YtDlpRunner` interface (fully fakeable in unit tests). | `packages/audio-module/src/resolver/ytdlp-runner.ts:15-22`; fake at `packages/audio-module/src/testing/fakes.ts` (no `YtDlpRunner` fake exists yet there — tests inject ad-hoc objects; see §8). |
| **`--no-playlist` is hardcoded** in `COMMON_ARGS`, applied to *every* invocation (both `json()` and `stream()`). | `ytdlp-runner.ts:27`, used at `:44-45`, `:52`, `:82`. |
| `json()` runs `yt-dlp [...baseArgs, ...args]` via `execFile`, with `timeout`, `maxBuffer = 20 MB` (`MAX_JSON_BYTES`), parses stdout as JSON, maps any failure to `UserFacingError('AUDIO_RESOLVE_FAILED', 'That link could not be resolved.')`. | `ytdlp-runner.ts:24`, `:48-79`. |
| `stream()` spawns yt-dlp lazily; killing the consumer kills the process. | `ytdlp-runner.ts:81-114`. |
| Provider resolves **exactly one** track: `runner.json(['-J', '--', rawUrl])`, rejects `is_live`, rejects `duration > maxTrackDurationSeconds`, returns one `ResolvedTrack` with a lazy `createStream`. | `resolver/providers/ytdlp-provider.ts:54-98` (`is_live` reject `:60-62`; duration reject `:67-72`; lazy stream `:87-95`). |
| Resolver SSRF-validates then routes to the first provider whose `canResolve(url)` is true; returns one `ResolvedTrack`. | `resolver/resolver.ts:13-35`. |
| `ResolvedTrack = { metadata: TrackSummary; source: AudioStreamSource }`. | `resolver/types.ts:15-19`. |
| `play` command: single required `url` string option → `resolver.resolve(url)` → one track → `session.enqueueOrPlay(track)`; replies "Now playing" or "Queued (#position)". | `commands.ts:82-132` (option `:86-93`; resolve `:112`; enqueue `:119`; replies `:121-130`). |
| Bounded FIFO queue, `maxSize = maxQueueSize`; `enqueue` returns `{ok:false, reason:'full'}` when full. | `engine/queue.ts:6-38`; session maps full → `UserFacingError('QUEUE_FULL', ...)` at `engine/session.ts:74-77`. |
| Config: `audio.maxQueueSize` (env `MAX_QUEUE_SIZE`, default 50, **min 1 / max 1000**); no playlist-specific config. | `packages/config/src/index.ts:45` (env), `:106` (typed), `:164` (mapped). |
| Wiring: providers built in `createAudioModule`; YtDlp + Spotify added when `enableStreamingSources`, direct-http last; one `AudioResolver`, one `PlayerManager`. | `packages/audio-module/src/index.ts:31-58`. |

**Can yt-dlp do playlists?** CONFIRMED capability is *disabled* in code
(`--no-playlist`). The capability itself (DEDUCED from documented yt-dlp
behavior, not executed): `yt-dlp --flat-playlist -J <playlist-url>` returns a
single JSON object with `_type: "playlist"` and an `entries[]` array, each entry
carrying at least `id`, `title`, `url`/`webpage_url`, often `duration`,
`ie_key`, and an `availability`/`live_status` hint — **without** fetching every
video's full metadata. `--yes-playlist` overrides `--no-playlist`. A plain `-J`
on a playlist URL would try to fully extract every item (slow, large output that
can blow the 20 MB `maxBuffer` and the request timeout) — **we must avoid that**.

---

## 2. URL classification strategy

### 2.1 What a YouTube URL can be (CONFIRMED host set: `ytdlp-provider.ts:17-23`)

`YOUTUBE_HOSTS = youtube.com, www.youtube.com, m.youtube.com,
music.youtube.com, youtu.be`.

| Kind | Example | Distinguishing signal |
|---|---|---|
| **Single video** | `https://youtube.com/watch?v=ID`, `https://youtu.be/ID`, `https://music.youtube.com/watch?v=ID` | has `v` (or `youtu.be/<id>` path), **no** `list` |
| **Pure playlist** | `https://youtube.com/playlist?list=PL...` | path `/playlist`, has `list`, **no** `v` |
| **Video selected within a playlist** | `https://youtube.com/watch?v=ID&list=PL...` | has **both** `v` and `list` |
| **Channel / mix / radio "list"** | `list=RD...` (auto-mix/radio), `list=UU.../LL...` (channel uploads / liked) | `list` present but prefix `RD` = endless radio mix (DEDUCED: not a finite playlist — treat as single video or reject expansion) |
| **Invalid URL / bare search query** | `never gonna give you up` | `new URL()` throws → SSRF validator returns `URL_INVALID` (see §2.3) |

### 2.2 Proposed classifier (pure, unit-testable) — PROPOSED, not implemented

A small pure function `classifyYouTubeUrl(url: URL)` returning a tagged union:

```
type YouTubeUrlKind =
  | { kind: 'video'; videoId: string }
  | { kind: 'playlist'; listId: string }
  | { kind: 'video-in-playlist'; videoId: string; listId: string }
  | { kind: 'not-youtube' };
```

Logic (DEDUCED, standard URL parsing — no yt-dlp call needed for classification):
- `youtu.be/<id>` → `video` (path segment is the id; `?list=` may also appear →
  `video-in-playlist`).
- `youtube.com/playlist` with `list` → `playlist`.
- `youtube.com/watch` (or `music.youtube.com`) with `v` and `list` →
  `video-in-playlist`; with `v` only → `video`; with `list` only → `playlist`.
- Treat `list` values starting with `RD` (auto-generated radio/mix) as **not a
  finite playlist**: classify the `v` part as `video` and ignore the `list`
  (DEDUCED — mixes are endless and would never terminate cleanly). If there is no
  `v` (pure `list=RD...`) → reject expansion with a clear message, fall back to
  letting yt-dlp treat it as best it can or surface "that mix can't be queued".

This helper lives next to the provider (e.g. `resolver/providers/youtube-url.ts`)
and is the only place that knows YouTube URL shapes.

### 2.3 Search queries — CONFIRMED current behavior; OUT OF SCOPE

A bare query (e.g. `never gonna give you up`) is **not a URL**: `play` passes the
raw string straight into `resolver.resolve()` (`commands.ts:109-112`), which
calls `validateExternalUrl()` (`resolver.ts:14`). That does `new URL(rawUrl)`
which throws for a schemeless string → returns
`{ok:false, code:'URL_INVALID', reason:'That is not a valid link.'}`
(`packages/security/src/url-validation.ts:100-105`). So **search is not supported
today** and a bare query fails with "That is not a valid link."

Note: yt-dlp *does* support search internally — `docs/AUDIO_SOURCES.md` says the
Spotify provider uses a YouTube search under the hood — but the public `/play`
command never exposes a search path because the SSRF gate rejects non-URLs first.
**Recommendation: keep search out of scope for the playlist feature.** Adding
`/play <free text>` search is a separate concern (it would need to bypass or
precede SSRF validation and carries "Sign in to confirm you're not a bot"
rate-limit risk from datacenter IPs, per `docs/AUDIO_SOURCES.md`).

### 2.4 Invalid URL handling

Unchanged: invalid/blocked/unsupported URLs already surface as `UserFacingError`
from `validateExternalUrl` (`resolver.ts:16-19`). A malformed playlist URL (e.g.
`list=` empty) classifies as not-a-playlist and falls back to the single-video
path, preserving today's behavior.

---

## 3. Desired playlist behavior (PROPOSED)

### 3.1 Happy path
1. User runs `/play <playlist-or-video-in-playlist URL>`.
2. Classifier says `playlist` (or `video-in-playlist` with opt-in — §3.3).
3. New runner method flat-extracts entries (no `--no-playlist`,
   with `--flat-playlist -J`).
4. Build a list of lightweight queue entries (id/title/url/duration-if-present).
5. Apply caps (§3.4), enqueue all, reply **"Added N of M tracks to the queue"**
   (and, when dropped, *why*: cap or queue-full).
6. If nothing is playing, the first entry starts immediately (reuse
   `enqueueOrPlay`); the rest queue.

### 3.2 Confirmation message
`Added N of M tracks from "<playlist title>".` When `N < M`, append the reason,
e.g. `(M-N skipped: unavailable)` and/or `(capped at MAX_PLAYLIST_ITEMS)` and/or
`(queue limit MAX_QUEUE_SIZE reached)`. This mirrors the existing concise reply
style in `commands.ts:121-130`.

### 3.3 `video-in-playlist` (`watch?v=ID&list=ID`) — RECOMMENDED behavior

**Recommendation: default to playing ONLY the selected video** (`v`), matching
today's behavior, and require an explicit opt-in to expand the whole playlist.

Why:
- **Least surprise / backward compatible.** People routinely paste
  `watch?v=...&list=...` links copied from a playlist context meaning "play this
  one song." Auto-expanding to 200 tracks would be a surprising, hard-to-undo
  flood. This also makes guarantee (a) trivially true for the most common shape.
- **Explicit opt-in is cheap.** Add an optional boolean option to `/play`, e.g.
  `playlist:true` (default false), or a separate `/playlist <url>` command.
  Pure-`playlist?list=...` URLs (no `v`) are unambiguous → expand by default.

Alternative considered (NOT recommended as default): "play the selected video
first, then the rest of the playlist." It is the most *featureful* but violates
least-surprise and complicates ordering (start `v`, then enqueue the remaining
entries excluding `v`, preserving playlist order). It can be offered later as the
behavior of the explicit opt-in (`/play url playlist:true` on a
`video-in-playlist` URL → play `v` now, queue the rest in order).

Summary of the recommended decision matrix:

| URL kind | `/play url` (default) | `/play url playlist:true` (or `/playlist url`) |
|---|---|---|
| `video` | play that video (today) | play that video (no list to expand) |
| `playlist` (`list` only) | **expand whole playlist** | expand whole playlist |
| `video-in-playlist` | **play only `v`** (today) | play `v` now, then queue the rest in order |

### 3.4 Caps & limits
- **New config `MAX_PLAYLIST_ITEMS`** (PROPOSED env var; default e.g. 100, a
  sane min like 1, max e.g. 1000 to match `maxQueueSize`'s ceiling). Flat-extract
  may return thousands; we hard-cap the *expansion* before enqueue.
- **Respect `maxQueueSize`** (CONFIRMED bound at `queue.ts:13-15`). Even after the
  playlist cap, the queue is finite. Enqueue stops when the queue reports full;
  count how many were dropped for that reason.
- Effective added count `N = min(M, MAX_PLAYLIST_ITEMS, freeQueueSlots) - skipped`.

### 3.5 Unavailable / private / deleted items — strategy for guarantee (c)
- At flat-extract time, **skip and count** entries that are clearly unusable:
  missing `id`/`url`, or `availability`/`live_status` indicating
  private/deleted/upcoming/live (DEDUCED from yt-dlp entry fields — exact field
  names to be confirmed by Agent 6 against the pinned yt-dlp build). Live entries
  are skipped here for the same reason single live videos are rejected today
  (`ytdlp-provider.ts:60-62`).
- Items that *look* fine but fail later (e.g. became private between extraction
  and playback) are caught by the **existing** per-track failure path: `playNow`
  throws → `handleEvent`/`advance` skip to the next, and
  `MAX_CONSECUTIVE_FAILURES = 3` stops a runaway of all-broken items
  (`engine/session.ts:17`, `:207-256`). **No new resilience needed** — the
  partial-failure machinery already exists; we just feed it more tracks.

### 3.6 Empty playlist
If flat-extract returns `entries: []` (or all entries skipped) → no enqueue;
reply with a clear `UserFacingError`-style message, e.g. "That playlist is empty
or has no playable videos." Do not start playback.

### 3.7 Very large playlist — strategy for guarantee (b)
Flat extraction means the *cost* of a 5,000-item playlist is one cheap JSON call
(no per-video fetch) — but the **output size** can be large. Mitigations:
- Keep `--flat-playlist` (entries are small; far under 20 MB `maxBuffer` for
  realistic sizes, but we still cap).
- Apply `MAX_PLAYLIST_ITEMS` (and optionally pass yt-dlp `--playlist-end N` to
  bound extraction itself — DEDUCED, to confirm). Tell the user how many were
  dropped: "Added 100 of 5,000 tracks (capped at 100)."
- Lazy per-item resolution (§6) keeps memory/process count flat regardless of
  queue length — queued items hold no sockets/processes (consistent with the
  current lazy design, `ytdlp-provider.ts:11-14`, `:87-95`).

---

## 4. Error fallbacks

| Failure | Behavior (PROPOSED) |
|---|---|
| Flat-extract command fails (network, yt-dlp error, bad URL) | `runner.json()` already maps to `UserFacingError('AUDIO_RESOLVE_FAILED', 'That link could not be resolved.')` (`ytdlp-runner.ts:55-65`). Surface it; no partial queue created. |
| Output isn't a playlist object / no `entries` | Fall back to the single-video path (treat the `v`, or the whole URL, as one track). Preserves backward compatibility. |
| Mixed availability | Skip+count unusable entries (§3.5); proceed with the rest; report skipped count. |
| Rate limit / "Sign in to confirm you're not a bot" | Same as any yt-dlp failure → `AUDIO_RESOLVE_FAILED`; documented operationally (keep yt-dlp current, residential IP) per `docs/AUDIO_SOURCES.md`. |
| Per-item failure at play time | Existing `advance()` + `MAX_CONSECUTIVE_FAILURES` path (`session.ts:207-256`). |
| Queue fills mid-enqueue | Stop enqueuing; report "queue limit reached, added N of M." (Do NOT throw `QUEUE_FULL` for a playlist — partial success is the better UX; throwing is correct only for a single `/play` as today.) |

---

## 5. Proposed code changes (NOT implemented)

Goal: extend resolver to return MANY tracks **without changing** the single-track
`resolve()` contract. Additive only.

1. **`resolver/ytdlp-runner.ts`** — add a runner method that does NOT carry
   `--no-playlist`. Two clean options:
   - **(Recommended)** add `flatPlaylist(url, timeoutMs): Promise<unknown>` that
     invokes `json()` with `['--yes-playlist', '--flat-playlist', '-J', '--', url]`.
     Because `--no-playlist` is in `COMMON_ARGS` (`:27`), `--yes-playlist` must be
     passed to override it (CONFIRMED `--no-playlist` is always prepended;
     DEDUCED that `--yes-playlist` wins as the later flag). Cleanest: keep
     `COMMON_ARGS` as-is and override per-call. (Alternative: split `COMMON_ARGS`
     so `--no-playlist` is added only by the single-track call paths — more
     invasive, touches existing call sites; not recommended.)
   - Extend the `YtDlpRunner` *interface* (`:15-22`) with the new method so it
     stays fakeable.
2. **`resolver/providers/ytdlp-provider.ts`** — add a method that flat-extracts
   and returns lightweight playlist entries, e.g.
   `resolvePlaylist(url, ctx): Promise<PlaylistResolution>` where
   `PlaylistResolution = { title?: string; entries: PlaylistEntry[]; total: number; skipped: number }`
   and `PlaylistEntry = { title; url; durationSeconds? }`. It does NOT open
   streams and does NOT do the full per-item `-J` (that happens lazily, §6). It
   reuses `providerLabel()` and the `is_live`/availability filtering ideas.
   The existing `resolve()` (`:54-98`) is **unchanged**.
3. **`resolver/resolver.ts`** — add a sibling method `resolvePlaylist(rawUrl,
   ctx)` that SSRF-validates (same `validateExternalUrl`), finds the provider, and
   if it supports playlist resolution, calls it; otherwise errors "playlists not
   supported for that source." The existing `resolve()` (`:13-35`) is
   **unchanged** — guarantee (a). (Optionally also expose `resolveMany()` as the
   generic name; `resolvePlaylist` is clearer.)
4. **`resolver/types.ts`** — add an OPTIONAL capability to `AudioProvider`, e.g.
   `resolvePlaylist?(url, ctx): Promise<PlaylistResolution>` (optional so
   Spotify/direct-http providers don't need it), plus the `PlaylistEntry` /
   `PlaylistResolution` / lazy-entry types. `ResolvedTrack` and the existing
   `resolve` signature stay as-is.
5. **`commands.ts`** — in `play`, after SSRF/classification: if the URL is a
   playlist to expand (per §3.3 opt-in rules), call `resolver.resolvePlaylist`,
   then **batch-enqueue** (a new `session.enqueueMany(entries)` or a loop over a
   new lazy-track wrapper), and reply "Added N of M…". Single-video path
   unchanged. Add the optional `playlist:boolean` option (or a separate
   `/playlist` command — decide in Agent 5).
6. **`engine/session.ts` + `engine/queue.ts`** — add `enqueueMany` (or loop
   `enqueue`) that fills until the queue is full and returns
   `{ added, dropped }`. The queue stays a bounded FIFO of "tracks"; with lazy
   resolution (§6) the queued items are lightweight descriptors that resolve to a
   real stream at dequeue. Keep `enqueueOrPlay` for single tracks.
7. **`packages/config/src/index.ts`** — add `MAX_PLAYLIST_ITEMS` (env + schema
   `z.coerce.number().int().min(1).max(1000).default(100)`, typed under
   `audio.maxPlaylistItems`, mapped in `loadConfig`, threaded into `resolveCtx`
   or session limits). Mirrors the existing `MAX_QUEUE_SIZE` pattern (`:45`,
   `:106`, `:164`).
8. **`packages/audio-module/src/index.ts`** — thread the new config through
   `resolveCtx`/limits; no structural change (`:60-72`).

**Contract preservation:** `resolve()` keeps returning exactly one
`ResolvedTrack`; `--no-playlist` stays on every existing call path. Playlist
support is reachable only via the new methods + opt-in. That is how guarantee (a)
holds.

---

## 6. Eager vs lazy per-item resolution — RECOMMENDED: lazy at dequeue

**Recommendation: flat-extract the playlist cheaply up front, but resolve each
item's full metadata + stream LAZILY when it reaches the front of the queue.**

Trade-off table:

| | Eager (full `-J` per item at enqueue) | **Lazy (flat now, full per-item at dequeue)** |
|---|---|---|
| Enqueue cost for 100 items | ~100 network calls, slow, may hit rate limits | **1 flat call** |
| Memory / processes for queued items | metadata only, still no streams | lightweight descriptors only (no streams) — same lazy spirit as today (`ytdlp-provider.ts:11-14`) |
| Duration validated before queueing | **Yes** (matches today's `ytdlp-provider.ts:67`) | Only when `--flat-playlist` happens to include `duration`; otherwise validated at dequeue when the full `-J` runs |
| Scales to huge playlists | poorly | **well** |
| Stale entries (became private) | detected at enqueue | detected at play time → existing skip/advance path |

The cost of lazy is that the **eager duration check** (`ytdlp-provider.ts:63-72`)
no longer guards every queued item up front. Mitigations:
- If `--flat-playlist` returns `duration`, apply the `maxTrackDurationSeconds`
  check at enqueue for that subset (cheap, no extra call).
- For items without a flat duration, the check runs at dequeue (full `-J`), and
  the **runtime guard already exists**: `armDurationTimer()` force-skips any track
  that exceeds `maxTrackDurationSeconds` during playback (`session.ts:266-277`).
  So an over-long item is still bounded; it just may start before being skipped.
- This dovetails with Agent 3's long-track work (the duration timer is being made
  conditional); Agent 5 should reconcile the two so the playlist path and the
  long-track config agree.

Concretely, a lazy queued item is a descriptor whose `createStream` runs the full
`stream()` (and, if needed, a full `-J` for accurate title/duration) only when
playback begins — exactly the laziness the single-track provider already uses for
the *stream* (`ytdlp-provider.ts:87-95`), extended to metadata.

For small `video-in-playlist` opt-ins (e.g. play `v` now + a handful), eager is
fine; the recommendation is about not eagerly resolving large playlists.

---

## 7. Explicit confirmation of the three required guarantees

- **(a) Single-video play not broken** — CONFIRMED preservation strategy:
  `resolve()` (`resolver.ts:13`, `ytdlp-provider.ts:54`) and `--no-playlist`
  (`ytdlp-runner.ts:27`) are untouched; playlist is a new `resolvePlaylist()`
  path with `--yes-playlist`. `video-in-playlist` defaults to single video
  (§3.3). Unit tests for single-video resolution must stay green (a regression
  gate Agent 6/7 enforce).
- **(b) Very large playlists** — flat extraction (one cheap call, no per-item
  fetch), `MAX_PLAYLIST_ITEMS` cap (optionally `--playlist-end`), `maxQueueSize`
  bound, lazy per-item resolution so memory/processes stay flat, and an explicit
  "Added N of M (capped…)" message. §3.4, §3.7, §6.
- **(c) Partial / unavailable items** — skip+count at extraction (§3.5); runtime
  failures handled by the existing `advance()` + `MAX_CONSECUTIVE_FAILURES`
  machinery (`session.ts:207-256`); empty-playlist guard (§3.6). No track type
  can wedge the queue.

---

## 8. Notes / contradictions with orchestrator facts

- **No contradictions** with the orchestrator's context facts. All four key
  facts confirmed in code: `--no-playlist` at `ytdlp-runner.ts:27`; `is_live`
  reject at `ytdlp-provider.ts:60-62`; duration reject at `ytdlp-provider.ts:67`;
  single-track `resolve()` at `resolver.ts:13`/`ytdlp-provider.ts:54`; config has
  no playlist key (`config/src/index.ts`).
- **Minor correction to the brief's "Read first" note:** the brief says the
  `YtDlpRunner` is fakeable "via `packages/audio-module/src/testing/fakes.ts`."
  CONFIRMED the runner *interface* is trivially fakeable, but `fakes.ts` does NOT
  currently contain a `YtDlpRunner` fake (it has `FakeVoiceSession`,
  `FakeVoiceCapability`, `fakeTrack`, `fakePlaybackRepo`). Existing provider tests
  inject ad-hoc runner objects (see `resolver/providers/ytdlp-provider.test.ts`).
  Agent 6 should add a `FakeYtDlpRunner` (with a programmable `flatPlaylist`) to
  `fakes.ts` for the new path.
- **DEDUCED items to verify at implementation** (yt-dlp was NOT run this
  session): exact `--flat-playlist` entry field names for availability
  (`availability` / `live_status` / `__x_forwarded_for_ip` etc.), whether
  `--yes-playlist` reliably overrides `--no-playlist` ordering, and whether
  `--playlist-end` is desirable. Agent 6 must confirm against the pinned yt-dlp
  build (2026.06.09 per `00-orchestrator-plan.md`).
- **Dependency on Agent 3:** the lazy-duration interaction (§6) overlaps the
  long-track work; Agent 5 must reconcile `MAX_PLAYLIST_ITEMS`,
  `maxQueueSize`, and the (soon conditional) duration timer.

---

## Checkpoint — Agent 2 (YouTube playlist analysis)

Status: PASS

### Modificări făcute
- Read the full YouTube/resolver/queue/config chain and the SSRF validator.
- Produced this analysis + a proposed, additive design (new `flatPlaylist()`
  runner method, `resolvePlaylist()` provider/resolver path, batch-enqueue,
  `MAX_PLAYLIST_ITEMS`) that leaves the single-track contract intact.
- Wrote the user/developer-facing planned-behavior doc
  `docs/music/youtube-playlists.md`.

### Comenzi rulate
- File reads only (Read/Grep/Bash `ls`/`find`/`grep`). **No build/test/docker
  run. yt-dlp was NOT executed.**

### Validat efectiv
- Current single-track design and the four blockers/facts, cited to file:line.
- That a bare search query fails SSRF validation today (search not supported).
- That the partial-failure machinery (`advance` + `MAX_CONSECUTIVE_FAILURES`)
  already exists and is reusable for playlists.

### Nevalidat
- Actual yt-dlp `--flat-playlist` output shape and field names (DEDUCED from
  documented behavior, not executed).
- Real Discord voice playback of a queued playlist (needs live token + network).

### Probleme găsite
- Brief overstates the `fakes.ts` content: no `YtDlpRunner` fake exists there yet
  (provider tests inject ad-hoc runners). Agent 6 should add `FakeYtDlpRunner`.

### Următoarea etapă poate continua?
Da. The design is additive and compatible with Agents 3 (long tracks) and 4
(radio). Agent 5 should reconcile the lazy-resolution / duration-timer overlap
with Agent 3 and decide opt-in surface (`/play playlist:true` vs `/playlist`).
