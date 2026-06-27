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

---

## Addendum 2 — YouTube Mixes/Radios (`list=RD…`) now expand (2026-06-27, follow-up)

User report: `https://www.youtube.com/watch?v=VLKqKUJSCv4&list=RDVLKqKUJSCv4`
added only the first song. Root cause: `classifyYouTubeUrl` downgraded any
`list=RD…` (auto-mix) to a plain `video`, so `/play` never expanded it.

**Empirically verified against the live binary (yt-dlp 2026.06.09, in-container):**
- `--no-playlist --yes-playlist --flat-playlist -J` on the URL → expands the Mix
  (confirms `--yes-playlist` overrides `--no-playlist`, last-flag-wins). A Mix is
  large/dynamic: returned **423–1276** entries across runs.
- `--no-playlist` alone → exactly **1** entry (the symptom).
- `--playlist-end 10` → exactly **10** entries in **1.07s** (bounding works + fast).
- Full module flow (`AudioResolver.resolvePlaylist`, real runner, real URL, cap
  25) → classified `video-in-playlist`, returned **25 tracks in 1.96s**, title
  "Mix - Neo - Don't Break".

**Change:**
- `youtube-url.ts` — removed the `isAutoMix` downgrade; any `list=` (incl.
  `RD…`/`OLAK…`) classifies as `playlist`/`video-in-playlist`.
- `ytdlp-runner.ts` — `flatPlaylist(url, timeoutMs, limit?)` adds
  `--playlist-end <limit>` so endless Mixes can't return 1000+ entries or blow
  the 15s metadata timeout (this is what makes the fix reliable, not just the
  classification change).
- `ytdlp-provider.ts` — `resolvePlaylist` forwards the cap to `flatPlaylist`.

**Validated:** typecheck clean; audio-module unit **123 passed** (+2: RD→
video-in-playlist, OLAK→playlist, and the `--playlist-end` forwarding test);
`pnpm lint` clean; `pnpm test:unit` **474 passed**; `pnpm build` OK; and the real
end-to-end run above. Docs updated: `youtube-playlists.md`, `commands.md`,
`troubleshooting-music.md`, `testing-music.md`.

Not validated: live Discord voice playback of the queued mix (needs a real bot +
voice). The resolution/expansion path itself is now proven against real YouTube.

---

## Addendum 4 — Looping + auto-reposted now-playing panel + adversarial review (2026-06-27)

User request: (1) loop a track OR the queue, N times or forever; (2) re-post the
`/controls` panel on every track change (show current track + remaining queue).

**Feature.**
- **Loop** (`engine/session.ts`): `loopMode` (off/track/queue), `loopRemaining`
  (null=forever), `loopSet` (queue captured at enable). Track loop replays the
  same track; queue loop refills the captured set when the queue drains, counting
  passes. `/loop track|queue|off [times]` subcommands (`commands.ts`). Loop shown
  on the panel (`now-playing.ts`) + `QueueSnapshot.loop` (`shared/types.ts`).
- **Auto-panel** (`engine/manager.ts`): the manager holds a
  `GuildServiceProvider` (passed from `apps/bot/src/main.ts`) and, on each track
  CHANGE (not the initial /play), deletes the previous now-playing panel and
  posts a fresh one to the session's text channel (`session.setTextChannel`).

**Adversarial review** (workflow `wf_5e1b4df9-1f1`, 5 dimensions; wiring clean;
2 false alarms rejected). 9 confirmed, all addressed:
1. (high) `/skip` transferred a track loop to the next song → `skip()` now
   `resetLoop()` for track loops.
2. (high) concurrent panel reposts orphaned panels → reposts now **serialized
   per guild** via a promise chain.
3. (high) external disconnect resurfaced stale loop on reuse → `attachVoice`
   resets loop/mix when the prior connection was destroyed. (The broader
   session/lastPanel leak on external disconnect is pre-existing — documented in
   `01-current-music-system-analysis.md`; the lastPanel part self-heals on the
   next play.)
4. (high) in-flight repost could resurrect a panel after `/leave` → `repostPanel`
   re-checks `sessions.has` after send and deletes the orphan.
5/6. (high/med) queue loop snapshots the set at enable; later adds don't repeat →
   the `/loop queue` reply now says so (kept the snapshot model deliberately).
7. (low) track loop re-posted the panel every repeat → track-loop replay no
   longer announces.
8. (low) `/stop` left a stale panel → `stop()` refreshes the panel to idle.
9. (low) the initial `/play` reply panel lingers one cycle → documented.

**Validated:** typecheck clean; audio-module unit **165**; `pnpm test:unit`
**516**; lint clean; build OK. Docs: `looping-and-now-playing.md` (new),
`commands.md`. Not validated: live Discord voice (needs a running bot).

---

## Addendum 3 — Mix "default 10 + add-more buttons" + adversarial review (2026-06-27)

User request: for `list=RD…` links, queue **10 by default** (not 100) and show a
react-button panel to optionally add more/fewer.

**Feature.** New config `MIX_DEFAULT_ITEMS` (default 10, max 50). `isMixList()`
(`youtube-url.ts`) detects `RD…`. `playMix()` (`commands.ts`) plays the seed,
queues `mixDefaultItems`, buffers the rest (up to `MIX_BUFFER_MAX`=50, fetched
with `--playlist-end`), and posts the mix panel (`mix-panel.ts`
`buildMixPanel`). Buttons (`mix:` prefix): `+5/+10/+25`, `Add all`, `−5`
(remove), `Clear queue`. Buffer state is `session.pendingMix`
(`setPendingMix`/`addFromPendingMix`/`removeFromQueue`/`clearPendingMix`), with a
synchronous slice/enqueue/splice critical section (race-free under concurrent
clicks). `/mix` re-summons the panel. Component dispatch composes
audio→radio→mix by customId prefix.

**Real end-to-end proof** (user's URL, in-container): classified
`video-in-playlist`+`isMix`, fetched 50 → seed filtered → **queued 10, buffered
39**.

**Adversarial review** (5-dimension fan-out + per-finding verification, workflow
`wf_d8d19a4c-b17`): 7 confirmed, several false alarms correctly rejected
(fabricated "more or fewer" requirement; "clear removes non-mix tracks"; a
self-refuting concurrency claim). **All 7 fixed:**
1. (high) add-more reported "no buffer" when the real blocker was a full queue →
   now distinguishes "queue full (max N)" from "no more buffered".
2. (high) `/playlist` bulk-loaded RD mixes → now routes RD to the mix panel too.
3. (med) stale `pendingMix` survived a later non-mix `/play` → `/play` &
   `/playlist` `clearPendingMix()` up front (playMix re-sets).
4. (med) panel couldn't be re-summoned → added `/mix`.
5. (low) "Add more — or fewer" had no "fewer" control → added the `−5` remove
   button (`removeFromQueue`/`queue.removeTail`).
6. (low) stale Add buttons after `/stop` until clicked → documented as
   self-healing (no `disabled` in the message contract; not worth a core change).
7. (low) `MIX_DEFAULT_ITEMS` could exceed the 50-fetch buffer → capped zod at 50
   and made the fetch `max(MIX_BUFFER_MAX, mixDefaultItems+15)`.

**Validated:** typecheck clean; audio-module+config unit **153 passed**;
`pnpm test:unit` **497 passed**; `pnpm lint` clean; `pnpm build` OK; wiring smoke
(13 commands incl. `mix`). Docs updated: `youtube-playlists.md`, `commands.md`,
`testing-music.md`, `troubleshooting-music.md`.
