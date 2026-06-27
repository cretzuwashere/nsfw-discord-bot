# Agent 4 — Online Radio Support: Analysis + Proposed Design

> Read-only analysis. **NO source code was modified.** This is an analysis and a
> *proposed* design for adding selectable online-radio support to the existing
> music system; implementation is Agent 6's job (per `00-orchestrator-plan.md`).
>
> Author: Agent 4. Date: 2026-06-27. Language: English.
> Every claim is marked **CONFIRMED** (read in code this session, cited to
> `file:line`) or **DEDUCED** (reasoned from code + documented streaming
> behavior, not executed — no radio stream and no Docker/build/test were run).

---

## 0. Scope & headline conclusions

The brief asks: add **selectable online radio** to the bot — radios must **not be
hardcoded in the command handler**, must have a **clear list/select method**, and
must **handle an unavailable stream**. Short answer: **yes, cleanly and lightly.**

The three required guarantees, up front (expanded in §7):

- **(a) Radios are NOT hardcoded in the command handler.** Stations live in a
  separate data file (`radio/stations.ts`) behind a `RadioRegistry`; the command
  handler only asks the registry to *list* and *get by id*. The handler never
  contains station URLs.
- **(b) There is a clear list/select method.** Two complementary surfaces, both
  using features the code **actually supports**: a `/radio list` subcommand (text)
  and a Discord **select menu** (`OutgoingMessage.selectMenu`, CONFIRMED supported
  end-to-end), plus `/radio play station:<id-or-name>` as a typed shortcut.
- **(c) Unavailable streams are handled.** Format validation happens at registry
  load (and can be enforced in a unit test / admin save); an optional pre-flight
  reachability probe reuses the SSRF-safe stream opener; and any failure at play
  time flows through the **existing** `UserFacingError` + per-track failure path
  (`MAX_CONSECUTIVE_FAILURES`).

**Recommended decisions** (justified below):

- **Config source: a static TypeScript data file inside `audio-module` loaded by a
  `RadioRegistry`** (option *a*) — the lightest option that satisfies the brief.
  Optionally overlay an env/`system_settings` JSON for ops-time additions without a
  rebuild. A full DB table + admin page (option *b*) is documented as the upgrade
  path but is **not** recommended for the first cut.
- **Selection UX: `/radio` parent command with subcommands** (`list`, `play`,
  `stop`, `nowplaying`) **plus a select menu** for point-and-click. Discord
  **autocomplete and per-option `choices` are NOT available** in this platform
  (CONFIRMED below), so neither can be used; subcommands + select menu are the
  correct fit and are both already mapped/dispatched by the adapter.

---

## 1. How radios actually stream — fit against the current providers

### 1.1 Direct-HTTP catch-all — CONFIRMED

| Fact | Evidence |
|---|---|
| `DirectHttpAudioProvider` claims **any** `http:`/`https:` URL and is registered **last** (catch-all). | `resolver/providers/direct-http.ts:13-15`; registration order `audio-module/src/index.ts:44-49` (yt-dlp + Spotify first, direct-http last). |
| It opens the stream lazily via `openSafeHttpStream(rawUrl, { allowedDomains, timeoutMs, requireAudioContentType: true })`. | `direct-http.ts:30-37`. |
| Input is `'arbitrary'` → ffmpeg transcodes whatever bytes arrive. | `direct-http.ts:27-28`, comment `:6-8`. |

### 1.2 What `requireAudioContentType:true` accepts — CONFIRMED (important nuance)

`isAcceptableAudioContentType` (`security/src/safe-stream.ts:79-90`) returns true
when the content-type:

- is **missing/empty** (`return true` — "many file CDNs omit it — ffmpeg will
  sniff", `:80`), OR
- starts with `audio/`, OR starts with `video/`, OR equals `application/ogg`,
  `application/octet-stream`, or `binary/octet-stream`.

Consequences for radio (DEDUCED from the rule above + common Icecast/Shoutcast
behavior — no live stream was contacted):

- **Typical Icecast/Shoutcast MP3/AAC/OGG streams pass.** They return
  `audio/mpeg`, `audio/aac` (both start with `audio/`), or `application/ogg`. Many
  Shoutcast endpoints return no content-type at all → also passes.
- **Playlist pointers are the trap.** A `.pls`/`.m3u`/`.m3u8` URL is **not** an
  audio byte stream — it is a tiny text file listing the real stream URL(s). Their
  content-types are commonly `audio/x-scpls` (.pls), `audio/x-mpegurl` (.m3u),
  `application/vnd.apple.mpegurl` / `audio/mpegurl` (.m3u8), or sometimes
  `text/plain`. Note: `audio/x-scpls` and `audio/x-mpegurl` **start with
  `audio/`** so they would **pass** the content-type gate (`safe-stream.ts:84`) and
  then **fail in ffmpeg**, because the bytes are a playlist, not audio. A
  `text/plain` playlist would be **rejected** by the gate with "That link does not
  point to an audio file." (`safe-stream.ts:159-162`).
- **Takeaway:** the station registry should store the **resolved direct stream
  URL** (the actual `audio/*` endpoint), not a `.pls`/`.m3u` link. Optionally,
  Agent 6 may add a tiny `.pls`/`.m3u` resolver (parse the text, extract the first
  `http(s)` line) — see §6 (optional). For the first cut, **document "use the
  direct stream URL, not the playlist file."**

### 1.3 yt-dlp live path — radio must NOT use it — CONFIRMED

`YtDlpAudioProvider.resolve()` **rejects** anything with `is_live` set:
`throw new UserFacingError('AUDIO_RESOLVE_FAILED', 'Live streams are not
supported.')` (`resolver/providers/ytdlp-provider.ts:60-62`). Most radio streams
are "live/continuous". Therefore radio must reach the **direct-http** path (or a
dedicated radio source), **never** the yt-dlp live path. Because direct-http only
claims hosts that the earlier providers do not (`canResolve` is host-based for
yt-dlp/Spotify: `ytdlp-provider.ts:43-52`, `spotify-provider.ts:39-44`), a plain
Icecast/Shoutcast host falls through to direct-http automatically — **no change
needed for the common case**, as long as the registry holds a non-YouTube,
non-Spotify direct URL.

### 1.4 The duration watchdog would kill a radio — CONFIRMED, must be exempt

`armDurationTimer()` force-skips **any** track after `maxTrackDurationSeconds`
(`engine/session.ts:266-277`, armed unconditionally at `:198` inside `playNow`).
A continuous radio stream has no duration and would be killed at the limit.
Radio must be **exempt** from this timer (a per-track `isLive`/`exemptFromDuration`
flag; reconcile with Agent 3, which is already making this timer conditional).

### 1.5 The now-playing panel already renders LIVE — CONFIRMED (free win)

`progressBar(elapsed, duration)` returns `🔴 LIVE / streaming · <elapsed>` when
`duration` is falsy/0 (`now-playing.ts:31-41`). A radio track with
`durationSeconds: undefined` (the normal `TrackSummary` for a stream) renders as
LIVE with **no panel change required**. `getElapsedSeconds()` already counts up
without a duration cap when `duration` is absent (`session.ts:37-42`).

---

## 2. Radio station structure (PROPOSED)

A pure, serializable shape — no I/O — so it is trivially unit-testable and can be
sourced from a TS file today or a DB row later (field names map 1:1 to a future
`radio_stations` table, §3.2 option b):

```ts
interface RadioStation {
  id: string;            // stable slug, e.g. "lofi-girl" — used in customId & /radio play station:<id>
  name: string;          // display name, e.g. "Lofi Girl — beats to relax/study to"
  category: string;      // grouping for the list/menu, e.g. "Lofi", "News", "Rock"
  streamUrl: string;     // the RESOLVED direct audio endpoint (audio/*), NOT a .pls/.m3u
  websiteUrl?: string;   // optional homepage (shown as a link / in the panel)
  description?: string;  // optional one-liner (used as select-option description)
  enabled: boolean;      // soft on/off without deleting the entry
  sort?: number;         // optional explicit ordering (lower = earlier); default by name
}
```

Notes / invariants (PROPOSED):

- `id` is the routing key everywhere (`radio:<id>` customId, `/radio play
  station:<id>`). Slugs avoid the snowflake/whitespace problems of using `name`.
- `streamUrl` must be an `http(s)` URL that passes `validateExternalUrl`
  (`security/src/url-validation.ts:92-151`) — see §5.
- **SSRF allowlist interaction (CONFIRMED behavior):** `validateExternalUrl` and
  `openSafeHttpStream` both honor `allowedDomains`. When
  `audio.allowedDomains` is **empty (the default)**, any *public* domain is
  allowed (`url-validation.ts:128,176-183`: `matchesAllowedDomain` returns true for
  empty list). When the operator **sets** `ALLOWED_AUDIO_DOMAINS`, every station's
  `streamUrl` host **must** match the allowlist or playback fails with
  `URL_UNSUPPORTED` "Links from that source are not allowed." So: **if an operator
  uses the allowlist, they must add every radio host to it.** This must be called
  out in the user doc and ideally validated at registry load (warn on any station
  whose host is not in a non-empty allowlist). Private/internal hosts are always
  blocked regardless (`isBlockedHostname`/`isBlockedAddress`,
  `url-validation.ts:153-173`).

---

## 3. Where should radios be configured? (decision)

The brief asks to weigh four options. Summary against **this** project:

| Option | What it is | Effort | Meets "not hardcoded in handler" | "Easy to add/list/select" | Verdict |
|---|---|---|---|---|---|
| **(a) Static TS/JSON data file + `RadioRegistry`** | `radio/stations.ts` array, loaded once by a registry the handler queries | **Low** (no schema/migration/admin) | **Yes** — stations live in data, handler calls `registry.list()`/`get(id)` | Add = edit the array + redeploy; list/select via registry | **RECOMMENDED (first cut)** |
| (b) DB table (`radio_stations`) + admin page | Drizzle table like other modules + EJS admin CRUD | **High** (schema, migration, repo, routes, views, validation) | Yes | Add = admin form, no redeploy | Documented **upgrade path**, not first cut |
| (c) `system_settings` JSON | One JSON blob under a `radio.stations` key in `system_settings` | Medium | Yes | Add = edit JSON (no typed UI; easy to malform) | Possible **runtime overlay**, weaker than (a) for authoring |
| (d) Env var (CSV/JSON) | `RADIO_STATIONS` in `.env`/compose | Low | Yes | Add = edit env + restart; awkward for rich records | Poor for multi-field records; only a coarse override |

**Recommendation: option (a) — a static TS data file behind a `RadioRegistry`.**

Justification specific to this repo:

- It is the **lightest** thing that satisfies all three brief requirements. The
  brief explicitly notes that *"easy to add a radio" + "not hardcoded in handler"*
  can be met by a separate data file + registry **without** a full DB+admin build.
- It matches an existing convention: the resolver already lists **providers** in a
  TS array consumed by a coordinator (`audio-module/src/index.ts:37-50` →
  `AudioResolver`), and the now-playing command hints are a const, not DB rows. A
  curated, code-reviewed station list is appropriate to ship in code.
- DB+admin (b) is real work in this codebase (every module that has it carries a
  Drizzle table, a repository, EJS views, and route handlers — see
  `database/src/schema.ts` `roleMenus`/`announcements`/`welcomeSettings`, and the
  admin routes under `apps/admin/src/routes/*`). That cost is not justified for a
  curated list that changes rarely.
- **Optional, additive overlay:** allow ops to extend/override the static list at
  runtime via either `RADIO_STATIONS` (env JSON) **or** a `system_settings` row
  keyed `radio.stations` (`system_settings` table exists:
  `database/src/schema.ts:313-319`). The registry merges `static ++ overlay` (overlay
  by `id`). This keeps authoring in code while giving operators a no-rebuild escape
  hatch, and is the natural stepping-stone toward (b) later. Keep this overlay
  **optional**; Agent 5 decides whether the first cut includes it.

### 3.1 Chosen layering (separate from the command handler)

```
config (audio.allowedDomains, timeouts; optional RADIO_STATIONS overlay)
   │
   ▼
radio/stations.ts        ← the data (the ONLY place station URLs live)
   │
   ▼
RadioRegistry            ← list(), getById(id), getByName(name), categories()
   │  (validates entries at load; merges optional overlay)
   ▼
RadioResolver / radio source builder
   │  (turns a RadioStation into a ResolvedTrack: lazy createStream via
   │   openSafeHttpStream, metadata with durationSeconds:undefined + isLive flag)
   ▼
radio-commands.ts        ← /radio list|play|stop|nowplaying + select-menu handler
   │  (asks the registry; NEVER contains a stream URL)
   ▼
existing PlayerManager / GuildPlaybackSession / now-playing panel
```

This mirrors the existing clean separation (command handler → manager → session;
resolver → providers). The registry is the analogue of the provider list; the
radio source builder is the analogue of a provider's `resolve()`.

### 3.2 Upgrade path to a DB table (if/when chosen later)

A `radio_stations` table would map field-for-field to §2 (`id`/slug `text`, `name`
`text`, `category` `text`, `streamUrl` `text`, `websiteUrl` `text` nullable,
`description` `text` nullable, `enabled` `boolean` default true, `sort` `integer`,
plus the usual `guildId uuid` nullable for per-guild stations and timestamps),
following the `roleMenus`/`announcements` shape (`schema.ts:495-521`,
`:393-429`). The `RadioRegistry` interface stays the same — only its data source
swaps from the TS array to a repository — so the command layer is unaffected.

---

## 4. Commands & how a radio plays into the session/queue (PROPOSED)

### 4.1 Command surface — RECOMMENDED: a `/radio` parent with subcommands

```
/radio list                         → list stations (text + a select menu)
/radio play station:<id-or-name>    → resolve + take over playback as LIVE
/radio stop                         → stop playback (reuses session.stop())
/radio nowplaying                   → current track panel (reuses the panel)
```

Subcommands are **CONFIRMED supported**: `CommandDefinition.subcommands`
(`core/src/contracts/commands.ts:49-62`), mapped to Discord subcommand options
(`discord-adapter/src/command-mapper.ts:42-48`, `DISCORD_OPTION_TYPES.subcommand`),
and already used in production by `/announcement list|send`
(`announcements-module/src/commands.ts:27-60`) and `/roles list|menu|refresh|remove`
(`role-menus-module/src/commands.ts:33-83`). `ctx.subcommand` is delivered on the
context (`commands.ts:26`).

`/radio play station:<value>` uses a single required `string` option
(`CommandOptionDef`, `commands.ts:5-11`). Because there is no autocomplete/choices
(see §4.4), the value is matched by the registry: try `getById`, then
case-insensitive `getByName`/slugify; on no match, reply with a short hint to use
`/radio list`.

(Flat alternative: `/radioplay`, `/radiolist`, `/radiostop` as separate
`CommandDefinition`s — works identically but pollutes the command list. The
parent+subcommand grouping is the established convention here.)

### 4.2 How a radio plays into the EXISTING session/queue model — RECOMMENDED

**A radio takes over playback like a normal `/play`** (not a queued item):

- Build a `ResolvedTrack` from the station: `metadata = { title: station.name,
  url: station.streamUrl (or websiteUrl for display), provider: 'radio',
  durationSeconds: undefined, requestedBy }`; `source` is `'arbitrary'` with a
  lazy `createStream` that calls `openSafeHttpStream(station.streamUrl, { ... })`
  — structurally identical to `DirectHttpAudioProvider`
  (`direct-http.ts:25-39`).
- **Stop/replace current playback, then play the radio**, rather than appending to
  the queue. Rationale: a radio is continuous and has no end event to advance past;
  enqueuing it behind songs would mean it "never starts" until everything ahead
  finishes, and once started it would never yield. Recommended sequence
  (DEDUCED from the session API): ensure a voice session (mirror
  `play`'s join logic, `commands.ts:99-107`), call `session.stop()` to clear
  current + queue (`session.ts:104-116`), then `session.enqueueOrPlay(radioTrack)`
  which, with nothing playing, calls `playNow` (`session.ts:67-80`). The
  now-playing panel then shows the LIVE state automatically (§1.5). Agent 5/6 may
  instead add an explicit `session.playLive(track)` helper if a cleaner seam is
  wanted, but the stop-then-play composition needs **no new session method**.
- **Duration-timer exemption (required):** mark the radio track so `playNow` does
  **not** arm `armDurationTimer` (or arms it only for finite-duration tracks). This
  is the one session change radio strictly needs (`session.ts:198` / `:266-277`),
  and it converges with Agent 3's conditional-timer work — Agent 5 must reconcile
  so both features share a single "no duration limit for this track" mechanism.
- **Stop:** `/radio stop` (and the panel's ⏹ button) reuse `session.stop()` — no
  new logic. The button handler already maps `stop` (`commands.ts:299-303`).

### 4.3 Optional `add`/`remove` (only if a DB/admin path is later chosen)

If option (b) is adopted, add `/radio add` / `/radio remove` subcommands gated by
`defaultMemberPermissions: ['ManageGuild']` (CONFIRMED supported and mapped:
`commands.ts:70`, `command-mapper.ts:55-57`). With the **recommended static-file**
source, there is **no** `add`/`remove` command — stations are added by editing
`radio/stations.ts` (see the user doc) — which keeps the first cut small.

### 4.4 Selection UX — what the platform ACTUALLY supports (decision + evidence)

This is the crux the brief flags ("do not assume autocomplete exists"). Findings:

- **Autocomplete: NOT available. CONFIRMED.** `CommandOptionDef` has only
  `{ name, description, type, required }` — **no** `autocomplete` field
  (`core/src/contracts/commands.ts:5-11`). The Discord mapper emits only
  `{ type, name, description, required }` per option and never sets
  `autocomplete: true` (`command-mapper.ts:72-79`). The adapter has **no**
  `isAutocomplete()` handler (interaction dispatch handles chat-input commands and
  `isButton()/isStringSelectMenu()` only — `adapter.ts:214-215`). So autocomplete
  cannot be offered.
- **Per-option `choices`: NOT available. CONFIRMED.** There is no `choices` field
  on `CommandOptionDef` and the mapper never emits `choices`
  (`command-mapper.ts:72-79`). So a static `choices` dropdown on the option is out.
  (Discord also caps choices at 25, which would not fit a growing station list
  anyway.)
- **Select menu (component): AVAILABLE end-to-end. CONFIRMED.**
  - Build: `OutgoingMessage.selectMenu { customId, placeholder, minValues,
    maxValues, options[] }` (`core/src/contracts/guild-service.ts:40`); rendered to
    a `StringSelectMenuBuilder` (`discord-adapter/src/guild-service.ts:355-363`).
  - Deliver as a slash reply: `replyRich` → `buildMessagePayload` →
    `buildComponents` attaches the select menu
    (`adapter.ts:392-407`, `guild-service.ts:317-318,334-365`).
  - Submission round-trips back: `interaction.isStringSelectMenu()` →
    `ComponentInteractionEvent { customId, values }` (`adapter.ts:215-232`); the
    module reads `event.values` (`events.ts:61-78`).
  - **Real precedent:** the role-menus module builds a `rolemenu:<id>` select menu
    (`role-menus-module/src/logic.ts:125-126`) and parses
    `event.customId` + `event.values` in a `component.interaction` handler
    (`role-menus-module/src/service.ts:31,46`; tests
    `service.test.ts:70-76`). The audio module already registers a
    `component.interaction` handler for its buttons
    (`audio-module/src/index.ts:74`, `commands.ts:282-321`) — the radio handler
    slots in the same way (parse `radio:` customId, ignore others).

**RECOMMENDATION:** use **subcommands + a select menu**, not autocomplete/choices:

- `/radio play station:<id-or-name>` — typed shortcut for power users (registry
  matches the value; no autocomplete, so guide users to `/radio list` on a miss).
- `/radio list` — replies with a select menu (`customId: 'radio:select'`,
  options = enabled stations, each `{ label: name, value: id, description }`,
  `placeholder: 'Pick a station'`). Selecting one fires `component.interaction`;
  the handler reads `values[0]`, resolves via the registry, and plays it (§4.2).

**Fallback for many stations (CONFIRMED limit):** a Discord string select menu
allows **at most 25 options**. When `enabled` stations exceed 25, paginate:
- group by `category` and render **one select menu per category** (or a category
  picker first, then a station picker), and/or
- add "Prev/Next page" buttons (the panel already mixes buttons + components;
  `buildComponents` supports up to 5 button rows + a select row,
  `guild-service.ts:338-364`), encoding the page in the customId
  (`radio:select:p2`), mirroring the role-menus customId-encoding pattern
  (`logic.ts:94-104`).
The `/radio play station:<name>` typed path also serves as a fallback for very
large catalogs (no 25-item ceiling).

---

## 5. Invalid / offline stream handling (decision)

Layered, reusing existing machinery (no new error types needed — the
`PlatformErrorCode` set already covers it: `shared/src/errors.ts:14-22`):

1. **Format validation at registry load (CONFIRMED tools).** For each station,
   `new URL(streamUrl)` must parse and be `http(s)`; ideally run
   `validateExternalUrl(streamUrl, { allowedDomains })`
   (`url-validation.ts:92-151`) so a private/blocked host or an allowlist mismatch
   is caught **before** a user ever picks it. Disable (or drop with a logged warn)
   any malformed entry rather than crashing the module. This can be enforced in a
   unit test over `stations.ts` (pure data → easy assertion).
2. **Optional pre-flight reachability probe (CONFIRMED safe path).** Before
   committing to playback, optionally call `openSafeHttpStream(streamUrl, {
   allowedDomains, timeoutMs, requireAudioContentType: true })`
   (`safe-stream.ts:92-179`) and immediately destroy the returned stream. This
   surfaces `URL_BLOCKED` / `URL_UNSUPPORTED` ("does not point to an audio file")
   / `AUDIO_RESOLVE_FAILED` ("source returned an error (NNN)" / "could not be
   fetched") as `UserFacingError`s the boundary already formats. Trade-off: it
   doubles the connection (probe + real stream) and some Shoutcast servers behave
   oddly on a probe GET; recommend making the probe **optional/config-gated**, with
   the lazy `createStream` at play time as the real validation. (There is no HEAD
   helper today — `openSafeHttpStream` is GET-only, `safe-stream.ts:122-126`; a
   GET-and-immediately-close is the closest reachability check without new code.)
3. **At play time (always; CONFIRMED path).** The lazy `createStream` opening the
   stream is the authoritative check. If the host is unreachable / returns
   4xx-5xx / wrong content-type, `openSafeHttpStream` throws a `UserFacingError`
   inside `playNow` → `playNow` records the failure and rethrows
   (`session.ts:192-205`); `enqueueOrPlay` surfaces it; the command boundary shows
   the safe message. If it fails *after* starting (mid-stream drop), the voice
   layer emits an `error` event → `handleEvent` increments
   `consecutiveFailures` and, at `MAX_CONSECUTIVE_FAILURES = 3`, stops and clears
   (`session.ts:17`, `:225-239`). **No new resilience needed.**

**What the user sees** (PROPOSED, using existing safe messages): an offline
station → "The source returned an error (503)." or "That link could not be
fetched." (from `safe-stream.ts:152-155,129`); a non-audio/playlist URL stored by
mistake → "That link does not point to an audio file."
(`safe-stream.ts:159-162`); an allowlist mismatch → "Links from that source are
not allowed." (`url-validation.ts:128-129`). The radio command can wrap these with
a friendlier prefix (e.g. "**<station>** is unavailable right now — " +
safeMessage) and suggest `/radio list` to pick another.

---

## 6. Proposed code changes (NOT implemented)

Radio logic stays **out of the command handler**; the handler only talks to the
registry + manager. Additive; nothing existing is rewritten.

1. **`packages/audio-module/src/radio/stations.ts`** *(new)* — the static
   `RadioStation[]` (the only place stream URLs live). Curated, code-reviewed.
2. **`packages/audio-module/src/radio/registry.ts`** *(new)* — `RadioRegistry`:
   loads + validates `stations.ts` (and merges the optional env/`system_settings`
   overlay if Agent 5 includes it); exposes `list()`, `getById(id)`,
   `getByName(name)`, `categories()`. Pure/injectable for tests.
3. **`packages/audio-module/src/radio/radio-source.ts`** *(new)* — turns a
   `RadioStation` into a `ResolvedTrack` (lazy `createStream` via
   `openSafeHttpStream`, `durationSeconds: undefined`, an `isLive`/
   `exemptFromDuration` marker). Mirrors `direct-http.ts:25-39`.
   *(Alternative: a `RadioAudioProvider` in `resolver/providers/radio-provider.ts`
   registered ahead of direct-http and matched by a `radio://<id>` pseudo-URL or by
   the resolver consulting the registry. The standalone source builder is simpler
   and avoids overloading the URL-based resolver; Agent 5 picks.)*
4. **`packages/audio-module/src/radio/radio-commands.ts`** *(new)* — the `/radio`
   `CommandDefinition` with subcommands (`list`/`play`/`stop`/`nowplaying`) and a
   `buildRadioComponentHandler` for the `radio:select` menu (parse `customId` +
   `values`, like `role-menus` and the existing audio button handler). Returns a
   `CommandDefinition[]` exactly like `buildAudioCommands` (`commands.ts:35,274`).
5. **`packages/audio-module/src/engine/session.ts`** *(small change)* — make
   `armDurationTimer` conditional so a radio/live track is exempt
   (`:198`, `:266-277`) — converge with Agent 3. Optionally add a `playLive(track)`
   convenience; not strictly required (stop-then-`enqueueOrPlay` composes today).
6. **`packages/audio-module/src/index.ts`** *(wiring)* — construct the
   `RadioRegistry`, append `buildRadioCommands(...)` to `module.commands`
   (`:64`), and add the radio `component.interaction` handler alongside the audio
   button one (`:74`). The `register-commands.ts` already spreads
   `audio.module.commands` (`apps/bot/src/register-commands.ts:79`) so a new
   `/radio` command registers with no app-level change.
7. **`packages/config/src/index.ts`** *(optional)* — if the overlay is adopted,
   add `RADIO_STATIONS` (env JSON) and/or read `system_settings['radio.stations']`;
   thread `allowedDomains`/`timeoutMs` (already present in `resolveCtx`,
   `index.ts:66-71`) into the radio source. The duration exemption rides on the
   long-track config Agent 3 introduces.
8. **(Only if option b)** `database/src/schema.ts` `radio_stations` table +
   repository + `apps/admin` routes/views. **Documented as the upgrade path; not
   in the first cut.**

Tests Agent 6 should add (DEDUCED from existing test style — pure logic is fully
testable with fakes, `src/testing/fakes.ts`): registry load/validation over
`stations.ts`; URL-format validation; select-menu build (option count/labels/
values) like `role-menus` `logic.test.ts:124-131`; component handler resolves
`values[0]` → station; offline-stream surfaces a `UserFacingError`; radio track is
exempt from the duration timer; existing audio commands still present.

---

## 7. Explicit confirmation of the three required guarantees

- **(a) Radios are NOT hardcoded in the command handler — DESIGN GUARANTEE.**
  Stations live in `radio/stations.ts` behind `RadioRegistry`; `radio-commands.ts`
  only calls `registry.list()/getById()/getByName()` and never holds a stream URL.
  This is the analogue of the existing provider-list pattern
  (`audio-module/src/index.ts:37-50`). (DEDUCED: the design enforces it; Agent 6/7
  enforce via a test that the handler imports the registry, not `stations.ts`.)
- **(b) Clear list/select method — CONFIRMED supported.** `/radio list` + a
  **select menu** (`OutgoingMessage.selectMenu` → `StringSelectMenuBuilder`,
  `guild-service.ts:355-363`; delivered via `replyRich`, `adapter.ts:392-407`;
  submission via `component.interaction.values`, `adapter.ts:215-232`,
  `events.ts:61-78`; precedent `role-menus`), plus a typed `/radio play
  station:<id-or-name>`. Autocomplete/choices are **not** available
  (`commands.ts:5-11`, `command-mapper.ts:72-79`) and are correctly **not** used.
  25-option cap handled by per-category menus / pagination (§4.4).
- **(c) Unavailable stream is handled — CONFIRMED path.** Format validation at load
  (`validateExternalUrl`), optional pre-flight probe (`openSafeHttpStream`), and
  play-time failure flowing through `UserFacingError` + the existing
  `playNow`/`handleEvent`/`MAX_CONSECUTIVE_FAILURES` machinery
  (`session.ts:17,192-205,225-239`). The user sees an existing safe message,
  wrapped with the station name and a "pick another" hint (§5).

---

## 8. Notes / contradictions with orchestrator facts

- **No contradictions** with the orchestrator's facts. All "Read first" claims in
  the brief are CONFIRMED in code: direct-http catch-all uses `openSafeHttpStream`
  with `requireAudioContentType:true` (`direct-http.ts:30-37`); yt-dlp rejects
  `is_live` (`ytdlp-provider.ts:60-62`); `armDurationTimer` would kill radio
  (`session.ts:266-277`); the panel already shows `🔴 LIVE / streaming`
  (`now-playing.ts:34-36`); `CommandDefinition` supports subcommands but **not**
  choices/autocomplete (`commands.ts:5-72`, `command-mapper.ts:72-79`); select
  menus + buttons via `component.interaction` are supported
  (`guild-service.ts:40,355-363`, `adapter.ts:215-232`); `system_settings`,
  `module_settings`, and per-module tables exist for the (b) option
  (`schema.ts:75-90,313-319,495-521`); env config via `loadConfig`
  (`config/src/index.ts:103-119,162-170`).
- **Nuance to flag for Agent 5/6 (DEDUCED):** the content-type gate **passes**
  `audio/x-scpls` / `audio/x-mpegurl` playlist types because they start with
  `audio/` (`safe-stream.ts:84`), so a `.pls`/`.m3u` URL stored by mistake would
  pass the gate and then fail in ffmpeg with a less obvious error. Registry rule:
  **store the resolved direct stream URL.** Optionally add a tiny `.pls`/`.m3u`
  text resolver (the security layer offers no playlist parsing today; this would be
  new, optional code).
- **Dependency on Agent 3:** the duration-timer exemption (§1.4, §4.2) overlaps the
  long-track work. Agent 5 must reconcile so radio (`durationSeconds: undefined` /
  `isLive`) and long tracks (`maxTrackDurationSeconds = 0`) share **one**
  "no duration limit" mechanism rather than two.
- **Minor brief-vs-reality note:** the brief says `requireAudioContentType` accepts
  "audio/mpeg, audio/aac, application/ogg". CONFIRMED it is broader: it accepts
  **any** `audio/*` or `video/*`, plus `application/ogg`,
  `application/octet-stream`, `binary/octet-stream`, **and missing/empty**
  content-type (`safe-stream.ts:79-90`). This is *more* permissive than the brief
  states — good for radio (Shoutcast often omits the header) but it is also why a
  `.pls` with an `audio/x-...` type slips through (above).

---

## Checkpoint — Agent 4 (Online radio analysis)

Status: PASS

### Modificări făcute
- Read the direct-http provider, yt-dlp provider, session/timer, now-playing
  panel, commands, the command contract + Discord command-mapper, the
  guild-service/events contracts, the discord adapter's interaction dispatch and
  `replyRich`/`buildMessagePayload`/`buildComponents`, the security
  `safe-stream`/`url-validation`, config, the DB schema, and the role-menus +
  announcements modules (subcommand + select-menu precedents).
- Produced this analysis + a proposed, additive design: a static
  `radio/stations.ts` behind a `RadioRegistry`, a radio source builder, a
  `/radio` command group with subcommands + a select menu, a duration-timer
  exemption, and layered offline-stream handling — all keeping station URLs out
  of the command handler.
- Wrote the user/developer-facing planned doc `docs/music/online-radio.md`.

### Comenzi rulate
- File reads + content/glob searches only (Read/Grep/Glob). **No build/test/docker
  run; no radio stream was contacted; nothing was executed.**

### Validat efectiv (cited to file:line)
- Radio reaches direct-http (yt-dlp/Spotify are host-gated; direct-http is the
  last catch-all); the content-type gate's true acceptance set; yt-dlp `is_live`
  reject; the duration watchdog that must be exempted; the panel's LIVE rendering.
- **CommandDefinition supports subcommands but NOT choices/autocomplete**
  (`commands.ts:5-72`, `command-mapper.ts:72-79`; no `isAutocomplete` in
  `adapter.ts`), and **select menus + buttons ARE supported and round-trip**
  (`guild-service.ts:355-363`, `adapter.ts:215-232`, role-menus precedent).
- SSRF allowlist interaction: empty `allowedDomains` ⇒ any public domain; a
  non-empty allowlist requires every station host to be listed.

### Nevalidat
- Real reachability/behavior of any specific Icecast/Shoutcast endpoint
  (DEDUCED from the content-type rule + common streaming behavior; no stream was
  contacted).
- Whether a `.pls`/`.m3u` with an `audio/x-...` type actually fails in ffmpeg in
  this image (DEDUCED) and whether a pre-flight GET-probe upsets specific
  Shoutcast servers.
- Real Discord voice playback of a radio stream (needs a live token + network).

### Probleme găsite
- **Content-type gate passes `.pls`/`.m3u` (`audio/x-...`) playlist URLs** that
  are not real audio (`safe-stream.ts:84`) → registry must store the resolved
  direct stream URL; optional small `.pls`/`.m3u` resolver noted.
- Brief understates the accepted content-types (it is broader, incl. empty) — minor
  correction, not a blocker.

### Următoarea etapă poate continua?
Da. The design is additive and compatible with Agents 2 (playlists) and 3 (long
tracks). Agent 5 must (1) reconcile the duration-timer exemption with Agent 3's
conditional timer into a single mechanism, (2) decide whether to include the
optional env/`system_settings` overlay in the first cut, and (3) decide between a
standalone radio source builder vs a `RadioAudioProvider`.
