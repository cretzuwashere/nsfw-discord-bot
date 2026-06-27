# 01 — Current Music System Analysis

> Agent 1 deliverable. READ-ONLY analysis of the music feature as it exists
> today. Every non-obvious claim is tagged **CONFIRMED** (read directly in
> code) or **DEDUCED** (inferred from code/tests, not directly stated).
> All paths are repo-relative; `file:line` cited where useful.

## 1. Scope and entry point

The music feature is the **audio-player module** in `packages/audio-module`.
It is one of several `BotModule`s; it contributes slash commands and one
`component.interaction` event handler, and is wired by `createAudioModule()`.

- Module key: `audio-player` (`packages/shared/src/types.ts:3`, `MODULE_KEYS.audioPlayer`). **CONFIRMED**
- Wiring: `packages/audio-module/src/index.ts:31` `createAudioModule()`. **CONFIRMED**

The actual **voice transport / ffmpeg transcode / reconnect** lives in a
DIFFERENT package — `packages/discord-adapter/src/voice-session.ts`. The audio
module only depends on the adapter-neutral `VoiceSession`/`VoiceCapability`
contracts in `packages/core/src/contracts/voice.ts`. **CONFIRMED** (the audio
module never imports `@discordjs/voice`; grep confirms `@discordjs/voice` only
in `discord-adapter`).

## 2. All music files and their roles

| File | Role |
|------|------|
| `packages/audio-module/src/index.ts` | `createAudioModule()` factory: builds provider list, resolver, `PlayerManager`; assembles the `BotModule` (commands + component handler + onLoad/onShutdown); re-exports public API. **CONFIRMED** |
| `packages/audio-module/src/commands.ts` | All 10 slash commands + `buildAudioComponentHandler` for the panel buttons. **CONFIRMED** |
| `packages/audio-module/src/engine/manager.ts` | `PlayerManager`: one `GuildPlaybackSession` per guild (`Map<guildId, session>`), and the entry point for internal-API admin actions (skip/stop/clearQueue/pause/resume/snapshots). **CONFIRMED** |
| `packages/audio-module/src/engine/session.ts` | `GuildPlaybackSession`: per-guild playback state — bounded queue, now-playing, history persistence, pause-aware elapsed clock, duration cutoff timer, consecutive-failure cutoff, skip/stop/destroy. **CONFIRMED** |
| `packages/audio-module/src/engine/queue.ts` | `PlaybackQueue`: bounded FIFO of `ResolvedTrack` (pure state, no I/O). **CONFIRMED** |
| `packages/audio-module/src/resolver/resolver.ts` | `AudioResolver`: validates URL (SSRF guards), routes to the first provider that claims it. **CONFIRMED** |
| `packages/audio-module/src/resolver/types.ts` | `AudioProvider`, `ResolveContext`, `ResolvedTrack` interfaces. **CONFIRMED** |
| `packages/audio-module/src/resolver/providers/ytdlp-provider.ts` | YouTube + SoundCloud (and other yt-dlp sites) → `-J` metadata, lazy `bestaudio/best` stream. **CONFIRMED** |
| `packages/audio-module/src/resolver/providers/spotify-provider.ts` | Spotify single tracks: oEmbed title → `ytsearch1:` on YouTube → lazy stream. **CONFIRMED** |
| `packages/audio-module/src/resolver/providers/direct-http.ts` | Catch-all for direct `http(s)` audio-file URLs; SSRF-safe lazy stream. **CONFIRMED** |
| `packages/audio-module/src/resolver/ytdlp-runner.ts` | Injectable wrapper around the `yt-dlp` binary (`json`/`stream`/`available`), with `COMMON_ARGS` and optional `--cookies`. **CONFIRMED** |
| `packages/audio-module/src/now-playing.ts` | Pure builder for the now-playing embed + control buttons + the Unicode progress bar; `customId` encode/parse. **CONFIRMED** |
| `packages/audio-module/src/testing/fakes.ts` | `FakeVoiceSession`/`FakeVoiceCapability`/`fakeTrack`/`fakePlaybackRepo` test doubles. **CONFIRMED** |
| `packages/discord-adapter/src/voice-session.ts` | The real `VoiceSession` (`@discordjs/voice`): ffmpeg transcode, pause/resume/stop, reconnect grace period, single-terminal-event contract. **CONFIRMED** |
| `packages/discord-adapter/src/adapter.ts` | Builds `VoiceCapability` per command (`buildVoiceCapability`, :412), holds its OWN `voiceSessions` map, routes button clicks to `component.interaction` (:214). **CONFIRMED** |
| `packages/config/src/index.ts` | `audio` config block + env vars. **CONFIRMED** |
| `packages/core/src/contracts/voice.ts` | `AudioStreamSource`, `PlaybackEvent`, `VoiceSession`, `VoiceCapability`. **CONFIRMED** |
| `packages/core/src/contracts/commands.ts` | `CommandContext`, `CommandDefinition`, `CommandOptionDef`. **CONFIRMED** |
| `packages/shared/src/types.ts` | `TrackSummary`, `QueueSnapshot`, `PlaybackStatus`, `MODULE_KEYS`. **CONFIRMED** |
| `docs/AUDIO_SOURCES.md` | Existing user-facing doc on sources, cookies, config. **CONFIRMED** |

## 3. Libraries used (by concern)

- **Discord voice connection**: `@discordjs/voice` — `joinVoiceChannel`,
  `createAudioPlayer`, `VoiceConnectionStatus`, `entersState`
  (`voice-session.ts:5-17`). **CONFIRMED**
- **Streaming audio / transcode**: `createAudioResource(stream, { inputType: StreamType.Arbitrary })` — `StreamType.Arbitrary` means **ffmpeg transcodes whatever bytes arrive** to Opus (`voice-session.ts:154-157`). ffmpeg/opus are external runtime deps shipped in the Docker images (see `docs/AUDIO_SOURCES.md`); not an npm import in this package. **CONFIRMED (StreamType.Arbitrary) / DEDUCED (ffmpeg comes from the Docker image, per AUDIO_SOURCES.md)**
- **YouTube/SoundCloud/Spotify extraction**: the external **`yt-dlp` binary**, spawned via `node:child_process` `execFile`/`spawn` (`ytdlp-runner.ts:1,48,82`). NOT a JS library (the comment at `ytdlp-runner.ts:8-13` explains ytdl-core/play-dl break too often). **CONFIRMED**
- **Spotify metadata**: Spotify public **oEmbed** endpoint fetched via `openSafeHttpStream` from `@botplatform/security` (`spotify-provider.ts:17,97`). **CONFIRMED**
- **Direct-file / oEmbed HTTP**: `openSafeHttpStream` and `validateExternalUrl` from `@botplatform/security` (SSRF guards). `docs/AUDIO_SOURCES.md` says undici underneath. **CONFIRMED (the security import) / DEDUCED (undici)**
- **Queue**: hand-rolled bounded FIFO (`queue.ts`), no library. **CONFIRMED**
- **Command handling**: the platform's own `CommandDefinition`/`CommandContext` abstraction (`packages/core/src/contracts/commands.ts`); the Discord adapter maps these to discord.js slash commands. **CONFIRMED**
- **Config/validation**: `zod` (`packages/config/src/index.ts:3`). **CONFIRMED**

## 4. Command catalog (what exists)

Registered by `buildAudioCommands` (`commands.ts:35-275`), returned in this
order: `join, leave, play, queue, skip, pause, resume, stop, nowplaying,
controls`. All are `guildOnly: true`. **CONFIRMED** (also asserted in
`commands.test.ts:98-107`).

Control buttons (panel), parsed by `parseAudioButton`
(`now-playing.ts:19-25`): `pause | resume | skip | stop | leave | refresh`,
encoded as `customId = "audio:<control>"` (`AUDIO_BUTTON_PREFIX = "audio:"`,
`now-playing.ts:11`). **CONFIRMED**

> Detailed per-command behavior and edge cases live in
> `docs/music/commands.md`.

## 5. YouTube `/play` flow — step by step

(See `docs/music/youtube-playback.md` for the deep version.)

1. `/play url:<link>` → `play.execute` `commands.ts:94`. Calls `ctx.defer()` first (`:95`) because resolution does network work. **CONFIRMED**
2. Voice readiness: if no live session, fetch the user's voice channel; if the user isn't in one, reply ephemeral "join a voice channel first" and return; otherwise `voice.join(channel.id)` (`commands.ts:99-107`). **CONFIRMED**
3. `resolver.resolve(rawUrl, resolveCtx)` (`commands.ts:112`):
   - `validateExternalUrl` (SSRF + allowlist) → throws `UserFacingError` on failure (`resolver.ts:14-19`). **CONFIRMED**
   - first provider whose `canResolve(url)` is true wins; for `youtube.com`/`youtu.be`/`music.youtube.com`/`m.youtube.com` that is `YtDlpAudioProvider` (`ytdlp-provider.ts:43-52`). **CONFIRMED**
   - provider runs `yt-dlp -J -- <url>` (plus `COMMON_ARGS`) and parses JSON (`ytdlp-provider.ts:55-58`, `ytdlp-runner.ts:48-79`). **CONFIRMED**
   - rejects `is_live` (`ytdlp-provider.ts:60-62`) and rejects `duration > maxTrackDurationSeconds` **before queueing** (`ytdlp-provider.ts:63-72`). **CONFIRMED**
   - builds `TrackSummary` (title/url/provider/durationSeconds) + a **lazy** `source.createStream` that spawns `yt-dlp -f bestaudio/best -o - -- <url>` (`ytdlp-provider.ts:74-97`). The download does NOT start at resolve time (asserted `ytdlp-provider.test.ts:65-69`). **CONFIRMED**
4. Command tags the resolved track with `requestedBy = ctx.user.displayName` (`commands.ts:113-116`). **CONFIRMED**
5. `manager.ensureSession(guildId, active)` → `session.enqueueOrPlay(track)` (`commands.ts:118-119`).
   - if nothing playing → `playNow()` → status `"playing"`; else enqueue → status `"queued"` with 1-based position (`session.ts:67-80`). **CONFIRMED**
6. `playNow()` (`session.ts:178-205`): writes a history "started" row best-effort, then `voiceRef.play(source, handleEvent)`. The adapter calls `source.createStream()` (yt-dlp spawns now), wraps it in `StreamType.Arbitrary` (ffmpeg), plays, and waits up to 15s for `Playing` (`voice-session.ts:131-175`). On success, resets the pause-aware clock and arms the duration timer. **CONFIRMED**
7. Reply: if playing and `ctx.replyRich` exists → render the now-playing panel (`commands.ts:122-127`); if queued → "Queued (#n): **title**" (`commands.ts:128-130`). **CONFIRMED**

## 6. Feature inventory (exists? how?)

| Feature | Exists | How |
|---------|:------:|-----|
| **Queue** | Yes | Bounded FIFO `PlaybackQueue` (`queue.ts`), `maxQueueSize` (default 50). `enqueueOrPlay` plays immediately when idle else enqueues; overflow throws `UserFacingError('QUEUE_FULL')` (`session.ts:74-77`). **CONFIRMED** |
| **Skip** | Yes | `session.skip()` (`session.ts:83-102`): marks history `skipped`, intentional stop (suppresses the resulting `finished`), dequeues next and plays it. `/skip` and the ⏭ button both route here. **CONFIRMED** |
| **Stop** | Yes | `session.stop()` (`session.ts:105-116`): marks history `stopped`, suppresses finish, clears queue, resets failure counter. **Keeps the voice connection.** **CONFIRMED** |
| **Pause/Resume** | Yes | `session.pause()/resume()` (`session.ts:125-142`) delegate to `voiceRef.pause()/resume()` and freeze/restart the elapsed clock. Real impl `voice-session.ts:177-188`. **CONFIRMED** |
| **Now-playing** | Yes | Pure panel builder `buildNowPlayingPanel` (`now-playing.ts:55-112`): embed with Unicode progress bar, source, requester, up-next (first 3), command hints, contextual buttons. Elapsed via pause-aware `getElapsedSeconds()` (`session.ts:37-42`). **CONFIRMED** |
| **Error handling** | Yes | Provider errors → safe `UserFacingError` (`resolver.ts:26-34`, `ytdlp-runner.ts:55-78`); raw stderr/stack never reaches users (`safeErrorSummary`, `session.ts:308-311`). Per-track playback error → history `failed`, increment failure counter, advance (`session.ts:225-239`). 3 consecutive failures clears the queue (`MAX_CONSECUTIVE_FAILURES=3`, `session.ts:17,230-238,243-247`). **CONFIRMED** |
| **Duration enforcement** | Yes | Two layers: (a) provider rejects known `duration > limit` pre-queue (`ytdlp-provider.ts:63-72`, `spotify-provider.ts:64-73`); (b) runtime watchdog `armDurationTimer()` force-skips at `maxTrackDurationSeconds` (`session.ts:266-277`), covering unknown-duration streams. **CONFIRMED** |
| **Reconnect logic** | Yes (adapter layer) | `DiscordVoiceSession.handleDisconnected()` (`voice-session.ts:223-240`): on `Disconnected`, races 5s for `Signalling`/`Connecting`; success keeps the session (e.g. channel move), failure destroys it. Session layer has NONE — it relies on the adapter. **CONFIRMED** |
| **Cleanup on disconnect** | Yes | Adapter: `handleDestroyed()` settles the in-flight play as an `error` event, stops the player, and calls `onDestroyed` which removes the session from the adapter's map (`voice-session.ts:242-250`, `adapter.ts:456-460`). Module: `PlayerManager.destroySession`/`destroyAll` → `session.destroy()` clears timer, finishes history, clears queue, disconnects voice (`manager.ts:42-54`, `session.ts:157-174`). `onShutdown` calls `destroyAll` (`index.ts:95-97`). yt-dlp child dies when its stdout closes (`ytdlp-runner.ts:107-111`). **CONFIRMED** |
| **Persistence** | Yes (best-effort) | `PlaybackRepo` (nullable): history rows on start/finish + a queue mirror via `replaceQueue`. All writes are fire-and-forget `void …catch` — a DB outage must never interrupt audio (`session.ts:181-190,286-304`; test `session.test.ts:169-175`). **CONFIRMED** |
| **Internal-API admin actions** | Yes | `PlayerManager.skip/stop/clearQueue/pause/resume/getSnapshots` return `InternalActionResult`; surfaced through `AudioModuleHandle` (`index.ts:23-29,100-106`) for the bot's internal HTTP API (no command context). **CONFIRMED (handle) / DEDUCED (consumed by an internal HTTP route — not read here)** |

## 7. Current limitations

- **Single track per `/play`** — `play` takes one `url` and resolves to exactly ONE `ResolvedTrack`; there is no playlist/album expansion. `yt-dlp` is forced single via `--no-playlist` in `COMMON_ARGS` (`ytdlp-runner.ts:27`). **CONFIRMED**
- **Spotify** = single tracks only; albums/playlists rejected by `canResolve` requiring `/track/` (`spotify-provider.ts:42-44`). Plays the closest **YouTube** match, not Spotify audio (DRM). **CONFIRMED**
- **No live streams** — `is_live` rejected (`ytdlp-provider.ts:60-62`); unknown-duration streams still get force-skipped at the max-duration watchdog. **CONFIRMED**
- **No "radio"/autoplay/recommendations**, no search-by-text command (only the Spotify path uses `ytsearch1:` internally), no shuffle, no loop/repeat, no remove-at-index, no volume control, no seek. **CONFIRMED (absence — no such command/method exists)**
- **No max-track-duration override per request** — it's a single global `MAX_TRACK_DURATION_SECONDS` (default 3600). **CONFIRMED**
- **Queue display capped** at 10 in `/queue` (`QUEUE_DISPLAY_LIMIT`, `commands.ts:19,152-158`) and 3 in the panel's "Up next" (`now-playing.ts:84-89`). **CONFIRMED**
- **State is in-memory** — the queue mirror/history in the DB is for display/audit, NOT for restoring playback after a bot restart (nothing reads the mirror back into a session here). **DEDUCED** (no read-back path in the module; `getQueue` exists on the repo but is unused by the session — see `fakes.ts:150`).
- **No per-guild concurrency cap** beyond one session per guild; no global cap on simultaneous yt-dlp processes. **DEDUCED**

## 8. FRAGILE zones (where edits can break the bot)

1. **Single-terminal-event contract** — `voice-session.ts:60-99,207-214` and `session.ts:207-240`. The engine assumes per `play()` call exactly ONE of `finished`/`error` fires, after one `started`. `finishCurrent` uses a `settled` latch; the session uses `suppressNextFinish`. Emitting twice, or forgetting to settle before `player.stop(true)`, causes a **spurious `advance()`** (double-skip / wrong track). The ordering comments at `voice-session.ts:95-99,245-247` are load-bearing. **CONFIRMED**

2. **`suppressNextFinish` flag** (`session.ts:30-31,210-213,258-263`). `beginIntentionalStop()` sets it then calls `voiceRef.stop()`, expecting the resulting `finished` to be swallowed. If a code path calls `stop()` without setting the flag (or sets it but no event arrives), you get either a double-advance or a stuck-armed flag that swallows the NEXT real finish. **CONFIRMED**

3. **`--no-playlist` in `COMMON_ARGS`** (`ytdlp-runner.ts:27`). It is applied to BOTH `json()` and `stream()` (via `baseArgs`, `ytdlp-runner.ts:43-45,52,82`). A future "playlist" feature that just removes this flag will change the shape of `-J` output (yt-dlp emits a playlist object with `entries[]`), which `ytdlp-provider.resolve` does NOT handle (it reads top-level `title/duration`, `ytdlp-provider.ts:55-79`). Removing the flag naively breaks single-track resolution too. **CONFIRMED**

4. **Two separate session maps** — `PlayerManager.sessions` (`manager.ts:12`) and the adapter's `this.voiceSessions` (`adapter.ts:429,438,446,457-462`). They are kept loosely in sync via `ensureSession`/`attachVoice`. `/leave` deletes from BOTH paths defensively (`commands.ts:67-79`). If a connection drops, the adapter removes its entry via `onDestroyed` but the **`PlayerManager` is not notified** — its `GuildPlaybackSession` keeps a stale `voiceRef` whose `destroyed === true`. Most methods tolerate this (they check `destroyed`/`status`), but it is a real drift risk for any new feature that assumes the two maps agree. **CONFIRMED (the two maps + no manager-side onDestroyed) / DEDUCED (the drift consequence)**

5. **Duration watchdog vs. event race** (`session.ts:215,266-277`). `armDurationTimer` calls `void this.skip()`. `handleEvent` clears the timer on any terminal event. If a track finishes within milliseconds of the timeout, both could fire; correctness relies on `nowPlaying` being nulled and `suppressNextFinish` ordering. The timer is `unref()`'d (`session.ts:276`) so it won't keep the process alive — do not remove that. **CONFIRMED**

6. **Failure-counter reset semantics** (`session.ts:194-196,217-219`). The counter resets ONLY on a genuine `finished` event, NOT on a successful start (explicit NOTE at `session.ts:194-196`). A change that resets on start would defeat the 3-strikes cutoff and could loop forever on a stream that starts then immediately errors. **CONFIRMED**

7. **Lazy stream / child-process lifecycle** (`ytdlp-runner.ts:81-114`). The yt-dlp child is killed when its `stdout` closes (`:107-111`). If a future change buffers/clones the stream or detaches stdout, the child can leak (zombie yt-dlp processes). The `child.on('error')` handler destroys stdout with a `UserFacingError` so the adapter sees a clean failure — keep that wiring. **CONFIRMED**

8. **SSRF boundary** (`resolver.ts:14-19`, `direct-http.ts:30-37`, `spotify-provider.ts:97-101`). `validateExternalUrl`/`openSafeHttpStream` from `@botplatform/security` are the only guard against internal-network fetches. Any new provider that fetches a URL MUST go through these, not raw `fetch`/`undici`. **CONFIRMED**

9. **`replyRich` optionality** (`commands.ts:122-127,241-244,264-266`). Every panel render is guarded by `if (ctx.replyRich)` with a plain-text fallback. A new command that assumes `replyRich` is always present will crash on adapters without rich replies. **CONFIRMED**

10. **`enableStreamingSources` gate** (`index.ts:39-49`). When false, the yt-dlp/Spotify providers are NOT registered and only `DirectHttpAudioProvider` remains; a YouTube link then falls through to `URL_UNSUPPORTED`/SSRF rejection. New features must not assume the yt-dlp providers always exist. **CONFIRMED**

## 9. Config knobs (audio block, `packages/config/src/index.ts`)

| Env var | Field | Default | Meaning | Line |
|---------|-------|---------|---------|------|
| `ALLOWED_AUDIO_DOMAINS` | `audio.allowedDomains` | `[]` (any public) | CSV host allowlist for input URLs | :44,163 |
| `MAX_QUEUE_SIZE` | `audio.maxQueueSize` | 50 (1–1000) | bounded queue size | :45,165 |
| `MAX_TRACK_DURATION_SECONDS` | `audio.maxTrackDurationSeconds` | 3600 | pre-queue reject + runtime watchdog | :46,165 |
| `AUDIO_REQUEST_TIMEOUT_MS` | `audio.requestTimeoutMs` | 15000 | metadata/stream-setup timeout | :47,166 |
| `AUDIO_ENABLE_STREAMING_SOURCES` | `audio.enableStreamingSources` | true | register yt-dlp/Spotify providers | :48-52,167 |
| `YTDLP_PATH` | `audio.ytdlpPath` | `yt-dlp` | binary path/command | :53,168 |
| `YTDLP_COOKIES_FILE` | `audio.ytdlpCookiesFile` | `''` | cookies.txt for private/age-restricted YouTube | :54-59,169 |

**CONFIRMED** (all read directly).

---

## Checkpoint

**Status: PASS**

### Modificări făcute
- Niciuna în cod (rol READ-ONLY). Am scris doar fișiere de documentație:
  - `docs/agent-memory/music/01-current-music-system-analysis.md` (acest fișier)
  - `docs/music/music-system-overview.md`
  - `docs/music/youtube-playback.md`
  - `docs/music/commands.md`

### Comenzi rulate
- `find` pentru localizarea fișierelor de test și a lui `fakes.ts` (glob-ul inițial nu a prins căile). Nicio comandă de build/test/docker (interzise de brief).

### Validat efectiv (citit direct în cod)
- Toate cele 17 fișiere cerute + `discord-adapter/src/voice-session.ts` și secțiunea relevantă din `adapter.ts` (stratul voce/ffmpeg/reconnect).
- Cele 10 comenzi + cele 6 butoane; ordinea și `guildOnly` confirmate și de `commands.test.ts:98-107`.
- `--no-playlist` în `COMMON_ARGS` (`ytdlp-runner.ts:27`); metadata `-J`; stream lazy.
- `armDurationTimer` la `session.ts:266`; reject duratei la `ytdlp-provider.ts:63-72`; `MAX_CONSECUTIVE_FAILURES=3` la `session.ts:17`.
- `progressBar` afișează `🔴 LIVE / streaming` când durata e 0/necunoscută (`now-playing.ts:34-35`).
- Faptele orchestratorului — toate confirmate (vezi mai jos).

### Nevalidat (marcat DEDUCED în text)
- Faptul că ffmpeg vine din imaginea Docker (dedus din `StreamType.Arbitrary` + `docs/AUDIO_SOURCES.md`, nu citit dintr-un Dockerfile aici).
- Că `openSafeHttpStream` folosește undici (dedus din doc).
- Consumatorul intern HTTP al `AudioModuleHandle` (skip/stop/clearQueue) — nu am citit ruta API.
- Lipsa restaurării cozii după restart (dedus din absența unui read-back al `getQueue`).

### Probleme găsite
- **Drift între cele două hărți de sesiuni**: `PlayerManager.sessions` vs `adapter.voiceSessions`. La pierderea conexiunii, adapter-ul curăță prin `onDestroyed`, dar `PlayerManager` NU e notificat → `GuildPlaybackSession` rămâne cu un `voiceRef` cu `destroyed === true`. Tolerat azi, dar risc real pentru feature-uri noi. (`manager.ts:12`, `adapter.ts:456-462`)
- Eliminarea naivă a lui `--no-playlist` ar strica și rezolvarea single-track (forma `-J` se schimbă în obiect playlist cu `entries[]`, netratat de `ytdlp-provider.resolve`).

### Contradicții cu faptele orchestratorului
- Niciuna. Toate cele patru fapte sunt confirmate, cu o singură precizare de nuanță:
  - "duration timer force-skips ~line 266" — corect, `armDurationTimer` e la `session.ts:266`.
  - "provider rejects duration > max ~ytdlp-provider.ts:67" — corect; verificarea efectivă e la `:67`, mesajul `TRACK_TOO_LONG` la `:68-71`.
  - Notă: enforcement-ul duratei există în DOUĂ locuri (provider pre-queue ȘI watchdog runtime), iar transcodarea ffmpeg (`StreamType.Arbitrary`) e în `discord-adapter/src/voice-session.ts`, NU în `audio-module` — important pentru agenții următori.

### Următoarea etapă poate continua?
**DA.** Sistemul curent este complet cartografiat, cu zonele fragile marcate `file:line`. Agenții următori (playlist / long-track / radio) au punctele de extensie clare: interfața `AudioProvider` (`resolver/types.ts`), `--no-playlist` în `ytdlp-runner.ts`, și `enqueueOrPlay`/`PlaybackQueue` pentru cozi multiple.
