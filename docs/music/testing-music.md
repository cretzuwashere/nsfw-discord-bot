# Testing the Music System

How the music feature is tested, what is covered automatically, and what needs
manual/live testing.

The music engine is built to be **fully unit-testable with no network**: it talks
only to the `VoiceSession`/`VoiceCapability` interfaces and an injectable
`YtDlpRunner`, so every code path can be exercised with in-memory fakes
(`packages/audio-module/src/testing/fakes.ts`). At the time of writing the
audio-module has **10 unit-test files** (`packages/audio-module/src/**/*.test.ts`)
covering commands, the engine, the resolver/providers, the now-playing panel, the
YouTube URL classifier and the radio command/registry.

## Running the tests (in Docker)

Tests run from the repo root via Vitest. The root `package.json` defines the
scripts; there is **no per-package `test` script** in `@botplatform/audio-module`
(the audio-module's `*.test.ts` files are picked up by the root `unit` project,
`vitest.config.ts`).

```bash
# All unit + integration tests
docker compose exec app pnpm test

# Unit tests only (where ALL audio-module tests live — no DB, no network)
docker compose exec app pnpm test:unit

# Integration tests only (these need the Postgres service; audio's DB-backed
# PlaybackRepo is exercised in packages/database/tests/integration/playback.test.ts)
docker compose exec app pnpm test:integration

# Static checks
docker compose exec app pnpm typecheck
docker compose exec app pnpm lint
docker compose exec app pnpm build
```

To run **only the audio-module** unit tests, pass a path filter to the unit
project:

```bash
docker compose exec app pnpm test:unit -- packages/audio-module
```

> Note: `pnpm --filter @botplatform/audio-module test` does **not** work — the
> package has no `test` script. Use the root scripts above.

## The unit-test seams (no network)

Everything that would touch the network or Discord is behind an interface with a
fake double in `src/testing/fakes.ts`:

| Seam | Fake | What it lets you test without I/O |
|---|---|---|
| `YtDlpRunner` interface (`resolver/ytdlp-runner.ts:33-45`) | `FakeYtDlpRunner` | Provider resolution & playlist expansion. Set `jsonResult` / `flatPlaylistResult` (or `jsonShouldFail` / `flatPlaylistShouldFail` / `isAvailable`). `streamCalls` records every `stream()` invocation, so the **lazy-open** contract (no stream opened until playback) can be asserted. |
| `VoiceSession` (`@botplatform/core`) | `FakeVoiceSession` | The session/queue engine. Drive playback events with `emitFinished()` / `emitError()`; fail the next N `play()` calls with `playShouldFail`; `playCalls` records sources. Mirrors the real adapter (e.g. `stop()` surfaces a `finished` event). |
| `VoiceCapability` (`@botplatform/core`) | `FakeVoiceCapability` | Command handlers' join/active-session logic. `userChannel`, `activeSession`, `joinCalls`. |
| `PlaybackRepo` (`@botplatform/database`) | `fakePlaybackRepo()` | History + queue-mirror persistence. Inspect recorded `history` and `queues`; pass `{ throwing: true }` to simulate a dead database and prove a DB hiccup never interrupts audio. |
| `fakeTrack(title)` | helper | A ready-made `ResolvedTrack` with an in-memory stream. |

Because of these seams, the unit tests cover the full logic: URL classification,
single-track and playlist resolution, the duration cap (including
`maxTrackDurationSeconds: 0`), the queue bound, skip/stop/pause/resume, the
consecutive-failure cutoff, the now-playing panel, the radio registry/matching,
and the radio takeover — all deterministically and offline.

## Covered automatically vs. manual/live

**Covered by the automated unit/integration suite:**

- URL classification (`youtube-url.test.ts`) — video vs. playlist vs.
  video-in-playlist vs. Mix (`RD…`) vs. album (`OLAK…`).
- `resolvePlaylist` forwards the cap to yt-dlp as `--playlist-end`
  (`ytdlp-provider.test.ts`) so endless Mixes stay bounded.
- Mix detection `isMixList` (`youtube-url.test.ts`), the mix buffer
  (`session.test.ts` — add/cap/clear), and the mix panel + buttons + component
  handler (`mix-panel.test.ts`), plus the `/play` mix path (`commands.test.ts`).
- Single-track and playlist resolution, duration reject, `0 = unlimited`
  (`ytdlp-provider.test.ts`, `spotify-provider.test.ts`, `resolver.test.ts`).
- Queue bound, FIFO, enqueueMany overflow (`queue.test.ts`).
- Session: play/queue/skip/stop, advance-on-finish, advance-on-error, the
  3-consecutive-failure cutoff, history + queue-mirror writes (and the
  DB-throwing case) (`session.test.ts`).
- Command handlers and the button handler (`commands.test.ts`,
  `now-playing.test.ts`).
- Radio command, registry matching, select-menu plumbing
  (`radio/commands.test.ts`, `radio/registry.test.ts`).
- DB-backed `PlaybackRepo` against real Postgres
  (`packages/database/tests/integration/playback.test.ts`).

**Needs MANUAL / live testing (not in CI):**

- **Real Discord voice** — actually hearing audio in a channel (the voice
  transport + ffmpeg transcode live in `packages/discord-adapter` and are mocked
  in unit tests).
- **Real yt-dlp extraction** — that YouTube/SoundCloud/Spotify links resolve and
  stream against the live internet. There is a live smoke script:
  `docker compose exec app bash -lc "cd packages/audio-module && pnpm exec tsx
  scripts/check-streaming.ts"` (`packages/audio-module/scripts/check-streaming.ts`)
  — it runs the real provider + runner + ffmpeg chain.
- **Live radio reachability** — that each station's `streamUrl` is up and serves
  audio ffmpeg can play.
- **Discord select-menu round-trip** — clicking the `/radio list` menu and the
  now-playing buttons in a real client.

## Manual smoke checklist

Run these in a real server after a deploy:

1. **Single play** — `/play <single YouTube/SoundCloud/Spotify/direct link>`
   starts and the now-playing panel appears.
2. **Pure playlist via `/play`** — `/play <youtube.com/playlist?list=…>`
   auto-expands and reports "Added N of M…".
3. **Video-in-playlist via `/play`** — `/play <watch?v=…&list=…>` starts the
   chosen video and then loads the rest of the playlist behind it (check
   `/queue`). `/playlist <watch?v=…&list=…>` loads the whole list from the top
   instead.
3b. **YouTube Mix/Radio (`list=RD…`)** — `/play <watch?v=ID&list=RDID>` plays the
   seed, queues `MIX_DEFAULT_ITEMS` (default 10), and posts the **mix panel**.
   Click `+10` / `Add all` to queue more, `🗑️ Clear queue` for fewer; confirm the
   queue grows/shrinks. (Verified end-to-end: the seed link fetched 50, filtered
   the seed → queued 10, buffered 39.)
4. **Long track with `MAX_TRACK_DURATION_SECONDS=0`** — a multi-hour link plays
   without a "too long" reject and is not force-skipped.
5. **`/radio list` → select** — the embed + dropdown appear; selecting a station
   plays it (bot already connected).
6. **`/radio play <station>`** — joins voice and takes over playback as LIVE.
7. **Skip/stop during a long track** — `/skip` and `/stop` (and the panel
   buttons) take effect immediately.
8. **Radio takeover of an existing queue** — queue a few tracks, then
   `/radio play …`; the queue is cleared and the station plays.
