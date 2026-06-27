# Agent 7 — Testing & Regression

> Confirms the music extension did not break existing behavior. Everything below
> ran inside the live dev container. Real vs. recommended/unrunnable tests are
> separated per the brief.

## Commands actually run (real results)

| Command (`docker compose exec -T app …`) | Result |
|---|---|
| `pnpm typecheck` (all 23 projects, incl. apps/bot + apps/admin) | **PASS** — clean |
| `pnpm lint` (eslint .) | **PASS** — clean |
| `pnpm test:unit` | **PASS** — 389 tests, 38 files |
| `pnpm test:integration` | **PASS** — 37 tests, 7 files (test DB migrated + provisioned) |
| `pnpm build` (tsup bundle) | **PASS** — apps/bot + apps/admin built; bot inlines the audio module incl. radio/playlist/long-track code |
| smoke (`tsx` constructing `createAudioModule`) | **PASS** — 12 commands (incl. `playlist`, `radio`), radio 4 subcommands, 1 component handler, 8 stations, URL classification correct |

Audio-module unit detail: **120 tests / 10 files** — `commands` (28), `session`
(20), `ytdlp-provider` (19), `radio/commands` (12), `now-playing` (10),
`resolver` (10), `radio/registry` (9), `youtube-url` (5), `spotify-provider`
(4), `queue` (3).

## Scenario coverage (brief's checklist)

| Scenario | Status | How |
|---|---|---|
| Play YouTube single video | ✅ automated | `/play` tests unchanged + green |
| Play YouTube playlist | ✅ automated (logic) | `resolvePlaylist` + `/play` auto-expand + `/playlist` tests |
| Playlist with invalid item | ✅ automated | provider skips `[Private/Deleted]` + `availability!=public/unlisted`; counted in `skipped` |
| Very large playlist | ✅ automated (cap) | capped at `MAX_PLAYLIST_ITEMS`; `enqueueMany` respects `maxQueueSize`; over-cap reported |
| Play long track | ✅ automated (logic) | `0=unlimited` accepts over-limit; watchdog not armed |
| Skip long track | ✅ automated | existing skip tests + watchdog-clear |
| Stop long track | ✅ automated | existing stop tests |
| List radios | ✅ automated | `/radio list` embed + select menu |
| Play radio | ✅ automated (logic) | `/radio play` + select handler set a live nowPlaying |
| Stop radio | ✅ automated | `/radio stop` |
| Radio unavailable / offline | ⚠️ partial | error path exists (`UserFacingError`/friendly reply), not exercised live |
| User not in voice channel | ✅ automated | `/play`, `/radio play` guidance tests |
| Queue + radio interaction | ✅ automated (logic) | radio `stop()`s then plays (takes over) — covered by `/radio stop` test |

## NOT validated (external dependencies — documented, not marked PASS)

These need a live Discord bot token, a real voice connection, and outbound
network to YouTube / SomaFM, none of which exist in this environment:

- Real Discord slash-command registration & invocation in a guild.
- Actual yt-dlp extraction of a real video/playlist (and the exact
  `--flat-playlist` JSON field names against the pinned 2026.06.09 build).
- A genuinely multi-hour stream surviving for hours over a real connection
  (the `--retries` flags are configured but unexercised end-to-end).
- Real radio stream reachability / a truly offline station.
- Discord-side select-menu round-trip in a live client.
- E2E (Playwright) for music — the e2e suite targets the admin panel, not voice;
  not run this pass (unrelated to these changes; admin integration tests cover
  the admin surface and passed).

## Regression conclusion

No regressions. Every previously-green gate (typecheck, lint, 389 unit, 37
integration, build) is still green WITH the new code, and the bot's
internal-API integration test (which constructs every module, including audio,
under the new config) passes. New behavior is covered by 47 new/updated unit
tests. The single-video play path is provably unchanged (separate code path;
its tests untouched and green).

## Checkpoint — Agent 7 (Regression)

Status: PASS (local), with external Discord/YouTube/radio paths explicitly
documented as not-locally-validated.

### Validat efectiv
- typecheck (all), lint, 389 unit, 37 integration, prod build, module smoke.

### Nevalidat
- Live Discord voice, real yt-dlp network extraction, multi-hour endurance, live
  radio reachability, Discord select-menu round-trip (all require external deps).

### Probleme găsite
- None. Two design limitations documented: dormant per-guild duration column;
  select-menu play requires an existing connection.

### Următoarea etapă poate continua?
Da. Proceed to documentation finalization (Agent 8) + final report.
