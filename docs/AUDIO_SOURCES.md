# Audio Sources

The audio player resolves links through a **provider layer** — command
handlers never contain extraction logic, and new sources are added without
touching them.

## Supported sources

| Source | How it works | Notes |
|--------|--------------|-------|
| **YouTube** (`youtube.com`, `youtu.be`, `music.youtube.com`) | `yt-dlp` extracts metadata (`-J`) and streams best audio to ffmpeg | Single videos; live streams rejected |
| **SoundCloud** (`soundcloud.com`) | same `yt-dlp` path | Public tracks |
| **Spotify** (`open.spotify.com/track/…`) | reads the public title via Spotify **oEmbed**, then plays the best **YouTube** match | Single tracks only (no DRM audio); albums/playlists out of scope |
| **Direct files** (`https://…/song.mp3`) | SSRF-safe streaming fetch (undici) → ffmpeg | mp3/ogg/wav/m4a/…; private/internal hosts blocked |

Provider order: platform resolvers claim their hosts first; the direct-HTTP
provider is the catch-all. Everything is **lazy** — queued items hold no
processes or sockets; the download/stream starts only when playback begins.

## How streaming works (yt-dlp)

`yt-dlp` is the actively-maintained standard for self-hosted bots. Pure-JS
libraries (ytdl-core, play-dl) break whenever YouTube rotates its player
code; yt-dlp ships frequent extractor fixes. It is installed **inside the
Docker images** as a pinned standalone binary — nothing is installed on
Windows.

Pipeline per track:

```
yt-dlp -f bestaudio/best -o -  <url>   →   stdout (Opus/whatever)
                                       →   ffmpeg (StreamType.Arbitrary)
                                       →   Opus   →   Discord voice
```

Metadata (title, duration, uploader) is fetched up front with a cheap `-J`
call, and the **max-duration limit is enforced before queueing** when
duration is known.

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `AUDIO_ENABLE_STREAMING_SOURCES` | `true` | Set `false` to allow only direct audio-file links (no yt-dlp) |
| `YTDLP_PATH` | `yt-dlp` | Path/command for the binary (it's on `PATH` in the images) |
| `MAX_TRACK_DURATION_SECONDS` | `3600` | Tracks longer than this are rejected/skipped |
| `ALLOWED_AUDIO_DOMAINS` | empty | If set, the **input** URL host must match — add `youtube.com`, `youtu.be`, `soundcloud.com`, `open.spotify.com` if you both restrict and want streaming |

## Validated behavior

Confirmed end-to-end inside the Linux container against the real internet
(`packages/audio-module/scripts/check-streaming.ts`):

- **YouTube** — metadata + audio streamed and transcoded to real Opus bytes
- **Spotify** — oEmbed title → YouTube search → audio transcoded to real Opus
- **YouTube search** (used by the Spotify path) — working
- ffmpeg 6.1.1 with libopus, `@discordjs/opus` encoder and native AES-256-GCM
  voice encryption verified (`scripts/check-audio-stack.ts`)

Run them yourself:

```bash
docker compose exec app pnpm exec tsx scripts/check-audio-stack.ts
docker compose exec app bash -lc "cd packages/audio-module && pnpm exec tsx scripts/check-streaming.ts"
```

## Known limitations & operations

- **Keep yt-dlp current.** YouTube periodically tightens anti-bot checks; a
  stale yt-dlp can trigger "Sign in to confirm you're not a bot" errors
  (especially for *search* from datacenter IPs). Bump `YTDLP_VERSION` in
  `Dockerfile` / `Dockerfile.dev` and rebuild
  (`docker compose build app && docker compose up -d`). On a residential IP
  (typical for Docker Desktop on a home machine) this is rarely an issue.
- **Spotify** plays the closest YouTube match, not Spotify's own audio
  (their stream is DRM-protected) — the match is usually exact for popular
  tracks. Albums/playlists are not expanded in v1.
- **Live streams** are rejected (no fixed duration).
- All provider errors surface to users as safe messages
  ("That link could not be resolved.") — raw yt-dlp output never reaches
  Discord and is logged server-side only. Failed tracks appear in the admin
  panel's *Audio Player → Recent playback errors*.

## Future sources

The `AudioProvider` interface (`packages/audio-module/src/resolver/types.ts`)
is the single extension point. A new provider implements `canResolve(url)` +
`resolve(url, ctx)` and is prepended to the list in
`packages/audio-module/src/index.ts`. Video playback, additional platforms,
and a dedicated resolver microservice are all additive from here.
