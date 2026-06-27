# 09 — Troubleshooting (tech-docs remake)

Agent-memory note for the TROUBLESHOOTING author pass (remake, 2026-06-27).

## What was produced

- **`docs/technical/troubleshooting.md`** — full rewrite (remake). 16 numbered
  Symptom / Cause / Investigation / Solution sections + a "Corrections to the
  legacy docs" note, all commands in fenced blocks, all files by repo-root path.

## Sections (all required topics covered)

| # | Section |
|---|---------|
| 0 | First reflexes (ps/logs/healthz) + the "discord health is always ok" rule |
| 1 | Docker engine not running / build fails (@discordjs/opus compile toolchain) |
| 2 | pnpm install (frozen-lockfile + empty node_modules named volume) |
| 3 | bot/admin stuck on first boot (dev-entry.sh wait loop, .modules.yaml) |
| 4 | Invalid Discord token / won't log in (bot stays HEALTHY by design) |
| 5 | 4014 "Disallowed intents" (flag ON + portal OFF = hard fail) |
| 6 | Missing intents degrade welcome/automod silently (flag OFF, no 4014) |
| 7 | Missing Discord permissions (role hierarchy, owner protection, channel overrides) |
| 8 | DB connection (host `db`, migrations, password-on-first-init, TEST_DATABASE_URL) |
| 9 | Port 3000 in use (admin is the only host-published service) |
| 10 | Container exits on bad env (CONFIG_INVALID names-only; prod `${VAR:?}`; CRLF) + COOKIE_SECURE note |
| 11 | Slash commands not appearing (register-commands CLI; guild vs global; 16 command-owning of 20) |
| 12 | Bot online but not responding (3 exact dispatcher replies; module disabled in DB; three-place wiring; default-enabled-on-failure) |
| 13 | New-module-not-appearing checklist (MODULE_KEYS + main.ts + register-commands + seed.ts) + admin-route gap |
| 14 | e2e failures (admin-healthy dep; Playwright version pin; E2E admin; base URL) |
| 15 | Audio (streaming flag, yt-dlp, ffmpeg/opus, allowlist, SSRF, cookies, MAX_TRACK_DURATION, MAX_PLAYLIST_ITEMS) |
| 16 | How-tos: logs / shell / health / module state |
| — | Corrections to legacy docs (bad token does NOT make bot unhealthy; 11→20 module scope drift) |

## Key code facts verified this pass (file:line)

- Bot `discord` health ALWAYS `status:'ok'`, real state in `detail` —
  `apps/bot/src/main.ts:215-226`. This is the headline legacy correction.
- Gateway intents: base `Guilds, GuildVoiceStates, GuildMessages, GuildModeration`
  (non-privileged, always); `GuildMembers`/`MessageContent` opt-in →
  `packages/discord-adapter/src/adapter.ts:64-84`. Adapter sets state `disabled`
  with detail "DISCORD_TOKEN / DISCORD_CLIENT_ID not configured" at `:55-62`.
- Dispatcher replies are EXACT: "Unknown command." / "This command only works
  inside a server." / "The `<name>` module is currently disabled." —
  `packages/core/src/registry.ts:104-122`.
- Default-enabled-on-failure: `CachedModuleState.isEnabled` returns last value
  (default `true`) on lookup error — `packages/core/src/module-state.ts:29`;
  missing module row counts as enabled — `repositories/modules.ts:44-47`.
- `modules` table columns are `key` + `enabled` (boolean default true) —
  `packages/database/src/schema.ts:66-70`. So `SELECT key, enabled FROM modules`
  is valid.
- `seed.ts` wires all 20 modules; **only `audio-player` + `announcements`** are
  `defaultEnabled:true` (`:29,35`). `ensure()` does NOT rewrite `enabled` on
  conflict — re-seeding never re-enables/re-disables a user choice
  (`repositories/modules.ts:24-31`).
- register-commands CLI exits 1 when `config.discord.enabled` is false; spreads
  the 16 command-owning modules' commands — `apps/bot/src/register-commands.ts:36-42,130-161`.
- `MODULE_KEYS` = exactly 20 keys — `packages/shared/src/types.ts:2-23`.
- Audio: providers built only when streaming enabled (`index.ts:41-50`);
  yt-dlp-unavailable warning at load (`index.ts:103-107`); `SpotifyAudioProvider`
  present (`index.ts:48`).
- Admin routes: 9 real plugins + 1 placeholder-last —
  `apps/admin/src/routes/index.ts:18-29`. 11 modules have no dedicated route.
- dev-entry.sh waits for `/workspace/node_modules/.modules.yaml` in a 5s loop —
  `scripts/dev-entry.sh:16-22`.

## Notable nuances captured (not in older drafts)

- "Second enable flag" gotcha: `levels` needs `level_settings.enabled=true`
  (default false) via `/levelconfig enabled:true` on top of the module enable.
- `MAX_PLAYLIST_ITEMS` is in `.env.example`/Zod but NOT wired into either compose
  file → always 100 in Docker unless added manually.
- Flag parsing: `DISCORD_ENABLE_*` true only when value === "true";
  `AUDIO_ENABLE_STREAMING_SOURCES` is inverted (true unless === "false").
- §5 vs §6 distinction made explicit: requested-but-not-portal-enabled = hard
  4014; flag-OFF = silent degrade.

## Checkpoint

Status: PASS

### Validat
- Existing `docs/technical/runtime-and-docker.md`, `environment.md`,
  `commands-and-events.md`, and legacy `docs/TROUBLESHOOTING.md` read; not blindly
  copied — every load-bearing claim re-verified against source.
- All code claims above verified by reading the cited files this pass.
- `docs/technical/troubleshooting.md` rewritten at the exact required path.
- `docs/agent-memory/tech-docs/09-troubleshooting.md` written (this file) under
  the namespaced subfolder (not a flat root `0X-*.md`).
- Required topic list from the brief fully covered, incl. the new-module checklist
  and the legacy-corrections note.

### Nevalidat
- No commands were executed this pass (the orchestrator's 2026-06-27 execution
  validation is cited as-is). Did not run `docker compose`, psql, or the bot in
  this pass — pure doc authoring against verified source.
- `docs/DISCORD_SETUP.md` permissions integer `3147776` carried as
  documented-elsewhere-unverified (the repo computes no permissions integer).
- Spotify single-track-only behaviour carried as documented-elsewhere-unverified
  (only `SpotifyAudioProvider` presence confirmed).

### Probleme
- None blocking. The doc relies on line numbers in source that may shift as the
  uncommitted working tree evolves; all are anchored to stable functions, so
  drift would be cosmetic.

### Următorul agent poate continua?
- Yes. If a clean-room `docker build --no-cache --target bot` is run, fold the
  result into §1 and the prod-manifest gap flagged in `runtime-and-docker.md`
  §9.1. If new modules land, extend the §13 checklist counts (currently 20
  modules / 16 command-owning / 9 real admin routes).
