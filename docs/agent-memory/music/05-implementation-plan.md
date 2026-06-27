# Agent 5 — Implementation Plan

> Synthesized from analyses 01–04. Defines small, independently-validatable
> stages with PASS/FAIL gates, affected files, risks, tests, acceptance, and
> rollback. Nothing is implemented until this plan is written (it is now).
>
> Validation is real this session: dev stack (`db`+`app`) is up, so each stage is
> gated by `docker compose exec app pnpm …`.

## Design decisions (locked, from analyses)

1. **Additive resolver, never break `resolve()`.** Single-video `play` keeps the
   exact `resolver.resolve() → one ResolvedTrack → session.enqueueOrPlay()` path.
   Playlists use a NEW `resolvePlaylist()` path. (Agent 2)
2. **Playlists = flat-extract once, lazy per-item stream.** `yt-dlp
   --yes-playlist --flat-playlist -J` yields `entries[]` with per-video URLs; we
   map each to a `ResolvedTrack` whose `createStream` lazily runs the normal
   single-URL `stream()` at play time. No per-item `-J`. (Agent 2)
3. **Long tracks: `0 = unlimited`.** Change in 4 sites: config zod `min(1)→min(0)`;
   yt-dlp provider reject guarded by `max>0`; **Spotify provider** reject guarded
   by `max>0` (3rd site, Agent 3); `armDurationTimer` early-returns when
   `max<=0`. Add yt-dlp `--retries/--fragment-retries/--retry-sleep` to the
   stream path (NOT ffmpeg). No idle timeout added. (Agent 3)
4. **Radio: static `radio/stations.ts` + `RadioRegistry`** (lightest option
   meeting "not hardcoded in handler", "configurable", "easy to add"). A station
   plays like a normal track but is flagged **live** → exempt from the watchdog;
   streamed via the SSRF-safe opener (same as direct-http). DB+admin is a
   documented upgrade path only. (Agent 4)
5. **Radio UX: `/radio` parent + subcommands `list`/`play`/`stop`/`nowplaying`
   + a string select menu** from `list`. Autocomplete & per-option `choices` are
   NOT supported by the adapter (confirmed); subcommands and select menus ARE
   (announcement/roles/role-menus precedent). (Agent 4)
6. **Live flag** added to `ResolvedTrack` (`isLive?: boolean`). The watchdog
   skips when `isLive` OR `maxTrackDurationSeconds<=0`. Display already renders
   `🔴 LIVE / streaming` for unknown duration. (Agents 3+4 convergence)

---

## Stage 1 — Minimal refactor / test seams (enabler)

**Goal:** add the seams playlists/radio need WITHOUT behavior change.

**Files**
- `packages/audio-module/src/testing/fakes.ts` — add `FakeYtDlpRunner` (json/stream/available + flatPlaylist) so providers are unit-testable. (Agent 2 gap)
- `packages/audio-module/src/resolver/types.ts` — add optional `resolvePlaylist?` to `AudioProvider`; add `isLive?: boolean` to `ResolvedTrack`; add a `PlaylistResolution` type `{ tracks: ResolvedTrack[]; total: number; skipped: number; title?: string }`.
- `packages/audio-module/src/engine/queue.ts` — add `enqueueMany(tracks)` returning `{ accepted, rejected }` (respects `maxSize`).
- `packages/audio-module/src/engine/session.ts` — add `enqueueMany(tracks)` → plays first if idle, queues rest; returns `{ startedPlaying, queued, rejected }`.

**Risks:** low (additive). **Tests:** queue.enqueueMany bounds; session.enqueueMany idle vs active. **Acceptance (PASS/FAIL):** audio-module unit + typecheck green; no existing test changed in behavior. **Rollback:** revert the additive members (no caller yet).

## Stage 2 — YouTube playlists

**Files**
- `packages/audio-module/src/resolver/ytdlp-runner.ts` — add `flatPlaylist(url, timeoutMs)` running `--yes-playlist --flat-playlist -J` (overrides COMMON_ARGS `--no-playlist`; verify last-flag-wins against pinned yt-dlp). Cap output via existing `MAX_JSON_BYTES`.
- `packages/audio-module/src/resolver/youtube-url.ts` (new) — pure `classifyYouTubeUrl(url): 'video'|'playlist'|'video-in-playlist'|'not-youtube'` + extract `listId`. Ignore `list=RD…` auto-mixes (endless) → treat as video.
- `packages/audio-module/src/resolver/providers/ytdlp-provider.ts` — implement `resolvePlaylist(rawUrl, ctx, limit)`: flatPlaylist → map entries → `ResolvedTrack[]` (lazy per-URL stream identical to single-video), drop entries without a usable URL or marked unavailable, apply `limit`, return `PlaylistResolution` with `total`/`skipped`.
- `packages/audio-module/src/resolver/resolver.ts` — add `resolvePlaylist(rawUrl, ctx, limit)`: SSRF-validate, pick a provider implementing `resolvePlaylist`, delegate.
- `packages/config/src/index.ts` + `.env.example` — add `MAX_PLAYLIST_ITEMS` (default 100, min 1, max 1000) → `audio.maxPlaylistItems`.
- `packages/audio-module/src/index.ts` — pass `maxPlaylistItems` into the command deps.
- `packages/audio-module/src/commands.ts` — in `play`: classify URL; pure-playlist → expand; video-in-playlist → play single (least surprise); add a `/playlist <url>` command that force-expands any playlist URL. Both batch-enqueue via `session.enqueueMany` and reply "Added N of M (skipped K unavailable)". Respect `maxQueueSize` and `maxPlaylistItems`.

**Behavior matrix:** single video → unchanged; `playlist?list=` → whole list; `watch?v=&list=` via `/play` → single; via `/playlist` → whole list; invalid → existing error; bare query → existing "not a valid link" (search out of scope).

**Risks:** breaking single-video (mitigated: separate path, test first); huge playlist (cap + flat extraction); 3+ consecutive dead items hit `MAX_CONSECUTIVE_FAILURES` (document; resets on any success). **Tests:** classify (all 5 cases); resolvePlaylist with fake runner (normal, empty, > limit, some unavailable); single-video still one track. **Acceptance:** unit+typecheck+lint green; single-video unit unchanged. **Rollback:** revert commands to single-resolve; keep helpers dormant.

## Stage 3 — Long-track playback

**Files**
- `packages/config/src/index.ts` (`min(1)→min(0)`, comment: 0=unlimited) + `.env.example`.
- `packages/audio-module/src/resolver/providers/ytdlp-provider.ts` (`max>0 &&` guard).
- `packages/audio-module/src/resolver/providers/spotify-provider.ts` (`max>0 &&` guard).
- `packages/audio-module/src/engine/session.ts` — `armDurationTimer`: early-return when `maxTrackDurationSeconds<=0` OR current track `isLive`.
- `packages/audio-module/src/resolver/ytdlp-runner.ts` — add `--retries 10 --fragment-retries 10 --retry-sleep 3` to the `stream()` args for hours-long robustness (finite, so a dead source still terminates).

**Risks:** removing the watchdog entirely (avoided — only when explicitly unlimited/live); infinite retry hang (avoided — finite). **Tests:** watchdog NOT armed when `max=0` or live; armed otherwise; provider does NOT reject when `max=0`; skip/stop clear the timer (existing tests must stay green). **Acceptance:** unit+typecheck green; a >1h fake-duration track is accepted when `max=0`. **Rollback:** restore `min(1)` and unconditional timer.

## Stage 4 — Online radio

**Files (new)**
- `packages/audio-module/src/radio/stations.ts` — curated `RadioStation[]` (id,name,category,streamUrl,websiteUrl?,description?,enabled,sort). Direct stream URLs only.
- `packages/audio-module/src/radio/registry.ts` — `RadioRegistry`: `list({category?,enabledOnly})`, `get(id)`, `findByQuery(q)`, `categories()`. Validates URL format at load.
- `packages/audio-module/src/radio/radio-source.ts` — builds a live `ResolvedTrack` from a station via the SSRF-safe opener (`openSafeHttpStream`), `isLive:true`, duration undefined.
- `packages/audio-module/src/radio/commands.ts` — `/radio` subcommands `list`/`play`/`stop`/`nowplaying` + a `radio:` select-menu component handler.

**Files (changed)**
- `packages/audio-module/src/index.ts` — construct `RadioRegistry`, build radio commands, add radio component handler to `events`.
- `packages/audio-module/src/commands.ts` or index — compose component handlers (`audio:` + `radio:`).

**Behavior:** `/radio list [category]` → embed + select menu (≤25, per-category if needed); selecting or `/radio play <query>` resolves the station, ensures voice, takes over playback as a live track (no watchdog); `/radio stop` stops; offline station → existing error path (UserFacingError / advance). SSRF: stations must be within `ALLOWED_AUDIO_DOMAINS` if that is set (default empty=any).

**Risks:** `.pls`/`.m3u` URLs pass the content-type gate then fail ffmpeg → store direct URLs only (validated/documented); select-menu 25-cap → per-category/pagination. **Tests:** registry list/get/findByQuery/categories; URL validation rejects non-http; radio source sets `isLive`; classify radio not expanded as playlist. **Acceptance:** unit+typecheck+lint green; `/radio` appears in the module command list. **Rollback:** drop the `radio/` dir + radio command/handler wiring.

## Stage 5 — Docs + final validation

Update `docs/music/*` to mark features implemented; write `queue-system.md`,
`testing-music.md`, `troubleshooting-music.md`; run full regression
(`pnpm test`, `pnpm build`, `pnpm lint`) in Docker; write `06`/`07`/`99`.

---

## Global acceptance (maps to the brief's final criteria)

- Single-video play unchanged ✔ (Stage 1–4 keep `resolve()` intact).
- Playlists: many items without blocking; configurable cap; tolerate
  unavailable items ✔ (Stage 2).
- Long/multi-hour tracks allowed (0=unlimited); skip/stop work; expired-URL
  mitigated by lazy yt-dlp; dropped-stream → advance (+finite retries) ✔ (Stage 3).
- Radio selectable from a configurable source, not hardcoded in the handler;
  list/select; invalid-stream handling; "add a radio" documented ✔ (Stage 4).
- Each stage validated in Docker; anything needing live Discord/YouTube/radio is
  documented as not-locally-validated ✔ (Stage 5 / Agent 7).

## Out of scope (roadmap, see future-music-roadmap.md)

Per-guild `maxTrackDurationSeconds` (dormant column), DB+admin radio management,
queue restore-after-restart, search-by-text, same-track auto-retry by default.

## Checkpoint — Agent 5 (Implementation plan)

Status: PASS

### Modificări făcute
- Locked 6 design decisions; defined 5 stages with files/risks/tests/acceptance/rollback.

### Comenzi rulate
- None (planning); synthesized analyses 01–04.

### Validat efectiv
- Plan stages are each independently testable with explicit PASS/FAIL gates.

### Nevalidat
- Live Discord/YouTube/radio behavior (Agent 7 will document).

### Probleme găsite
- 3rd duration-reject site (Spotify) and dormant per-guild limit folded into the plan / roadmap.

### Următoarea etapă poate continua?
Da. Begin Stage 1.
