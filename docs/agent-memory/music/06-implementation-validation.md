# Agent 6 — Implementation & Validation

> Incremental implementation of the music extension, with the brief's per-stage
> checkpoint blocks. All validation ran inside the live dev container
> (`docker compose exec -T app …`). Stages 1–3 share files (playlists +
> long-track + seams) and were validated together; Stage 4 (radio) separately;
> then a full regression (Agent 7).

## Files changed

**New**
- `packages/audio-module/src/resolver/youtube-url.ts` (+ `youtube-url.test.ts`)
- `packages/audio-module/src/radio/stations.ts`
- `packages/audio-module/src/radio/registry.ts` (+ `registry.test.ts`)
- `packages/audio-module/src/radio/radio-source.ts`
- `packages/audio-module/src/radio/commands.ts` (+ `commands.test.ts`)

**Modified**
- `resolver/types.ts` — `ResolvedTrack.isLive`, `PlaylistResolution`, optional `AudioProvider.resolvePlaylist`.
- `resolver/ytdlp-runner.ts` — `FlatPlaylist`/`FlatPlaylistEntry`, `flatPlaylist()` (overrides `--no-playlist`), `STREAM_ROBUSTNESS_ARGS` (retries on the stream path only).
- `resolver/providers/ytdlp-provider.ts` — `resolvePlaylist()` (flat-list → lazy per-item tracks, `entryUrl`/`isUnavailable` helpers), `0 = unlimited` duration guard, `streamSource()` refactor.
- `resolver/providers/spotify-provider.ts` — `0 = unlimited` duration guard (3rd reject site).
- `resolver/resolver.ts` — `resolvePlaylist()` routing (keeps `resolve()` intact).
- `engine/queue.ts` — `enqueueMany()`.
- `engine/session.ts` — `enqueueMany()`; `armDurationTimer()` exits early when limit ≤ 0 or track `isLive`.
- `commands.ts` — `/play` classifies the URL (pure playlist auto-expands; video-in-playlist plays the single video); new `/playlist`; `ensureActiveSession()`/`enqueuePlaylist()` helpers; `maxPlaylistItems` dep.
- `index.ts` — `RadioRegistry`, `/radio` command, combined `audio:`+`radio:` component handler, extracted `resolveCtx`, new public exports.
- `testing/fakes.ts` — `FakeYtDlpRunner`.
- `packages/config/src/index.ts` — `MAX_PLAYLIST_ITEMS` (default 100); `MAX_TRACK_DURATION_SECONDS` zod `min(1)→min(0)`; `audio.maxPlaylistItems`.
- `.env.example` — `MAX_PLAYLIST_ITEMS` + `0 = unlimited` note.
- Tests updated: `commands.test.ts`, `config.test.ts`, `resolver.test.ts`, `engine/session.test.ts`, `resolver/providers/{ytdlp,spotify}-provider.test.ts`.

---

## Checkpoint — Stage 1+2 (seams + YouTube playlists)

Status: PASS

### Modificări făcute
- Added a non-breaking playlist path: `flatPlaylist()` runner method, `classifyYouTubeUrl()`, provider `resolvePlaylist()` (lazy per-item streams), resolver `resolvePlaylist()` routing, `queue.enqueueMany()` + `session.enqueueMany()`, `/playlist` command + `/play` auto-expand, `MAX_PLAYLIST_ITEMS` config, `FakeYtDlpRunner`.
- Single-video `play` path left byte-for-byte equivalent (separate code path).

### Comenzi rulate
- `pnpm --filter @botplatform/audio-module --filter @botplatform/config run typecheck` → Done.
- `pnpm vitest run --project unit packages/audio-module packages/config` → 106 passed.

### Validat efectiv
- Single-video play unchanged (existing `/play` tests green).
- Playlist: normal expand, empty, unavailable items skipped, > limit capped, partial counts — covered by unit tests with `FakeYtDlpRunner`.
- `classifyYouTubeUrl`: video / playlist / video-in-playlist / auto-mix(RD) / not-youtube.

### Nevalidat
- Real `yt-dlp --flat-playlist` JSON field names (`url`/`id`/`availability`) against the pinned binary — handled defensively (multiple URL fallbacks; conservative unavailable filter), but DEDUCED until exercised against a real playlist.
- Actual Discord enqueue of a large playlist (needs voice + network).

### Probleme găsite
- A second `fakeRunner` in `spotify-provider.test.ts` needed the new `flatPlaylist` method (fixed). No product bug.

### Următoarea etapă poate continua?
Da.

---

## Checkpoint — Stage 3 (long-track playback)

Status: PASS

### Modificări făcute
- `0 = unlimited` semantics in all three reject sites (yt-dlp + Spotify providers + the session watchdog) and the zod schema (`min(0)`).
- Stream-path resilience (`--retries 10 --fragment-retries 10 --retry-sleep 3`), finite so a dead source still ends.
- Watchdog also exempts `isLive` tracks (shared with radio).

### Comenzi rulate
- (folded into the Stage 1+2 typecheck/test run above; both green).

### Validat efectiv
- Watchdog NOT armed when limit = 0 (advanced fake timers ~2.7h, still playing) or when track is live.
- Watchdog STILL fires at a positive limit (existing test green).
- Provider does NOT reject an over-limit track when limit = 0.
- skip/stop still clear the timer (existing tests green).

### Nevalidat
- A genuinely multi-hour real stream surviving for hours (needs live network + voice). The retry flags are configured but not exercised end-to-end.

### Probleme găsite
- The per-guild `guild_settings.maxTrackDurationSeconds` column is dormant (global config only). Left as roadmap, not wired (scope).

### Următoarea etapă poate continua?
Da.

---

## Checkpoint — Stage 4 (online radio)

Status: PASS

### Modificări făcute
- Configurable station source (`radio/stations.ts`) behind `RadioRegistry` — NOT hardcoded in any command handler.
- `buildRadioTrack()` builds a live track via the SSRF-safe opener (exempt from the watchdog; renders as LIVE).
- `/radio` command (`list`/`play`/`stop`/`nowplaying`) + a `radio:` station select menu; combined component handler dispatches `audio:`/`radio:` by prefix.
- 8 curated SomaFM direct-MP3 stations as the default set.

### Comenzi rulate
- `pnpm --filter @botplatform/audio-module run typecheck` → Done (after annotating the combined handler param as `ComponentInteractionEvent`).
- `pnpm vitest run --project unit packages/audio-module` → 120 passed (10 files).

### Validat efectiv
- Registry: list (enabled/sorted), category filter, get, findByQuery (id→name→contains), categories, invalid-URL drop.
- `/radio` shape (guild-only, 4 subcommands); `/radio list` embed + select menu; `/radio play` joins + plays a live track; unknown station; no-voice guidance; `/radio stop`.
- Component handler: ignores foreign customIds, guides when not connected, plays on the active session + refreshes the panel.
- Default stations all valid direct streams (not `.pls`/`.m3u`).

### Nevalidat
- Real reachability of the SomaFM streams from the bot host (needs outbound network + voice). Offline handling is covered by the existing error path but not exercised live.

### Probleme găsite
- Component interactions carry no `VoiceCapability`, so the select menu can only start playback when the bot is already connected — by design it guides the user to `/radio play` otherwise. Documented.

### Următoarea etapă poate continua?
Da. Proceed to full regression (Agent 7).

---

## Addendum — `/play` recognizes links that CONTAIN a playlist (2026-06-27, follow-up)

User request: links that contain a playlist (`watch?v=…&list=…`) should load the
YouTube playlist, not just the one video.

**Change:** `/play` now branches three ways (`commands.ts`):
- pure playlist (`playlist?list=…`) → `enqueuePlaylist` (whole list) — unchanged;
- **video-in-playlist (`watch?v=…&list=…`) → `playVideoWithPlaylist`**: plays the
  chosen video immediately (normal single resolve), then **best-effort loads the
  rest of the playlist** behind it (`resolvePlaylist` → `enqueueMany`), skipping
  the chosen video to avoid a duplicate. A playlist-lookup failure is caught and
  logged so the chosen video still plays;
- single / non-YouTube → `playSingle` (extracted from the old inline body).

`/playlist` still loads the whole list from the top. Docs updated:
`youtube-playlists.md`, `commands.md`, `troubleshooting-music.md`,
`testing-music.md`.

**Validated:** `pnpm --filter @botplatform/audio-module run typecheck` → clean;
`pnpm vitest run --project unit packages/audio-module` → **121 passed** (added
2 tests: video-in-playlist loads the rest + dedupes the chosen video; and the
best-effort fallback still plays the video when expansion fails); `pnpm lint`
→ clean. Not validated: real Discord/YouTube (same external caveats as above).
