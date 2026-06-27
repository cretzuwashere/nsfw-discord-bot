# Troubleshooting the Music System

> **Note:** the default radio stations shipped in `radio/stations.ts` are
> **SomaFM examples**, and every station's `streamUrl` MUST be a **direct** audio
> stream (Icecast/Shoutcast `…-mp3`/`.aac`/`.ogg`), **not** a `.pls`/`.m3u`/
> `.m3u8` playlist file.

Common problems and fixes. Most user-facing failures surface as a short, safe
message; the detail is in the bot logs. See also: [commands.md](commands.md),
[online-radio.md](online-radio.md), [long-track-playback.md](long-track-playback.md),
[queue-system.md](queue-system.md).

## yt-dlp is unavailable

**Symptom:** YouTube/SoundCloud/Spotify links fail to resolve. On startup the bot
logs: *"streaming sources are enabled but yt-dlp is not available — …"*
(`index.ts:103-107`).

**Fix:** install/enable yt-dlp in the runtime image (it ships in the Docker
images; `YTDLP_PATH` defaults to `yt-dlp` on `PATH`). If you intentionally run
without streaming sources, set `AUDIO_ENABLE_STREAMING_SOURCES=false` — then only
direct audio links (and radio) work, and the misleading warning goes away.
Verify the live chain with the smoke script (see
[testing-music.md](testing-music.md)).

## A playlist won't expand

- **You pasted a `watch?v=…&list=…` link into `/play`.** This now plays the
  chosen video first, then loads the rest of the playlist behind it — give the
  background expansion a moment, then check `/queue`. If only the one video ever
  shows up, the playlist lookup failed (see the yt-dlp note above) — the chosen
  video still plays. Use `/playlist <link>` to load the whole list from the top.
- **`RD…` Mix/Radio.** A `list=RD…` Mix plays the seed and queues
  `MIX_DEFAULT_ITEMS` (default **10**) tracks, then shows a panel with buttons to
  add more. It deliberately does **not** bulk-load the whole (endless) mix.
  - *Only got 1 track / no panel?* The mix lookup timed out or failed (see the
    yt-dlp note above) — the seed still plays, but there was nothing to buffer.
  - *Want more than 10 by default?* Raise `MIX_DEFAULT_ITEMS`, or just click the
    `+5/+10/+25/Add all` buttons. *Want fewer?* Click `🗑️ Clear queue`.
  - The buffer is bounded (50 fetched) and the queue bound (`MAX_QUEUE_SIZE`)
    still applies, so "Add all" can't overflow the queue.
- **Non-YouTube playlist.** Playlist expansion is YouTube-only (the resolver
  routes to the first provider that implements `resolvePlaylist`). A Spotify or
  other playlist/album link returns "Playlists are only supported for YouTube
  links." Spotify playlists/albums are a roadmap item.
- **`/playlist` says "That link has no playlist."** The link was a plain video or
  non-YouTube URL — use `/play` for a single track.

See [youtube-playlists.md](youtube-playlists.md).

## "That track is too long (limit Ns)"

The track's known duration exceeds `MAX_TRACK_DURATION_SECONDS` (default `3600`),
so it was rejected before queueing (`ytdlp-provider.ts:68-77`,
`spotify-provider.ts:69-78`).

**Fix:** raise the limit (e.g. `MAX_TRACK_DURATION_SECONDS=14400` for 4 hours) or
set `MAX_TRACK_DURATION_SECONDS=0` for **unlimited**. `0` disables both the
pre-queue reject and the duration watchdog. See
[long-track-playback.md](long-track-playback.md).

## A radio station won't play

- **It's a playlist file, not a stream.** A `.pls`/`.m3u`/`.m3u8` URL passes the
  HTTP content-type check but fails in ffmpeg. Use the **direct** stream URL
  inside the playlist file.
- **The allowlist is on.** If `ALLOWED_AUDIO_DOMAINS` is set, the station's host
  must be in it, or playback fails with "Links from that source are not allowed."
  (radio streams through the same SSRF-safe opener — `radio-source.ts:35-43`).
  Empty allowlist = any public domain allowed.
- **The station is offline.** `/radio play` replies *"Could not start <station> —
  it may be offline."* Pick another with `/radio list`.
- **Bad entry.** A station with an invalid `streamUrl` is dropped at registry
  construction (`registry.ts:15-20`) and won't appear at all.

See [online-radio.md](online-radio.md).

## Private / age-restricted YouTube videos fail

Unlisted videos play without anything extra, but **private/age-restricted**
videos need YouTube cookies.

**Fix:** export a Netscape `cookies.txt`, mount it into the container, and set
`YTDLP_COOKIES_FILE=/path/to/cookies.txt`. When set, `--cookies <file>` is added
to every yt-dlp invocation (`ytdlp-runner.ts:66-82`).

## The bot stops after repeated errors

After **3 consecutive** playback failures the session stops and clears the queue
(`MAX_CONSECUTIVE_FAILURES = 3`, `session.ts:17,258-266`). The counter resets on
any track that **finishes successfully**. This is the safety net against a run of
dead links (e.g. a playlist full of broken entries). Re-queue good links to
continue. See [queue-system.md](queue-system.md).

## The `/radio list` menu says "I'm not in a voice channel"

The select menu plays on the bot's **active** session, and Discord components
carry no voice capability — so the bot must already be connected
(`radio/commands.ts:255-261`). Use `/radio play <station>` instead: that command
can join your voice channel.

## The queue is empty after a restart

By design. The DB queue mirror is **display/audit only** and is never read back
on startup, so the in-memory queue starts empty after every restart. Restoring
from the mirror is a roadmap item ([future-music-roadmap.md](future-music-roadmap.md)).

## Slash commands are missing / out of date

Commands are registered with Discord by a CLI, not automatically on boot. Run:

```bash
docker compose exec app pnpm discord:register-commands
```

(`apps/bot/src/register-commands.ts`). Guild-scoped registration is instant;
global registration can take up to an hour to propagate. If the command says
"Discord is not configured", set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` first.
