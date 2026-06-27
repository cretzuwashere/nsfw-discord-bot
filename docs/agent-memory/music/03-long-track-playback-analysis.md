# Agent 3 — Long-Track Playback: Analysis + Proposed Design

> Read-only analysis. NO source code was modified. This is an analysis and a
> *proposed* design for letting the music system play multi-hour tracks
> reliably; implementation is Agent 6's job (per `00-orchestrator-plan.md`).
>
> Author: Agent 3. Date: 2026-06-27. Language: English.
> Every claim is marked **CONFIRMED** (read in code this session, cited to
> `file:line`) or **DEDUCED** (reasoned from code + documented behavior of
> `@discordjs/voice` / ffmpeg / yt-dlp, not executed — nothing was run).

---

## 0. Scope & headline conclusions

The brief asks: why does a multi-hour track not play today, what in the
streaming layer would interrupt it, does the bot wrongly clean up long streams,
and how do we *plan* to support long content safely.

**Headline:** A long track is blocked today by an explicit, deliberate duration
limit enforced in **three** places (the orchestrator named two — see §1; the
third is the Spotify provider). The streaming/voice layer itself has **no idle
timeout and no request timeout that would kill a long stream**, so once a track
is *allowed* to start, the main risk is not a timer firing — it is the
single, un-reconnecting `yt-dlp → ffmpeg` pipe surviving hours of network.

Three guarantees this proposal makes (expanded in §5 and §6):

- **(a) No useful protection is removed.** The `0 = unlimited` change only
  *disables* the pre-queue reject and the watchdog *when the operator explicitly
  opts in*. `MAX_CONSECUTIVE_FAILURES`, the consumer-close child kill, the
  `is_live` reject, the `maxQueueSize` bound, the SSRF allowlist, and the single
  terminal-event contract all stay exactly as they are.
- **(b) There is a defined strategy for an expired / dropped stream.** The
  classic "expired googlevideo URL" problem is already mitigated by lazy yt-dlp
  (§4.6). For a mid-track *drop*, we keep the current "count as error → advance"
  behavior as the floor and propose an optional single bounded auto-retry of the
  same track (§5.3) — explicitly opt-in and risk-bounded.
- **(c) There is a defined strategy for manual stop during a long track.**
  `/stop`, `/skip`, `/leave`, and disconnect already clear the watchdog timer and
  kill the child process through verified paths (§3, §5.4). The proposal must not
  regress these, and includes a test checklist to prove it.

**Recommended decisions** (justified in §5):
- Limit semantics: **`0 = unlimited`**. Requires a zod `min(1)` → `min(0)`
  change plus a guard in *both* the provider reject and the session watchdog. See
  §5.1 for the exact change sites.
- Reconnect/retry: **add ffmpeg reconnect flags + bounded yt-dlp robustness**
  (DEDUCED-effective) and **one** optional same-track auto-retry. Do **not** add
  an idle/inactivity timeout to the player. See §5.3.

---

## 1. Does the system have a duration limit? Where?

**Yes — enforced in three places, two of them named by the orchestrator.**

### 1.1 Pre-queue reject (provider) — CONFIRMED
`packages/audio-module/src/resolver/providers/ytdlp-provider.ts:67-72`:

```ts
if (durationSeconds !== undefined && durationSeconds > this.options.maxTrackDurationSeconds) {
  throw new UserFacingError('TRACK_TOO_LONG', `That track is too long (limit ${...}s).`);
}
```

The metadata `duration` comes from the cheap `-J` call
(`ytdlp-provider.ts:55-58`). A track whose *known* metadata duration exceeds the
limit never enters the queue. Note the guard is `durationSeconds !== undefined`:
a track with **unknown** duration is *not* rejected here and slips through to the
watchdog. The `is_live` reject (`ytdlp-provider.ts:60-62`) blocks live streams
entirely (they would otherwise be infinite).

### 1.2 Watchdog force-skip (session) — CONFIRMED
`packages/audio-module/src/engine/session.ts:266-277` (`armDurationTimer`):

```ts
const ms = this.limits.maxTrackDurationSeconds * 1000;
this.durationTimer = setTimeout(() => {
  this.logger.info({ ... }, 'track exceeded the maximum duration — skipping');
  void this.skip();
}, ms);
this.durationTimer.unref?.();
```

Armed inside `playNow()` after a successful start (`session.ts:198`). This is the
backstop for anything that slipped past §1.1 (unknown-duration tracks, or
metadata that under-reported the real length). At the limit it calls `skip()`,
which is a clean, intentional stop (§3).

### 1.3 Spotify provider reject — CONFIRMED (third site, not in the brief)
`packages/audio-module/src/resolver/providers/spotify-provider.ts:68-73` — an
identical `TRACK_TOO_LONG` guard against the matched YouTube result's duration.
Any `0 = unlimited` change must touch this file too, or Spotify long matches stay
blocked while YouTube ones become unlimited (inconsistent).

### 1.4 Where the limit value comes from — CONFIRMED + one DEDUCED gap
- Env/zod: `MAX_TRACK_DURATION_SECONDS`, default `3600`, **`min(1)`**
  (`packages/config/src/index.ts:46`). Surfaced as `audio.maxTrackDurationSeconds`
  (`index.ts:107, 165`).
- Wired once at module construction into both the providers' `limits`
  (`packages/audio-module/src/index.ts:43-47`) and the `PlayerManager` limits
  (`index.ts:53-54`), then into every `GuildPlaybackSession`
  (`manager.ts:27-33`, `session.ts:47, 268`).
- **DEDUCED gap:** a per-guild override column `maxTrackDurationSeconds` exists in
  the DB (`packages/database/src/schema.ts:120`,
  `packages/database/src/repositories/guilds.ts:62`) but is **never read into the
  live `PlayerManager` limits** — the manager is built solely from global config
  (`index.ts:51-58`) and `limits` is a single shared object
  (`manager.ts:14-18, 30`). So today the limit is **global only**; the per-guild
  knob is dormant. Relevant to §5.1: if Agent 6 wants per-guild unlimited, that
  wiring must be added too.

---

## 2. Streaming-layer timeouts relevant to long playback

### 2.1 `requestTimeoutMs` — metadata only, NOT the long stream — CONFIRMED
`audio.requestTimeoutMs` (default `15000`, env `AUDIO_REQUEST_TIMEOUT_MS`,
`config/src/index.ts:47, 108, 166`) is passed **only** as `resolveCtx.timeoutMs`
(`audio-module/src/index.ts:69`). It flows to `ResolveContext.timeoutMs`
(`resolver/types.ts:9`) and is used in exactly two ways:

1. The metadata `-J` call: `runner.json(['-J', ...], ctx.timeoutMs)`
   (`ytdlp-provider.ts:55-57`, `spotify-provider.ts:50-53`), which sets
   `execFile(..., { timeout: timeoutMs })` (`ytdlp-runner.ts:48-53`).
2. The Spotify oEmbed fetch and `direct-http` provider connect/read timeout
   (`spotify-provider.ts:99`, `direct-http.ts:33`).

**The streaming spawn has no timeout.** `runner.stream(...)`
(`ytdlp-runner.ts:81-114`) calls `spawn()` with **no `timeout` option** and never
receives `ctx.timeoutMs`. **CONFIRMED:** `requestTimeoutMs` does **not** kill the
long-running media stream — it only bounds metadata resolution. A 4-hour track
is *not* cut at 15 s by this setting.

### 2.2 `@discordjs/voice` player behaviors — CONFIRMED
`packages/discord-adapter/src/voice-session.ts:82-84`:

```ts
this.player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
});
```

- **`noSubscriber: Pause`** — if no one is listening (bot alone / not subscribed),
  the player **pauses** rather than stopping. This *protects* long tracks from
  being torn down when the channel empties; it does not end them. **CONFIRMED.**
- **`maxMissedFrames`** is **not configured** — the default applies. **DEDUCED**
  (general @discordjs/voice knowledge): with `noSubscriber: Pause` the
  missed-frames path is not the relevant failure mode here; the default does not
  force an Idle transition for a normally-playing, subscribed stream. Not a
  long-track risk in this config.
- The only explicit timeouts in the voice layer are **startup-bounded**:
  `entersState(connection, Ready, 20_000)` (`voice-session.ts:41`) and
  `entersState(player, Playing, 15_000)` (`voice-session.ts:161`). Both gate the
  *start* of playback, not its duration. **CONFIRMED.**

### 2.3 Idle / inactivity timeout — none for the stream — CONFIRMED
There is **no** "leave after N minutes idle" timer and **no** per-track wall
clock other than the duration watchdog (§1.2). Once a track starts and stays
subscribed, nothing in the player or adapter ends it on a timer. **CONFIRMED**
(searched the whole `packages` tree; the only `setTimeout` in the audio path is
`armDurationTimer`).

---

## 3. Does the bot wrongly clean up long streams?

**No — the cleanup paths are correct and intentional; none fires on a timer
except the duration watchdog (which is the *limit itself*, not a bug).**

Three cleanup mechanisms, all verified:

### 3.1 Duration watchdog (`armDurationTimer` / `clearDurationTimer`) — CONFIRMED
The timer is the *only* time-based teardown. It is **cleared** on every terminal
event (`handleEvent` → `clearDurationTimer()`, `session.ts:215`), on every
intentional stop (`beginIntentionalStop`, `session.ts:258-264`), and on
`destroy()` (`session.ts:158`). It is `unref()`-ed (`session.ts:276`) so it never
keeps the process alive. With `0 = unlimited` (§5.1) this timer simply is not
armed → no force-skip.

### 3.2 Consumer-close child kill — CONFIRMED, correct
`ytdlp-runner.ts:107-111`: when `child.stdout` closes (track finished, skipped,
stopped — i.e. ffmpeg/the resource stopped pulling), the runner SIGKILLs yt-dlp
if still alive. This is the right behavior: it prevents orphaned downloaders. It
fires *because* the consumer ended, never on a timer, so it does **not** cut a
healthy long track. The voice layer destroys the source stream in
`cleanupStream()` (`voice-session.ts:216-221`), which triggers this close. **No
wrongful cleanup.**

### 3.3 `destroy()` / disconnect paths — CONFIRMED, correct
- `GuildPlaybackSession.destroy()` (`session.ts:157-174`): clears the timer,
  finishes history, `beginIntentionalStop()` (suppresses the resulting
  `finished`), clears the queue, then `voice.stop()` + `voice.disconnect()`.
- `DiscordVoiceSession.handleDisconnected()` (`voice-session.ts:223-240`):
  **standard reconnect grace** — races `Signalling`/`Connecting` for 5 s. If the
  bot was *moved* between channels it keeps the session alive (long track
  survives a channel move). Only a true loss destroys the connection. **This is
  the correct behavior and is good for long tracks.** **CONFIRMED.**
- `handleDestroyed()` (`voice-session.ts:242-250`): settles the terminal event
  **before** `player.stop(true)` so the synthetic Idle is not mis-delivered as a
  bogus `finished` — it is delivered as `error: 'voice connection closed'`. The
  engine then counts one failure and advances. Correct.

**Conclusion:** the system does not wrongly tear down long streams. The only
time-based interruption is the duration *limit*, which is by design.

---

## 4. Likely problem areas for multi-hour content

Ranked by likelihood/impact for a real multi-hour single track. CONFIRMED =
verified in code; DEDUCED = reasoned from documented tool behavior (not run).

### 4.1 Long-running `yt-dlp → ffmpeg` pipe surviving network hiccups — HIGHEST RISK (DEDUCED)
This is the real problem after the limit is lifted. The whole track is one
`spawn`ed yt-dlp process (`ytdlp-runner.ts:81-85`) piped through one ffmpeg
instance inside `createAudioResource(..., { inputType: StreamType.Arbitrary })`
(`voice-session.ts:154-157`). For hours, that pipe must not break on a transient
TCP reset or a YouTube CDN edge rotation.

- **No ffmpeg reconnect flags are configured.** `createAudioResource` is called
  with **no ffmpeg/prism-media arguments** (`voice-session.ts:154-157`) — ffmpeg
  runs with @discordjs/voice defaults. There is **no**
  `-reconnect 1 -reconnect_streamed 1 -reconnect_at_eof 1
  -reconnect_delay_max ...` anywhere. **CONFIRMED** (grepped the tree; the only
  ffmpeg spawn with explicit args is the validation script
  `scripts/check-streaming.ts:19`, not the live path). **DEDUCED:** these flags
  matter only when ffmpeg itself fetches over HTTP; here ffmpeg reads from a
  *pipe* (`pipe:0` semantics via `StreamType.Arbitrary`), so ffmpeg's own
  `-reconnect` flags act on its **input**, which is the OS pipe, not the network
  — **they do not help when the network actor is yt-dlp.** The robustness must
  live on the **yt-dlp** side, not ffmpeg's (corrects a tempting but wrong fix).
- **yt-dlp has no robustness flags for the stream.** `runner.stream()` sends only
  `-f bestaudio/best -o -` plus `COMMON_ARGS`
  (`--no-playlist --no-warnings --no-progress --no-cache-dir`,
  `ytdlp-runner.ts:27`). No `--retries`, `--fragment-retries`,
  `--retry-sleep`, `-N/--concurrent-fragments`, or `--http-chunk-size`.
  **CONFIRMED absent.** **DEDUCED:** for a long track, yt-dlp's default
  fragment-retry behavior is the thing that determines survival; explicit
  `--fragment-retries` / `--retries` / `--retry-sleep` would harden it
  meaningfully. `--http-chunk-size` can help with throttling (see §4.5). `-N`
  (concurrent fragments) speeds the *download* but is irrelevant to a real-time
  audio stream that consumes at 1x — not recommended for streaming-to-stdout.

### 4.2 Backpressure / buffering over hours — MEDIUM (DEDUCED)
The pipeline is demand-driven: ffmpeg pulls from yt-dlp's stdout, the player
pulls from ffmpeg at the Opus frame rate (~50 fps / real-time). If the consumer
ever stalls (e.g. `noSubscriber: Pause`, §2.2), yt-dlp's stdout buffer fills and
the OS pipe applies backpressure — yt-dlp blocks on write rather than buffering
unboundedly. **DEDUCED:** this is correct and means a *paused* long track does
not leak memory through buffering. **Risk:** if yt-dlp blocks on a full pipe for
a very long pause, YouTube may time out the underlying HTTP connection
server-side, surfacing later as a stream error → the §4.1 robustness flags are
the mitigation. No unbounded in-process buffer was found.

### 4.3 Voice state: alone-in-channel pause — LOW, already handled (CONFIRMED)
`NoSubscriberBehavior.Pause` (`voice-session.ts:83`) pauses (does not stop) when
unsubscribed, and the elapsed clock is pause-aware
(`session.ts:32-42, 125-142`). A long track left alone pauses and resumes
cleanly. No teardown. (Possible future enhancement, out of scope: an explicit
"empty channel for N minutes → leave" — currently absent, which means a paused
long track can sit indefinitely. Documented, not proposed here.)

### 4.4 Expired stream URL — MITIGATED by lazy yt-dlp (CONFIRMED + DEDUCED)
The queued item holds **no** pre-signed googlevideo URL. `createStream` is a
closure capturing only `rawUrl`; the downloader spawns lazily at play time
(`ytdlp-provider.ts:86-95`, design comment `ytdlp-provider.ts:11-14`,
`core/src/contracts/voice.ts:9`). **CONFIRMED.** **DEDUCED:** because yt-dlp is
the *live* downloader (not the bot handing ffmpeg a 6-hour-old signed URL), the
classic "URL expired while it sat in the queue" failure cannot happen — yt-dlp
re-derives a fresh URL the moment playback starts. The residual risk is only the
*single* signed URL expiring **mid-multi-hour-playback**, which is a yt-dlp
fragment-retry concern (§4.1), not a queue-staleness concern. The orchestrator's
framing is correct.

### 4.5 YouTube throttling — MEDIUM (DEDUCED)
Long downloads can hit YouTube's per-connection throttling. yt-dlp's standard
mitigations (`--http-chunk-size`, format selection, sometimes an alternate
player client) are **not** configured. Since playback consumes at 1x real-time,
mild throttling is often tolerable; severe throttling surfaces as a stall → the
§4.1 retry flags help recover. **DEDUCED**, not executed.

### 4.6 Memory leaks — LOW; current code is clean (CONFIRMED)
- **Timers:** single `durationTimer`, always cleared and `unref()`-ed
  (`session.ts:279-284, 276`). No accumulation.
- **Listeners:** the player's `stateChange`/`error` listeners are attached once in
  the constructor (`voice-session.ts:87-99`), not per track — so no
  per-track listener accumulation over a long session. **CONFIRMED.** (One
  per-stream listener `stream.on('error', ...)` is added per `play()`,
  `voice-session.ts:150`, but the prior stream is destroyed in `cleanupStream()`
  first, `voice-session.ts:146, 216-221`, so it is collected.)
- **Child processes:** killed on consumer close (§3.2). No orphan accumulation.
- DEDUCED: nothing in the long-track path grows unboundedly.

### 4.7 Queue lock / re-entrancy — LOW (CONFIRMED, with a note)
`skip()`/`advance()`/`handleEvent()` are not mutex-guarded but rely on the single
terminal-event contract (`voice-session.ts:52-58, 206-214`) plus
`suppressNextFinish` (`session.ts:30-31, 210-213, 258-264`) to avoid
double-advance. The watchdog calls `skip()` (`session.ts:274`), which sets
`suppressNextFinish` and stops the player; the engine-driven `finished` is then
ignored. **CONFIRMED** this is consistent for the long-track case. DEDUCED edge:
if `0 = unlimited` is implemented by *not arming* the timer (recommended), this
whole interaction simply doesn't occur — strictly simpler.

---

## 5. Desired behavior + PROPOSED (not implemented) changes

> All of §5 is a **proposal**. Nothing here is implemented. Agent 6 owns the code.

### 5.1 Allow long tracks: `0 = unlimited` (RECOMMENDED)

**Recommended semantics:** `maxTrackDurationSeconds === 0` ⇒ unlimited — disables
**both** the pre-queue reject and the watchdog. Any positive value keeps today's
behavior exactly.

**Exact change sites (all four):**

1. **zod schema** — `packages/config/src/index.ts:46`: change
   `.min(1)` → `.min(0)` on `MAX_TRACK_DURATION_SECONDS`. (Keep
   `.int()`; default stays `3600`.) This is the only schema change.
2. **yt-dlp provider reject** —
   `packages/audio-module/src/resolver/providers/ytdlp-provider.ts:67`: guard the
   reject so `0` means no limit, e.g.
   `if (max > 0 && durationSeconds !== undefined && durationSeconds > max)`.
3. **Spotify provider reject** —
   `packages/audio-module/src/resolver/providers/spotify-provider.ts:68`: same
   guard (do not forget this third site, §1.3).
4. **Session watchdog** —
   `packages/audio-module/src/engine/session.ts:266-277` (`armDurationTimer`):
   early-return when `this.limits.maxTrackDurationSeconds <= 0` so no timer is
   armed. (Cleaner than arming a huge/zero timeout.)

**Optional / nice-to-have:** wire the dormant per-guild
`guild_settings.maxTrackDurationSeconds` (§1.4) into the live limits so a guild
can opt into unlimited independently. This is a larger change (the `limits`
object is shared and built once in `index.ts:51-58`); recommend deferring unless
Agent 5 requests per-guild config. Document as future work.

**Why `0` and not a sentinel like `-1` or `Infinity`:** `0` is the natural
"off/none" value, survives `z.coerce.number().int()` cleanly, and reads well in
`.env`. `Infinity` does not round-trip through env vars.

### 5.2 Optional confirmation message for very long content (RECOMMENDED, light)
When a resolved track's known `durationSeconds` exceeds a soft threshold (propose
a constant, e.g. `LONG_TRACK_NOTICE_SECONDS = 2 * 3600`), the `/play` reply
should note it, e.g. *"This is 3h12m long — playing."* This is a **message-only**
change in the command/reply layer (`packages/audio-module/src/commands.ts`,
reusing `formatDuration` from `@botplatform/shared`); it does **not** gate or
block playback and does **not** touch the engine. For unknown-duration tracks the
now-playing panel already shows `🔴 LIVE / streaming` (`now-playing.ts:31-36`),
so no change there. Keep it informational, not a blocking confirm dialog
(avoids a second round-trip and a stuck "awaiting confirmation" state).

### 5.3 Recovery if the stream drops mid-track — RECOMMENDED (bounded)
**Current behavior (CONFIRMED):** a mid-track failure surfaces as a player
`error` → `handleEvent` (`session.ts:225-239`) → history `failed`,
`consecutiveFailures++`, then `advance()` to the next queued track. With an empty
queue, playback simply ends. There is **no** retry of the same track.

**Proposal (two parts):**

- **(A) Harden the pipe so drops are rarer (preferred, low risk).** Add yt-dlp
  robustness flags to `runner.stream()` (`ytdlp-runner.ts:81-85`): e.g.
  `--retries infinite` (or a high finite count), `--fragment-retries infinite`,
  and a small `--retry-sleep`. **Do NOT add `-N`** (concurrent fragments) for the
  streaming path — it helps bulk downloads, not 1x real-time consumption, and can
  increase throttling. **Do NOT rely on ffmpeg `-reconnect*` flags** — ffmpeg
  reads a pipe here, so those act on the pipe, not the network (§4.1). This is
  the single most effective change and carries essentially no behavioral risk.
- **(B) One optional same-track auto-retry (opt-in, bounded).** On a mid-track
  `error` *after meaningful progress* (e.g. elapsed > a few seconds), re-invoke
  `playNow(sameTrack)` **once** before falling through to `advance()`. Guard it
  with a per-track `retriedOnce` flag and **do not** reset
  `consecutiveFailures` on the retry attempt, so a hard-broken track still hits
  `MAX_CONSECUTIVE_FAILURES` and stops.
  - **Risk (documented):** a same-track retry restarts the track **from 0**
    (the pipe has no seek/resume) — for a 3-hour track that just dropped at 2h59m
    this is a bad UX (replays the whole thing). **Recommendation:** prefer (A);
    make (B) **off by default** and only retry when elapsed is *small* (e.g. the
    stream failed to get going), where a from-zero restart is acceptable. For
    failures deep into a long track, advancing is the better default than
    replaying hours. State this trade-off in the user doc.

**Net recommendation:** ship (A). Treat (B) as optional and conservative.

### 5.4 Keep skip/stop fully functional during a long track — VERIFIED today; protect in tests
Both already do the right thing and must be regression-protected:
- **`skip()`** (`session.ts:83-102`) → `beginIntentionalStop()`
  (`session.ts:258-264`) clears the watchdog (`clearDurationTimer`) and stops the
  player (which closes the stream → SIGKILLs yt-dlp, §3.2). **CONFIRMED.**
- **`stop()`** (`session.ts:104-116`) → same `beginIntentionalStop()`, clears the
  queue, resets `consecutiveFailures`. **CONFIRMED.**
- **`/leave` / `destroy()`** (`session.ts:157-174`, `manager.destroySession`
  `manager.ts:42-48`) → clears the timer and disconnects. **CONFIRMED.**

**Proposal:** add explicit tests that, while a watchdog timer is armed (or would
be), `skip`/`stop`/`destroy` (a) clear the timer and (b) cause the child to be
killed — using the existing test seams (`session.test.ts` already exercises a
`maxTrackDurationSeconds: 5` watchdog at `session.test.ts:146`; extend it to
assert timer-clear on manual stop, and add a fake runner that records `kill`).

### 5.5 Correct cleanup on disconnect — VERIFIED; no change needed, add a test
`destroy()` clears the timer (`session.ts:158`) and the consumer-close kill
(`ytdlp-runner.ts:107-111`) reaps the process; `handleDisconnected`
(`voice-session.ts:223-240`) keeps the session alive across channel moves and
only tears down on real loss. **CONFIRMED** no leaked timers/processes in the
disconnect path. **Proposal:** a test asserting `durationTimer` is null and the
child received `kill` after `destroy()`.

---

## 6. Confirmations required by the brief

- **(a) Proposed changes do NOT remove useful protections.** Confirmed. `0 =
  unlimited` is opt-in and only suppresses the duration reject + watchdog when the
  operator sets it. `is_live` reject, `MAX_CONSECUTIVE_FAILURES`,
  consumer-close kill, `maxQueueSize`, SSRF allowlist, startup `entersState`
  timeouts, `noSubscriber: Pause`, and the single terminal-event contract are all
  untouched. The metadata `requestTimeoutMs` is untouched (it never affected the
  stream anyway, §2.1).
- **(b) Strategy for expired/dropped stream exists.** Confirmed. Expired-URL is
  already mitigated by lazy yt-dlp (§4.4). Mid-track drop strategy: harden the
  yt-dlp pipe with retry flags (§5.3-A) + keep the existing error→advance floor,
  with an optional bounded same-track retry (§5.3-B) whose from-zero risk is
  documented.
- **(c) Strategy for manual stop during a long track exists.** Confirmed.
  `skip`/`stop`/`leave`/`destroy` all clear the watchdog and kill the child
  through verified paths (§5.4); the proposal adds regression tests rather than
  changing behavior.

---

## 7. Open questions / handoffs for Agent 5 & 6

- **Per-guild unlimited:** the DB column exists but is dormant (§1.4). Decide
  whether to wire it; if yes it is a bigger change than the global `0` knob.
- **Overlap with Agent 2 (playlists) & Agent 4 (radio):** Agent 2 proposes lazy
  per-item resolution and a `MAX_PLAYLIST_ITEMS` cap; the watchdog change here is
  orthogonal but Agent 5 should reconcile the duration timer with any radio
  (effectively-infinite) source — radio likely wants `0 = unlimited` semantics by
  construction, which this proposal already enables.
- **ffmpeg flag surface:** if Agent 6 later switches from `StreamType.Arbitrary`
  (pipe) to letting ffmpeg fetch a URL directly, *then* ffmpeg `-reconnect*` flags
  become relevant. With today's pipe architecture they are not (§4.1) — note for
  whoever revisits the resource pipeline.

---

## Checkpoint — Agent 3 (long-track playback analysis)

Status: PASS

### Modificări făcute
- Read the full session/voice/runner/provider/config chain plus the now-playing
  panel and the manager wiring.
- Produced this analysis + a proposed, opt-in design: `0 = unlimited` (4 change
  sites), yt-dlp pipe robustness flags, an optional bounded same-track retry, a
  long-content notice message, and a test checklist that protects
  skip/stop/disconnect cleanup.
- Wrote the user/developer-facing planned-behavior doc
  `docs/music/long-track-playback.md`.

### Comenzi rulate
- File reads only (Read / Grep / Bash `ls`). **No build/test/docker run.
  yt-dlp, ffmpeg, and @discordjs/voice were NOT executed.**

### Validat efectiv
- The duration limit exists in **three** places (provider reject
  `ytdlp-provider.ts:67`, Spotify reject `spotify-provider.ts:68`, watchdog
  `session.ts:266`), cited to file:line.
- `requestTimeoutMs` bounds **metadata only**, never the long stream
  (`index.ts:69` → `runner.json`; `runner.stream` has no timeout,
  `ytdlp-runner.ts:81-114`).
- No idle/inactivity timeout; `noSubscriber: Pause`; only startup `entersState`
  timeouts (`voice-session.ts:41, 161, 83`).
- No ffmpeg reconnect flags and no yt-dlp robustness flags are configured in the
  live path (grepped tree; only the validation script spawns ffmpeg with args).
- Cleanup paths (watchdog clear, consumer-close kill, destroy/disconnect) are
  correct and not time-based except the watchdog itself.
- Lazy yt-dlp mitigates the expired-URL problem (`ytdlp-provider.ts:86-95`).

### Nevalidat
- Real multi-hour playback survival and the exact failure surface of a dropped
  yt-dlp/ffmpeg pipe (DEDUCED from documented behavior, not run — needs a live
  voice token + network + hours).
- The precise effect of specific yt-dlp retry flags / `--http-chunk-size` on a
  throttled long stream (DEDUCED).
- Whether `maxMissedFrames` default ever matters under `noSubscriber: Pause`
  (DEDUCED: not in this config).

### Probleme găsite
- **Third reject site:** the brief named two limit enforcers; Spotify
  (`spotify-provider.ts:68`) is a third and must be included in the `0 =
  unlimited` change or behavior is inconsistent.
- **Dormant per-guild limit:** `guild_settings.maxTrackDurationSeconds`
  (`schema.ts:120`, `guilds.ts:62`) is never read into the live `PlayerManager`
  limits — the limit is global-only today.
- **ffmpeg-reconnect would be the wrong fix:** ffmpeg reads a pipe here, so its
  `-reconnect*` flags act on the pipe, not the network — robustness must live on
  the yt-dlp side. (Corrects a tempting mis-fix; no contradiction with the
  orchestrator, which asked us to *investigate* both.)

### Următoarea etapă poate continua?
Da. The design is opt-in and additive: it removes no protection, is compatible
with Agent 2 (playlists) and Agent 4 (radio — which benefits from `0 =
unlimited`), and hands Agent 5 the per-guild-config and timer-reconciliation
decisions. Agent 6 has four precise change sites for the limit and a clear,
risk-bounded reconnect/retry recommendation.
