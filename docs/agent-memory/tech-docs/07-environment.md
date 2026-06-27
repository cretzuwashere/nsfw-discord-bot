# 07 — Environment & Configuration (tech-docs)

Agent-memory note for the environment documentation pass. Output written to
`docs/technical/environment.md`. All claims below were verified against code on
2026-06-27.

## What was done

- Read `.env.example` in full (83 lines).
- Read `packages/config/src/index.ts` (the Zod schema + `loadConfig` + `testEnv`).
- Grepped every `process.env` reference repo-wide and read each consumer.
- Read both compose files (`docker-compose.yml`, `docker-compose.prod.yml`),
  the `Dockerfile` (yt-dlp pin, `MIGRATIONS_DIR`, `UPLOADS_DIR`, `NODE_ENV`),
  `packages/discord-adapter/src/adapter.ts` (gateway intents), and
  `apps/admin/src/server.ts` (`config.version` consumers).
- Verified the privileged-intent ↔ env-flag mapping and the 4014 failure mode.

## Key verified facts

- **Base gateway intents** (always on, none privileged):
  `Guilds`, `GuildVoiceStates`, `GuildMessages`, `GuildModeration`
  (`adapter.ts:73-78`). `GuildVoiceStates` is NOT privileged.
- Privileged intents are opt-in: `DISCORD_ENABLE_GUILD_MEMBERS` → `GuildMembers`
  (`adapter.ts:79`), `DISCORD_ENABLE_MESSAGE_CONTENT` → `MessageContent`
  (`adapter.ts:82`). Flag true without portal toggle ⇒ gateway close code 4014.
- `MAX_TRACK_DURATION_SECONDS=0` means **unlimited** (Zod `min(0)`).
- `AUDIO_ENABLE_STREAMING_SOURCES` parses **inverted** (`!== 'false'`).
- `config.discord.enabled` true only when token AND clientId are both non-empty
  (`index.ts:148`).

## Discrepancies flagged (verified)

- **Consumed in code, missing from `.env.example`:** `UPLOADS_DIR`,
  `TEST_DATABASE_URL`, `MIGRATIONS_DIR`, `BUILD_VERSION`.
- **`BUILD_VERSION`** is set NOWHERE (not `.env.example`, not compose, not the
  Dockerfile) → always defaults to `0.1.0`; still consumed by admin dashboard
  (`server.ts:252,460`) and an e2e assertion.
- **`MAX_PLAYLIST_ITEMS`** IS in `.env.example` + Zod schema but is NOT in either
  compose env block → in Docker it always uses the Zod default `100`.
- `POSTGRES_USER/PASSWORD/DB` are consumed only by the `db` container (not by
  Node / not in the Zod schema).
- `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `TEST_DATABASE_URL` are read directly
  (not in the Zod schema).

## Secrets list

`DISCORD_TOKEN`, `SESSION_SECRET` (≥32), `INTERNAL_API_TOKEN` (≥8),
`POSTGRES_PASSWORD` / DB-URL password, `ADMIN_PASSWORD`, `E2E_ADMIN_PASSWORD`,
the `YTDLP_COOKIES_FILE` contents. Real `.env` was NEVER read; only `.env.example`
and placeholders used in the doc.

## Checkpoint

Status: PASS

### Validat
- Full Zod env schema with all defaults, types, and bounds
  (`packages/config/src/index.ts`).
- Every `process.env` consumer (grepped + read individually).
- Privileged-intent ↔ flag mapping and base intents (`adapter.ts`).
- Both compose files + Dockerfile env behaviour.
- `BUILD_VERSION` and `MAX_PLAYLIST_ITEMS` discrepancies confirmed by absence in
  compose/Dockerfile.
- Invite-URL / permissions integer `3147776` (cross-checked
  `docs/DISCORD_SETUP.md`).

### Nevalidat
- The real runtime value of any secret (the real `.env` was deliberately not
  read).
- Whether the audio-minimum permission integer `3147776` is recomputed in code —
  it is documented in `docs/DISCORD_SETUP.md` only (marked
  documented-elsewhere); no code constructs the invite URL.

### Probleme
- `BUILD_VERSION` is dead config in practice (always `0.1.0`); flagged as a real
  gap, not fixed (docs-only task).
- `MAX_PLAYLIST_ITEMS` not propagated through compose; flagged, not fixed.
- `.env.example` is missing 4 consumed vars; flagged, not fixed (no instruction
  to edit `.env.example`).

### Următorul agent poate continua?
Yes. If desired, a follow-up could: (a) add `UPLOADS_DIR`, `TEST_DATABASE_URL`,
`MIGRATIONS_DIR`, `BUILD_VERSION`, `MAX_PLAYLIST_ITEMS` to the compose env blocks
and/or `.env.example` to remove the discrepancies; (b) wire `BUILD_VERSION` into
the build (Dockerfile `ARG`/`ENV`) so the admin dashboard shows a real version.
Both are out of scope for this docs pass.
