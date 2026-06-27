# Agent 0 — Orchestrator Plan (Music System Extension)

> Mission: incrementally extend the existing Discord music system with
> **YouTube playlist support**, **long-track (multi-hour) playback**, and
> **selectable online radio**, without breaking the current single-video
> YouTube play path. Work is split across specialized agents (0–8); each leaves
> a memory file for the next.
>
> Author: main orchestrator process. Date: 2026-06-27.
> Language: English (matches the existing `docs/*` and the codebase). Checkpoint
> blocks use the brief's PASS/PARTIAL/FAIL format.

---

## 0. Coexistence decision (important)

A **separate, prior documentation-pass orchestration is still running in the
background** and is actively writing flat files into `docs/agent-memory/`
(`00-orchestrator-plan.md`, `01-project-inventory.md`,
`03-architecture-analysis.md`, `04-discord-bot-analysis.md`,
`05-environment-and-configuration.md`, … observed appearing live at 01:46–01:47
on 2026-06-27). Those files describe the **whole repo** (architecture, Docker,
testing) — a different effort from this music task.

To avoid filename/number collisions and not clobber that live pass, **all
music-orchestration memory files live under `docs/agent-memory/music/`** with the
exact names the brief requires:

```
docs/agent-memory/music/
  00-orchestrator-plan.md            (this file)
  01-current-music-system-analysis.md
  02-youtube-playlist-analysis.md
  03-long-track-playback-analysis.md
  04-online-radio-analysis.md
  05-implementation-plan.md
  06-implementation-validation.md
  07-regression-validation.md
  99-final-orchestrator-report.md
```

Final user-facing music documentation goes in `docs/music/` (as the brief
specifies). General technical docs, if updated, go in `docs/technical/`. The
prior pass's `docs/agent-memory/01-project-inventory.md` is **reused as-is** as
the repo file map — not duplicated.

---

## 1. Project identity (verified, condensed)

Full inventory: `docs/agent-memory/01-project-inventory.md`. Relevant essentials
for this task (verified by reading the files this session):

| Aspect | Value | Source |
|---|---|---|
| Language / modules | TypeScript, Node ESM, `.js`-suffixed relative imports | `package.json`, `tsconfig.base.json` |
| Discord | discord.js `^14.26` + `@discordjs/voice` `^0.19` | `pnpm-workspace.yaml` catalog |
| Package manager | pnpm `10.34.3` workspaces (`node-linker=hoisted`) | `package.json` |
| Run system | **Docker Compose** (host has NO Node) | `docker-compose.yml` |
| Audio extraction | **yt-dlp** binary (pinned 2026.06.09 in images) | `Dockerfile`, `ytdlp-runner.ts` |
| Tests | vitest (unit + integration), Playwright e2e | `vitest.config.ts` |
| **Dev stack status** | `db` (healthy) + `app` toolbox **running now** → `docker compose exec app pnpm …` works | `docker compose ps` |

The music feature lives entirely in **`packages/audio-module`** plus the audio
config block in **`packages/config/src/index.ts`** and the `.env`/compose env
surface. Slash-command registration is collected in
`apps/bot/src/register-commands.ts`.

---

## 2. Current music system — snapshot (verified, file:line)

Layering is already clean (command handler → manager → session → queue, and
resolver → providers). **This is extensible; a rewrite is NOT warranted.**

- **Commands** (`packages/audio-module/src/commands.ts`): `join`, `leave`,
  `play`, `queue`, `skip`, `pause`, `resume`, `stop`, `nowplaying`, `controls`.
  `play` takes a single `url` string, defers, ensures a voice session, calls
  `resolver.resolve(url)` → one track → `session.enqueueOrPlay(track)`.
- **Resolver** (`resolver/resolver.ts`): SSRF-validates the URL, routes to the
  first provider whose `canResolve(url)` is true. Returns **exactly one**
  `ResolvedTrack`.
- **Providers**: `YtDlpAudioProvider` (YouTube/SoundCloud), `SpotifyAudioProvider`,
  `DirectHttpAudioProvider` (catch-all for http(s)). Order matters; direct-http
  is last.
- **yt-dlp runner** (`resolver/ytdlp-runner.ts`): `COMMON_ARGS` includes
  **`--no-playlist`** (line 27) → playlists are deliberately disabled today.
  `json()` (metadata, `maxBuffer` 20 MB) and `stream()` (lazy, killed with the
  consumer). Cookies file optional.
- **Session** (`engine/session.ts`): bounded FIFO queue, now-playing,
  best-effort history/queue persistence. `armDurationTimer()` (line 266)
  **force-skips** any track once it passes `maxTrackDurationSeconds`.
  `MAX_CONSECUTIVE_FAILURES = 3` clears the queue after 3 errors (partial-error
  resilience already exists). Pause/resume/skip/stop all implemented and
  pause-aware for the elapsed clock.
- **Queue** (`engine/queue.ts`): pure bounded FIFO, `maxSize = maxQueueSize`.
- **now-playing panel** (`now-playing.ts`): `progressBar()` already renders
  `🔴 LIVE / streaming` when duration is unknown/0 → radio is half-supported
  visually already.
- **Config** (`config/src/index.ts`): `audio.{allowedDomains, maxQueueSize
  (default 50, max 1000), maxTrackDurationSeconds (default 3600, **min 1**),
  requestTimeoutMs, enableStreamingSources, ytdlpPath, ytdlpCookiesFile}`.

### Blockers found for the three goals

1. **Playlists** — `--no-playlist` hardcoded in `COMMON_ARGS`; resolver returns
   one track; no playlist URL detection; no batch enqueue.
2. **Long tracks** — blocked twice: provider rejects `duration >
   maxTrackDurationSeconds` (`ytdlp-provider.ts:67`) AND `armDurationTimer`
   force-skips at that limit (`session.ts:266`). Config `min(1)` forbids a
   "0 = unlimited" sentinel today.
3. **Online radio** — live streams rejected by yt-dlp provider (`is_live`,
   `ytdlp-provider.ts:60`); no station registry; no list/select commands; the
   duration timer would also kill a continuous radio stream.

---

## 3. Agent plan (0–8)

Execution is sequential where there is a hard data dependency; the four analysis
agents (1–4) are **read-only and independent** → run in parallel. Implementation
(6) is done by the orchestrator in the main loop because it needs iterative
Docker validation (compile → test → fix). All paths below are under
`docs/agent-memory/music/` unless noted.

| # | Agent | Input | Output | Validation criterion | Depends on |
|---|---|---|---|---|---|
| 0 | Orchestrator plan | repo inspection | `00-orchestrator-plan.md` (this) | plan exists; every agent has input/output/validation; ordered incrementally | — |
| 1 | Current-system analysis | audio-module source | `01-current-music-system-analysis.md` + `docs/music/{music-system-overview,youtube-playback,commands}.md` | every claim cited to file:line; confirmed-vs-deduced marked; no code changed | 0 |
| 2 | YouTube playlist analysis | 1 + yt-dlp behavior | `02-youtube-playlist-analysis.md` + `docs/music/youtube-playlists.md` | single-video path preserved; large-playlist strategy; partial-error strategy | 0,1 |
| 3 | Long-track analysis | 1 + session/timer code | `03-long-track-playback-analysis.md` + `docs/music/long-track-playback.md` | keeps useful protections; expired-stream strategy; manual-stop strategy | 0,1 |
| 4 | Online-radio analysis | 1 + project conventions | `04-online-radio-analysis.md` + `docs/music/online-radio.md` | not hardcoded in handler; clear list/select method; invalid-stream handling | 0,1 |
| 5 | Implementation plan | 1–4 | `05-implementation-plan.md` + `docs/music/future-music-roadmap.md` | each stage independently validatable with PASS/FAIL; not too big/vague | 1–4 |
| 6 | Implementation | 5 | code changes + `06-implementation-validation.md` + update `docs/music/*` | per-stage checkpoint; build/lint/test run in Docker after each stage; existing commands still present | 5 |
| 7 | Testing & regression | 6 | `07-regression-validation.md` + `docs/music/{testing-music,troubleshooting-music}.md` | real vs recommended tests separated; no false PASS; external limits documented | 6 |
| 8 | Final docs & handoff | 1–7 | `99-final-orchestrator-report.md`; verify all `docs/music/*` exist & coherent | paths/commands real; all features documented | 1–7 |

### Incremental implementation order (Agent 6)

1. **Stage 1 — minimal refactor** (only if analysis proves necessary): extend the
   resolver to optionally return multiple tracks (playlist-capable) without
   changing the single-track contract used by `play`. Keep all existing commands
   and behavior identical.
2. **Stage 2 — YouTube playlists**: detect playlist URLs; flat-extract entries;
   batch-enqueue with a configurable cap; tolerate unavailable items; clear user
   message.
3. **Stage 3 — long tracks**: allow long/multi-hour tracks via a configurable
   limit (`0 = unlimited`); make the duration timer conditional; keep skip/stop
   working; correct cleanup.
4. **Stage 4 — online radio**: configurable station registry (not in the command
   handler); list + select + play + stop; invalid-stream handling; docs for
   adding a station.
5. **Stage 5 — docs + final validation**.

Each stage is its own commit-sized unit with an independent PASS/FAIL gate.

---

## 4. Validation strategy

Real validation IS available this session (dev stack is up). Per stage, inside
the running toolbox container:

```bash
docker compose exec app pnpm vitest run --project unit packages/audio-module   # unit
docker compose exec app pnpm --filter @botplatform/audio-module run typecheck
docker compose exec app pnpm lint
# full regression at the end:
docker compose exec app pnpm test            # unit + integration
docker compose exec app pnpm build
```

**Cannot be validated locally** (must be documented as such per the brief):
real Discord voice playback, actual YouTube extraction / rate-limits / cookies,
and live radio stream reachability — these need a live bot token, a voice
connection, and outbound network to YouTube/radio hosts. Unit tests use injected
fakes (`src/testing/fakes.ts`, `YtDlpRunner` is an interface) so logic is fully
testable without the network.

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Breaking single-video `play` | Keep `resolver.resolve()` single-track contract; add playlist as a separate path; unit test single-video first in every stage. |
| Background doc-pass interferes | Namespaced under `docs/agent-memory/music/`; touch no flat doc-pass files. |
| Huge playlist floods queue / memory | Configurable cap + flat extraction (`--flat-playlist`, no per-item metadata fetch up front); respect `maxQueueSize`. |
| Long track killed by duration timer | `maxTrackDurationSeconds = 0` ⇒ no timer; radio is exempt by source type. |
| Radio = live stream rejected / killed | Radio bypasses the yt-dlp `is_live` reject and the duration timer; treated as a first-class continuous source. |
| New dependency creep | Prefer yt-dlp (already present) + a static/DB station list; document any new dep with rationale. |

---

## Checkpoint — Agent 0 (Orchestrator plan)

Status: PASS

### Modificări făcute
- Inspected the live music system (commands, resolver, providers, runner,
  session, queue, now-playing, config) and Docker runtime.
- Established the namespacing decision (`docs/agent-memory/music/`) to coexist
  with the running doc-pass; restored the doc-pass `00`.
- Wrote this plan with per-agent input/output/validation and the incremental
  implementation order.

### Comenzi rulate
- `docker version` / `docker compose ps` → dev stack (`db` healthy, `app` up).
- File reads only (no code mutation).

### Validat efectiv
- Project identity + current music architecture, cited to file:line.
- The three concrete blockers (`--no-playlist`, double duration limit, live
  reject) confirmed in code.
- Docker validation path is available.

### Nevalidat
- Anything requiring live Discord voice / real YouTube / live radio network.

### Probleme găsite
- A background doc-pass owns `docs/agent-memory/` numbering → handled by
  namespacing.

### Următoarea etapă poate continua?
Da. Analysis agents 1–4 can start immediately (read-only, parallel). Agent 5
synthesizes; Agent 6 implements incrementally with Docker validation.
