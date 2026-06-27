# Music system documentation

The Discord audio player: YouTube (videos, **playlists** and **Mixes**),
SoundCloud, Spotify, **online radio** and direct links — with **multi-hour
track** support, **looping**, and an **auto-reposted now-playing panel**.

## Guides

| Doc | Contents |
|-----|----------|
| [music-system-overview.md](music-system-overview.md) | Architecture: command handler → manager → session → queue; resolver → providers; the now-playing panel |
| [commands.md](commands.md) | Every music slash command + the panel buttons |
| [youtube-playback.md](youtube-playback.md) | How single-video YouTube playback works (yt-dlp, cookies) |
| [youtube-playlists.md](youtube-playlists.md) | Playlists & **Mixes** (`list=RD…`): `/play` auto-expand, `/playlist`, the **mix add-more panel** |
| [long-track-playback.md](long-track-playback.md) | Multi-hour tracks; `MAX_TRACK_DURATION_SECONDS=0` = unlimited |
| [online-radio.md](online-radio.md) | `/radio` stations, the registry, and how to add a station |
| [looping-and-now-playing.md](looping-and-now-playing.md) | `/loop track\|queue\|off` and the auto-reposted now-playing panel |
| [queue-system.md](queue-system.md) | The bounded FIFO queue, persistence, failure cutoff |
| [testing-music.md](testing-music.md) | How to run the tests; covered vs. manual; a smoke checklist |
| [troubleshooting-music.md](troubleshooting-music.md) | Common problems & fixes |
| [future-music-roadmap.md](future-music-roadmap.md) | Planned improvements |

## Commands at a glance

```
/play <link>        play a track, or auto-expand a YouTube playlist/Mix
/playlist <link>    force-expand a YouTube playlist from the top
/mix                re-open the Mix "add more" panel
/radio list|play|stop|nowplaying     online radio
/loop track|queue|off [times]        repeat a track or the queue (N times / forever)
/queue /skip /pause /resume /stop /nowplaying /controls /join /leave
```

## Key settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MAX_QUEUE_SIZE` | 50 | Max upcoming tracks in the queue |
| `MAX_PLAYLIST_ITEMS` | 100 | Max tracks pulled from one playlist |
| `MIX_DEFAULT_ITEMS` | 10 | Tracks a YouTube Mix queues before "add more" |
| `MAX_TRACK_DURATION_SECONDS` | 3600 | Per-track cap; **0 = unlimited** |
| `ALLOWED_AUDIO_DOMAINS` | (empty) | Optional host allowlist (empty = any public host) |
| `AUDIO_ENABLE_STREAMING_SOURCES` | true | yt-dlp sources (YouTube/SoundCloud/Spotify) |
| `YTDLP_COOKIES_FILE` | (empty) | Cookies for private/age-restricted YouTube |

The implementation lives in [`packages/audio-module`](../../packages/audio-module);
the orchestration notes are under [`docs/agent-memory/music`](../agent-memory/music).
