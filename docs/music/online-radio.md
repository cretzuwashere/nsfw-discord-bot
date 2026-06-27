# Online Radio

> **Note:** the default stations shipped in `radio/stations.ts` are **SomaFM
> examples**. Every station's `streamUrl` MUST be a **direct** audio stream
> (Icecast/Shoutcast `…-mp3`/`.aac`/`.ogg`) — **not** a `.pls`/`.m3u`/`.m3u8`
> playlist file. Playlist files pass the HTTP content-type gate but fail inside
> ffmpeg.

Selectable online radio is **shipped**. The bot ships a curated, categorized
station list and a `/radio` command group; radio plays as a first-class **LIVE**
source that is exempt from the per-track duration limit.

See also: [commands.md](commands.md) for the full `/radio` reference and
[troubleshooting-music.md](troubleshooting-music.md) when a station won't play.

## Commands

`/radio` is a guild-only subcommand group (`radio/commands.ts:128-233`).

| Command | What it does |
|---|---|
| `/radio list [category]` | Shows the stations as an embed grouped by category **and** a clickable select menu (≤25 options). Optional `category` filters the list. |
| `/radio play <station>` | Starts a station by id or name. Joins voice and **takes over** playback. |
| `/radio stop` | Stops the radio and clears the queue (same as stopping any playback). |
| `/radio nowplaying` | Shows the current-track panel (radio shows as `🔴 LIVE / streaming`). |

Notes:

- **Picking a station takes over playback** — `startRadio` calls
  `session.stop()` (which clears the queue) and then plays the station
  (`radio/commands.ts:64-74`). A radio is continuous and has no end; use
  `/radio stop` or the ⏹ button to stop it.
- **Matching** for `/radio play <station>` is: exact id → exact name →
  case-insensitive "name contains" (`registry.ts:42-51`). There is **no
  autocomplete**; an unknown query replies "Unknown station … Use `/radio list`
  to see options."
- The now-playing panel and its buttons (⏸/▶/⏭/⏹/👋/🔄) work with radio just like
  any track; radio simply shows as LIVE instead of a progress bar.

### The `/radio list` select menu

`/radio list` posts a string select menu with `customId = "radio:select"`
(`radio/commands.ts:20,76-86`). Selecting an option routes through the one
`component.interaction` handler (`index.ts:90-98`) to
`buildRadioComponentHandler` (`radio/commands.ts:240-272`):

- It plays the chosen station on the guild's **ACTIVE** session.
- Components carry **no voice capability**, so the bot must already be connected.
  If it is not, the menu replies *"I'm not in a voice channel. Use `/radio play
  <id>` to start <name>."* (`radio/commands.ts:255-261`). Run `/radio play`
  instead — that one can join your channel.

## The station record

Each station is one `RadioStation` record (`radio/stations.ts:15-28`):

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable, lowercase, URL-safe slug, e.g. `groovesalad`. Used by `/radio play <id>` and the select-menu value. |
| `name` | yes | Display name, e.g. `SomaFM: Groove Salad`. |
| `category` | yes | Grouping for the list/menu, e.g. `Chillout`, `Ambient`. |
| `streamUrl` | yes | The **direct audio stream URL**. **Not** a `.pls`/`.m3u`/`.m3u8` playlist link — see the note at the top. |
| `websiteUrl` | no | The station's homepage (preferred for display on the panel). |
| `description` | no | One-line description (used as the select-menu option's subtitle, falling back to `category`). |
| `enabled` | yes | `false` hides the station from listing and rejects it on play. |
| `sort` | yes | Ascending display order within a category. |

The `RadioRegistry` (`radio/registry.ts`) is the single read interface over the
list. It **drops any station with an invalid stream URL at construction**
(`isValidStreamUrl`, `registry.ts:15-20,63-70`), so a malformed entry can never
reach playback. It exposes `list({category?, includeDisabled?})`, `get(id)`,
`findByQuery(q)`, and `categories()`.

## How to add a station

Stations are a **static, version-controlled data file** — command handlers never
hardcode stations; they read through the registry.

1. Open `packages/audio-module/src/radio/stations.ts`.
2. Append an entry to `RADIO_STATIONS` with a unique `id`:
   ```ts
   {
     id: 'groovesalad',
     name: 'SomaFM: Groove Salad',
     category: 'Chillout',
     streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3', // the DIRECT audio URL
     websiteUrl: 'https://somafm.com/groovesalad/',
     description: 'A nicely chilled plate of ambient/downtempo beats and grooves.',
     enabled: true,
     sort: 1,
   },
   ```
3. Make sure `streamUrl` is a **direct audio endpoint** (not a `.pls`/`.m3u`) and
   is reachable on a **public** host (private/internal addresses are blocked by
   the SSRF guard).
4. Rebuild and redeploy the bot. The station appears in `/radio list`
   automatically.

> **Use the direct stream URL, not the playlist file.** Many station pages give
> you a `.pls` or `.m3u` link. That file is just a *pointer* to the real stream;
> it is not audio and will fail in ffmpeg. Open the `.pls`/`.m3u` in a text
> editor and copy the `http(s)://…` line inside it — that is the `streamUrl`.

### If the audio allowlist is turned on

The optional `ALLOWED_AUDIO_DOMAINS` allowlist applies to radio too: the stream
is opened through the same SSRF-safe `openSafeHttpStream` as direct links
(`radio-source.ts:35-43`). When the allowlist is **empty (the default), any
public domain is allowed**, so radios work without extra config. If an operator
**sets** `ALLOWED_AUDIO_DOMAINS`, **every station's host must be in that list**,
or the station fails with "Links from that source are not allowed." When you add
a station, also add its host to `ALLOWED_AUDIO_DOMAINS` if the allowlist is in
use.

### DB-backed / admin-managed stations (not built)

Moving stations into the database with an admin page (and per-guild management)
is a roadmap upgrade, not built — the registry interface was designed so the
underlying source can change without touching callers. See
[future-music-roadmap.md](future-music-roadmap.md).

## Radio as a LIVE track

`buildRadioTrack` (`radio-source.ts:15-45`) builds the playable track:

- No `durationSeconds` → the panel renders **🔴 LIVE / streaming** with a running
  elapsed time.
- `isLive: true` → exempt from the duration watchdog
  (`session.ts:296-299`), so a station never gets force-skipped at the cap.
- The stream is opened **lazily** through `openSafeHttpStream` with
  `requireAudioContentType: true`, so the station host is subject to
  `ALLOWED_AUDIO_DOMAINS` when configured.

## What happens when a station is offline

Radio reuses the existing error handling, so an unavailable station produces a
clear, safe message and never crashes the bot:

- **At start:** if the host is unreachable, returns an error, or the URL is not
  actually audio, `/radio play` replies *"Could not start <station> — it may be
  offline."* (`radio/commands.ts:182-188`); a precise SSRF/validation
  `UserFacingError` is surfaced verbatim instead. Pick another with
  `/radio list`.
- **Mid-stream drop:** a dropped station is treated like any playback error;
  after 3 consecutive failures the session stops cleanly and clears the queue
  (the same safety net used for regular tracks — see
  [queue-system.md](queue-system.md)).
