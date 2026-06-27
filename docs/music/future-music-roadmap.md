# Music — Future Roadmap

Forward-looking only. The shipped features (YouTube playlists, long-track /
`MAX_TRACK_DURATION_SECONDS=0`, online radio, the full command set) are
documented in their own pages — this page is the **only** one that describes work
that does **not** exist yet. Each item below is **Not started**.

## Per-server max track duration

**Status: Not started.** Today `MAX_TRACK_DURATION_SECONDS` is global, read once
into `PlayerManager`/providers at module construction (`index.ts:45-57`). The DB
already has a dormant per-guild column `guild_settings.max_track_duration_seconds`
(`packages/database/src/schema.ts:120`; the guilds repo type carries it,
`repositories/guilds.ts:62`) but nothing reads it for audio.

**Rationale:** let each server raise/lower its own limit without a global redeploy.

**Main files:** `packages/audio-module/src/engine/manager.ts` (resolve the
effective limit per guild), `engine/session.ts` (`armDurationTimer`), the
providers' duration check, and the guild-settings read path.

## DB-backed + admin-managed radio stations

**Status: Not started.** Stations live in a static, code-reviewed file
(`radio/stations.ts`) read through `RadioRegistry`. The registry was
deliberately built as the single read interface so the source can change without
touching callers.

**Rationale:** add/remove/enable stations from the admin panel (and per-guild)
with no redeploy.

**Main files:** a new `radio_stations` table + migration in
`packages/database`, a repo, an admin page in `apps/admin`, and a
DB-backed/overlay implementation behind `radio/registry.ts` (keeping the static
file as a fallback/seed).

## Queue restore after restart

**Status: Not started.** The session writes a best-effort queue mirror
(`replaceQueue`, `session.ts:330-336`) but never reads it back, so the in-memory
queue is empty after every restart (see [queue-system.md](queue-system.md)).

**Rationale:** survive a deploy/restart without losing what was queued.

**Main files:** startup read-back of `PlaybackRepo.getQueue` into the session,
re-resolving each mirrored `TrackSummary` to a lazy `ResolvedTrack` in
`engine/session.ts` / `engine/manager.ts`.

## Search-by-text in `/play`

**Status: Not started.** `/play` requires a URL; a non-URL fails validation with
the "not a valid link" error. yt-dlp already supports `ytsearch` (the Spotify
provider uses `ytsearch1:` internally), so the plumbing exists.

**Rationale:** let users type a song name instead of pasting a link.

**Main files:** `packages/audio-module/src/commands.ts` (`/play` handler),
`resolver/resolver.ts` / `resolver/providers/ytdlp-provider.ts` (a search path
alongside `resolve`).

## Same-track auto-retry on early stream failure (off by default)

**Status: Not started.** A stream that errors out advances to the next track
(after the 3-consecutive-failure cutoff). A conservative option could retry the
**same** track once if it fails *near the start* — never deep into a long track,
since there is no seek/resume.

**Rationale:** ride out a transient hiccup at track start on long playbacks
without giving up. Default off to avoid surprising loops.

**Main files:** `engine/session.ts` (`handleEvent` / `advance`), gated by a new
config flag in `packages/config`.

## Spotify playlists / albums

**Status: Not started.** `SpotifyAudioProvider` handles **single tracks only** —
`canResolve` requires `/track/` in the path (`spotify-provider.ts:39-44`).

**Rationale:** expand a Spotify album/playlist the way YouTube playlists already
expand.

**Main files:** `resolver/providers/spotify-provider.ts` (add a
`resolvePlaylist` that reads the album/playlist track list, then `ytsearch`es
each), wired through `resolver.resolvePlaylist`.

## Playlist shuffle / dedupe

**Status: Not started.** The queue is a strict FIFO with no reordering or
de-duplication (`engine/queue.ts`).

**Rationale:** shuffle a freshly expanded playlist, or drop duplicate entries.

**Main files:** `engine/queue.ts` (reorder/dedupe helpers) and the
`enqueuePlaylist` path in `commands.ts`; optionally a `/play` or `/playlist`
option, or `/shuffle`.
