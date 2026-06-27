# Music System — Architecture Overview

This document explains how the audio-player feature is put together: from a
slash command, through the playback engine, down to the voice connection and
back up to the visual now-playing panel. It is the map; the deep-dives live in
`youtube-playback.md` and `commands.md`.

## Packages involved

| Package | Responsibility |
|---------|----------------|
| `packages/audio-module` | The whole music feature: commands, playback engine (manager + session + queue), resolver + providers, now-playing panel. Adapter-agnostic. |
| `packages/discord-adapter` | The real voice transport (`@discordjs/voice` + ffmpeg transcode), and the per-command `VoiceCapability`. Maps platform commands ↔ Discord slash commands and buttons. |
| `packages/core` | The contracts both sides agree on: `VoiceSession`, `VoiceCapability`, `AudioStreamSource`, `CommandContext`, `CommandDefinition`. |
| `packages/shared` | Shared value types: `TrackSummary`, `QueueSnapshot`, `PlaybackStatus`, module keys. |
| `packages/security` | SSRF-safe URL validation and HTTP streaming (`validateExternalUrl`, `openSafeHttpStream`). |
| `packages/config` | The `audio` config block + env vars. |
| `packages/database` | `PlaybackRepo` — best-effort history + queue mirror. |

The audio module **never imports `@discordjs/voice`**. It talks only to the
`VoiceSession`/`VoiceCapability` interfaces, which is why the engine is fully
unit-testable with fakes (`packages/audio-module/src/testing/fakes.ts`).

## Layered flow

```
 Discord slash command / button click
            │
            ▼
 ┌───────────────────────────────────────────────┐
 │ discord-adapter (adapter.ts)                   │
 │  • builds CommandContext (+ replyRich)         │
 │  • builds VoiceCapability per invocation       │
 │  • routes button clicks → component.interaction│
 └───────────────────────────────────────────────┘
            │ CommandContext / ComponentInteractionEvent
            ▼
 ┌───────────────────────────────────────────────┐
 │ audio-module commands.ts                       │
 │  • 10 slash commands                           │
 │  • buildAudioComponentHandler (panel buttons)  │
 └───────────────────────────────────────────────┘
       │ resolve(url)                 │ ensureSession / actions
       ▼                              ▼
 ┌──────────────────┐        ┌─────────────────────────────────┐
 │ AudioResolver    │        │ PlayerManager (manager.ts)      │
 │  resolver.ts     │        │  Map<guildId, GuildPlaybackSession>
 │   • SSRF guard   │        └─────────────────────────────────┘
 │   • pick provider│                    │
 └──────────────────┘                    ▼
       │                        ┌─────────────────────────────┐
       ▼                        │ GuildPlaybackSession        │
 ┌──────────────────┐          │  session.ts                 │
 │ Providers        │          │   • PlaybackQueue (FIFO)    │
 │  yt-dlp ─────────┼──┐       │   • nowPlaying + elapsed    │
 │  spotify         │  │       │   • duration watchdog       │
 │  direct-http     │  │       │   • failure cutoff (3)      │
 └──────────────────┘  │       │   • history persistence     │
                       │       └─────────────────────────────┘
            ResolvedTrack (lazy source)        │ voiceRef.play(source, onEvent)
                       │                        ▼
                       │              ┌─────────────────────────────┐
                       └─────────────▶│ DiscordVoiceSession         │
                                      │  voice-session.ts           │
                                      │   • createStream() (spawns) │
                                      │   • ffmpeg transcode        │
                                      │     (StreamType.Arbitrary)  │
                                      │   • reconnect grace period  │
                                      │   • finished/error (once)   │
                                      └─────────────────────────────┘
                                                  │
                                                  ▼
                                            Discord voice channel
```

## The four sub-systems

### 1. Command handler → manager → session → queue
- **Commands** (`commands.ts`) validate the invocation (in a guild? voice
  available?), then either resolve+enqueue (`/play`) or call a session/manager
  action (`/skip`, `/pause`, …).
- **`PlayerManager`** (`manager.ts`) owns exactly **one `GuildPlaybackSession`
  per guild** in a `Map`, and is also the entry point for admin actions over
  the bot's internal API (no command context there): `skip/stop/clearQueue/
  pause/resume/getSnapshots`.
- **`GuildPlaybackSession`** (`session.ts`) is the heart: it holds the queue
  and the now-playing track, drives the voice session, runs the duration
  watchdog and the consecutive-failure cutoff, tracks pause-aware elapsed time,
  and mirrors state to the database best-effort.
- **`PlaybackQueue`** (`queue.ts`) is a pure bounded FIFO — no I/O, trivially
  testable.

### 2. Resolver → providers
- **`AudioResolver`** (`resolver.ts`) runs the SSRF/allowlist check, then asks
  each provider `canResolve(url)` and uses the **first** that claims it.
- **Provider order matters** (`index.ts`): platform resolvers first
  (`YtDlpAudioProvider` for YouTube/SoundCloud, `SpotifyAudioProvider` for
  Spotify tracks), then `DirectHttpAudioProvider` as the catch-all for any
  other `http(s)` URL.
- The yt-dlp/Spotify providers are only registered when
  `AUDIO_ENABLE_STREAMING_SOURCES=true`.
- Every provider returns a `ResolvedTrack` = `{ metadata, source }` where
  `source.createStream()` is **lazy**: a queued item holds no sockets or
  processes; the download/fetch starts only when playback begins.

### 3. Now-playing panel
- `now-playing.ts` is a **pure** builder. `buildNowPlayingPanel(snapshot)`
  produces an embed (Unicode progress bar, source, requester, up-next, command
  hints) plus a row of buttons (⏸/▶ contextual · ⏭ · ⏹ · 👋 · 🔄).
- Buttons encode `customId = "audio:<control>"`. Clicks arrive back as a
  `component.interaction` event handled by `buildAudioComponentHandler`
  (`commands.ts`), which performs the action via the manager and **refreshes
  the panel in place** (`event.update`) or replies with the result text.
- `/play` (on start), `/nowplaying`, and `/controls` all render the same panel;
  each falls back to plain text when the adapter lacks `replyRich`.

### 4. Persistence (best-effort)
- `PlaybackRepo` is **nullable** (null disables persistence — used in tests).
- On play start → `startHistoryEntry`; on each terminal state →
  `finishHistoryEntry(completed|skipped|failed|stopped)`; queue changes →
  `replaceQueue` (a display/audit mirror).
- All writes are fire-and-forget (`void … .catch`). **A database outage must
  never interrupt audio** — verified by tests.
- Note: the queue mirror is **not** read back to restore playback after a
  restart; in-memory state is the source of truth at runtime.

## Config knobs

See `packages/config/src/index.ts` (`audio` block) and `docs/AUDIO_SOURCES.md`:

- `AUDIO_ENABLE_STREAMING_SOURCES` (default `true`) — register the yt-dlp /
  Spotify providers; `false` = direct audio links only.
- `MAX_QUEUE_SIZE` (50), `MAX_TRACK_DURATION_SECONDS` (3600),
  `AUDIO_REQUEST_TIMEOUT_MS` (15000).
- `ALLOWED_AUDIO_DOMAINS` (empty = any public host) — input-URL allowlist.
- `YTDLP_PATH` (`yt-dlp`), `YTDLP_COOKIES_FILE` (empty) — cookies enable
  private/age-restricted YouTube.

## Extension points (for future work)

- New source → implement `AudioProvider` (`resolver/types.ts`) and prepend it
  to the list in `index.ts`. Video and a dedicated resolver microservice are
  additive from here.
- Multi-track / playlists → see `youtube-playback.md` and `commands.md`
  ("Planned") — the `--no-playlist` flag in `ytdlp-runner.ts` and the
  single-track shape of `ytdlp-provider.resolve` are the things to change.
