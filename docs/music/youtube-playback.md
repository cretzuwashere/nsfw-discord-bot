# YouTube Playback — End to End

How a single YouTube video goes from `/play <link>` to audible Opus in a voice
channel. SoundCloud follows the same `yt-dlp` path; Spotify is a variant that
searches YouTube (see the bottom). Code references are `file:line` in the repo.

## TL;DR pipeline

```
/play url            commands.ts:94
  → ctx.defer()      commands.ts:95            (network work ahead)
  → ensure voice     commands.ts:99-107        (join if not connected)
  → resolver.resolve resolver.ts:13            (SSRF guard + pick provider)
      → yt-dlp -J -- <url>                      ytdlp-provider.ts:55, ytdlp-runner.ts:48
          (reject is_live / over-duration)      ytdlp-provider.ts:60-72
      → ResolvedTrack { metadata, lazy source } ytdlp-provider.ts:74-97
  → session.enqueueOrPlay(track)                session.ts:67
      → playNow → voiceRef.play(source, …)      session.ts:178-198
          → source.createStream()               (yt-dlp spawns NOW)
              yt-dlp -f bestaudio/best -o - -- <url>   ytdlp-provider.ts:87-95
          → createAudioResource(StreamType.Arbitrary)  voice-session.ts:154
              → ffmpeg transcodes → Opus        (StreamType.Arbitrary)
          → Discord voice channel
```

## 1. Resolution (metadata, eager)

`YtDlpAudioProvider.canResolve` claims YouTube hosts
(`youtube.com`, `www.`, `m.`, `music.youtube.com`, `youtu.be`) and SoundCloud
(`ytdlp-provider.ts:43-52`).

`resolve()` runs a **cheap metadata-only** call:

```
yt-dlp --no-playlist --no-warnings --no-progress --no-cache-dir [--cookies <file>] -J -- <url>
```

- `-J` = dump a single JSON object with `title`, `duration`, `uploader`,
  `webpage_url`, `extractor_key`, `is_live` (`ytdlp-provider.ts:26-33,55-58`).
- The leading flags are `COMMON_ARGS` applied to **every** invocation
  (`ytdlp-runner.ts:27`). `--no-playlist` is why a playlist/mix URL today
  resolves to just its single "current" video — playlists are intentionally
  disabled.
- `--cookies <file>` is added only when `YTDLP_COOKIES_FILE` is set
  (`ytdlp-runner.ts:43-45`).
- The call is `execFile` with a `timeout` (`AUDIO_REQUEST_TIMEOUT_MS`, default
  15s) and a hard 20 MB stdout cap (`ytdlp-runner.ts:24,53`). Any non-zero exit
  or unparseable JSON becomes a safe `UserFacingError('AUDIO_RESOLVE_FAILED')`
  — raw stderr is logged server-side only, never shown to users
  (`ytdlp-runner.ts:55-78`).

### Duration enforcement (pre-queue)
If `duration` is known and `> maxTrackDurationSeconds`, resolution throws
`UserFacingError('TRACK_TOO_LONG')` **before the track is ever queued**
(`ytdlp-provider.ts:63-72`, default limit 3600s). Live streams (`is_live`) are
rejected outright (`ytdlp-provider.ts:60-62`).

The result is a `ResolvedTrack`:
```
{
  metadata: { title, url: webpage_url ?? rawUrl, provider: 'youtube', durationSeconds? },
  source:   { inputType: 'arbitrary', metadata, createStream: async () => runner.stream([...]) }
}
```
`createStream` is **lazy** — nothing is downloaded at resolve time (asserted in
`ytdlp-provider.test.ts:65-69`).

## 2. Queue or play

`session.enqueueOrPlay(track)` (`session.ts:67-80`):
- nothing playing → `playNow(track)` (status `playing`),
- otherwise enqueue in the bounded FIFO (status `queued`, 1-based position);
  overflow → `UserFacingError('QUEUE_FULL')`.

`/play` then renders the now-playing panel on start (if `replyRich`), or
"Queued (#n): **title**" (`commands.ts:121-130`).

## 3. Lazy stream + ffmpeg transcode (playback)

When `playNow` runs `voiceRef.play(source, onEvent)` (`session.ts:193`), the
**Discord adapter** does the heavy lifting (`voice-session.ts:131-175`):

1. `source.createStream()` → spawns:
   ```
   yt-dlp --no-playlist … -f bestaudio/best -o - -- <url>
   ```
   piping best audio to **stdout** (`ytdlp-provider.ts:87-95`,
   `ytdlp-runner.ts:81-114`). `-o -` = stream to stdout; killing the consumer
   kills the process (`ytdlp-runner.ts:107-111`).
2. The stdout `Readable` is wrapped in
   `createAudioResource(stream, { inputType: StreamType.Arbitrary })`
   (`voice-session.ts:154-157`). **`StreamType.Arbitrary` means ffmpeg
   transcodes whatever bytes arrive into the Opus format Discord needs** — yt-dlp
   doesn't have to output a specific codec. ffmpeg + libopus ship in the Docker
   images (see `docs/AUDIO_SOURCES.md`); they are not npm imports.
3. The adapter waits up to 15s for the player to reach `Playing`
   (`voice-session.ts:160-168`); failure → `AUDIO_PLAYBACK_FAILED`.
4. On success the session resets its pause-aware clock and **arms the duration
   watchdog** (`session.ts:196-198`).

### Duration enforcement (runtime watchdog)
`armDurationTimer()` (`session.ts:266-277`) sets a `setTimeout` for
`maxTrackDurationSeconds`; on fire it logs and force-`skip()`s the track. This
is the safety net for streams whose duration was **unknown** at resolve time
(so the pre-queue check couldn't catch them). The timer is `unref()`'d so it
never keeps the Node process alive, and it is cleared on every terminal event
(`session.ts:215,279-284`).

## 4. Track end / errors / advance

Terminal events flow `DiscordVoiceSession → onEvent → session.handleEvent`
(`voice-session.ts:87-99`, `session.ts:207-240`). The contract: per `play()`
call, exactly ONE of `finished` | `error` fires after one `started`.

- `finished` → history `completed`, **reset failure counter**, `advance()` to
  the next queued track (`session.ts:217-222`).
- `error` → log, history `failed` (safe summary), **increment** failure
  counter; if it hits `MAX_CONSECUTIVE_FAILURES = 3` the queue is cleared and
  playback stops, otherwise `advance()` (`session.ts:225-239`). The counter
  resets **only on a genuine finish**, not on a successful start
  (`session.ts:194-196`) — this prevents an endless loop on a stream that
  starts then immediately dies.

## 5. Cookies — private / age-restricted YouTube

| Visibility | Plays with just the link? | Needs cookies? |
|------------|:-------------------------:|:--------------:|
| Public | yes | no |
| Unlisted | yes | no |
| Private / age-restricted | no | **yes** |

Set `YTDLP_COOKIES_FILE` to a Netscape `cookies.txt` mounted into the bot
container; the runner then adds `--cookies <file>` to every yt-dlp call
(`ytdlp-runner.ts:29-45`). Full setup steps are in
`docs/AUDIO_SOURCES.md` ("Private & unlisted YouTube videos").

## Spotify variant (same engine, different front)

`SpotifyAudioProvider` (single `/track/…` links only, `spotify-provider.ts:39-44`):
1. read the public "Title — Artist" from Spotify's **oEmbed** endpoint via the
   SSRF-safe fetch (`spotify-provider.ts:94-121`),
2. run `yt-dlp … -J ytsearch1:<title> audio` to find the best YouTube match
   (`spotify-provider.ts:50-62`),
3. apply the same duration check and return a lazy yt-dlp stream of the matched
   YouTube URL (`spotify-provider.ts:64-91`).

So Spotify plays the **closest YouTube match**, not Spotify's DRM-protected
audio. Albums/playlists are out of scope today.

## Failure modes to know

- yt-dlp not installed / not on PATH → `onLoad` logs a warning
  (`index.ts:77-83`); links then fail at resolve time with a safe message.
- yt-dlp stale (YouTube anti-bot changes) → "Sign in to confirm you're not a
  bot" surfaces as `AUDIO_RESOLVE_FAILED`; fix by bumping the pinned yt-dlp in
  the Docker image (see `docs/AUDIO_SOURCES.md`).
- All raw provider/yt-dlp output is logged server-side and replaced with safe
  user messages (`resolver.ts:26-34`, `ytdlp-runner.ts:55-78`,
  `session.ts:308-311`).
