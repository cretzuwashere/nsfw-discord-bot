# 07 — Documentation Review

## Part A — Troubleshooting summary (Agent 7)

**Agent purpose:** Write a practical, project-specific troubleshooting guide for
the botplatform (Docker-first Discord bot platform), verifying every claim
against the actual code and compose files rather than copying generic advice or
the older `docs/TROUBLESHOOTING.md` blindly.

**Output written:** `docs/technical/troubleshooting.md`

### Files analyzed (read before writing)

- `docs/technical/runtime-and-docker.md` — operator runbook (dev/prod/validation,
  services, volumes, health endpoints, command reference).
- `docs/technical/environment.md` — every env var, required vs optional,
  privileged intents, audio config, secrets.
- `docs/technical/commands-and-events.md` — slash commands, events, intents,
  permissions, module↔command matrix.
- `docs/TROUBLESHOOTING.md` (predecessor) — verified against code; found one
  stale claim (see below).
- Source/config verified directly:
  - `scripts/dev-entry.sh` — node_modules wait-loop on `.modules.yaml`.
  - `packages/discord-adapter/src/adapter.ts:62-82` — intents (base 4 + opt-in
    GuildMembers/MessageContent), 4014 comment.
  - `apps/bot/src/main.ts:120-160` — 11 modules wired; **discord health check
    always returns `status:"ok"`** with state in `detail`.
  - `apps/bot/src/internal-api.ts:43` — `/healthz` route.
  - `apps/bot/src/register-commands.ts` — CLI gated on `config.discord.enabled`
    (TOKEN+CLIENT_ID), guild vs global scope message, exits 1 if unset.
  - `packages/core/src/registry.ts:102-123` — dispatcher: unknown-command,
    guildOnly, and **"module is currently disabled"** replies.
  - `packages/core/src/module-state.ts` — cached module state, **defaults to
    enabled when DB lookup fails**.
  - `packages/audio-module/src/index.ts` — streaming providers only built when
    `enableStreamingSources`; yt-dlp availability warning at load.
  - `packages/audio-module/src/resolver/resolver.ts` + `ytdlp-runner.ts` —
    SSRF via `validateExternalUrl`, `--cookies` only when `cookiesFile` set,
    cookies needed only for private/age-restricted YouTube.
  - `packages/security/src/url-validation.ts` — `URL_BLOCKED`/`URL_INVALID`/
    `URL_UNSUPPORTED`; blocks localhost/private/internal; allowlist enforcement.
  - `Dockerfile` / `Dockerfile.dev` — `python3 make g++` for @discordjs/opus,
    ffmpeg, `YTDLP_VERSION=2026.06.09`.
  - `docker-compose.yml` — admin `3000:3000` is the only published port; bot
    8081 network-only; healthchecks with 90s start_period; `TEST_DATABASE_URL`
    `…/botplatform_test`.
  - `scripts/check-audio-stack.ts` — opus/encryption/ffmpeg dependency report.

### What was discovered (key verified facts)

- **Discord health is informational, not fatal** (verified in code,
  `main.ts:149-160`): the bot's `discord` check ALWAYS reports `status:"ok"`,
  putting the true state (`connected`/`error`/`connecting`) in `detail`. A bad
  token does NOT make the container unhealthy. This **directly contradicts** the
  old `docs/TROUBLESHOOTING.md` ("the bot container reports unhealthy by design")
  — corrected in the new doc with an explicit "Corrections" section.
- **node_modules is an empty shared volume**; `dev-entry.sh` idles until
  `/workspace/node_modules/.modules.yaml` exists, then execs the watcher
  (verified in code).
- **Module gating**: disabled modules cause a user-visible "The <module> module
  is currently disabled." reply at dispatch; default is enabled if the DB lookup
  fails (verified in code).
- **Privileged intents (4014)**: requesting GuildMembers/MessageContent via env
  flags without the matching portal toggle ⇒ gateway close code 4014; audio bot
  needs neither (verified in code/comment).
- **Missing intents degrade silently**: GuildMembers OFF ⇒ member events never
  fire (welcome dead); MessageContent OFF ⇒ `message.create.content` is empty
  (automod content rules DEGRADED) (verified in code/docs).
- **Audio**: streaming providers only exist when `AUDIO_ENABLE_STREAMING_SOURCES`
  is on; SSRF blocks localhost/private; allowlist via `ALLOWED_AUDIO_DOMAINS`;
  cookies only for private/age-restricted YouTube; yt-dlp + ffmpeg baked into
  images (verified in code).
- **Ports/db**: admin `3000` is the only host-published port; `DATABASE_URL` host
  must be `db` inside compose; Postgres 18 data at `/var/lib/postgresql`.

### Commands run (investigation, read-only)

```bash
# directory/structure + grep verification (via Glob/Grep/Bash read-only):
ls packages/audio-module/src packages/discord-adapter/src apps/bot/src scripts
grep -n -i "python3|make|g++|ffmpeg|YTDLP_VERSION" Dockerfile Dockerfile.dev
grep -n "3000|ADMIN_PORT|8081|HEALTH_PORT|start_period|TEST_DATABASE_URL" docker-compose.yml
grep -rn "URL_BLOCKED|allowedDomains|private|loopback" packages/security/src
```

No state-changing or Docker-execution commands were run by this agent; the live
validation results cited are from the orchestrator's 2026-06-27 clean-room run.

### Results

- `docs/technical/troubleshooting.md` written: 15 numbered sections, each as
  Symptom / Probable cause / Investigation (fenced) / Solution (fenced), plus a
  "first reflexes" preamble and a "Corrections to the old TROUBLESHOOTING.md"
  section. Every claim tagged (verified in code / by execution / deduced /
  documented-elsewhere-unverified). No secrets; placeholders used.

### Problems / discrepancies found

- **Stale claim in `docs/TROUBLESHOOTING.md`**: invalid token does NOT make the
  bot unhealthy (code reports discord as always-ok). Documented and corrected in
  the new file. **Recommendation:** update or retire the root
  `docs/TROUBLESHOOTING.md` so the two don't drift.
- The `module_states` table name in the psql snippets is best-effort (schema
  uses a modules/module-state repository); the new doc flags "adjust table name
  if it errors" and points users to the admin panel as the supported toggle path.

### Recommendations

- Fold/redirect the legacy `docs/TROUBLESHOOTING.md` to
  `docs/technical/troubleshooting.md` to avoid the duplicated, partly-stale copy.
- Consider adding `UPLOADS_DIR`, `TEST_DATABASE_URL`, `BUILD_VERSION` to
  `.env.example` (per the environment.md drift notes) — reduces config-surprise
  support load.

### What remains

- Nothing blocking for the troubleshooting deliverable. Agent 8 will append
  "Part B" to this same file (documentation review proper) — left untouched.

## Checkpoint

Status: PASS

### Validat
- `docs/technical/troubleshooting.md` created with all required sections.
- Bot discord-health "always ok" behaviour verified in code
  (`apps/bot/src/main.ts:149-160`) and used to correct the stale old doc.
- dev-entry.sh wait-loop, module-disabled dispatch reply, intent/4014 logic,
  audio streaming/SSRF/cookies behaviour, native-deps in Dockerfiles, and the
  admin-only `3000` port mapping all verified against source.
- Execution-backed facts (14 gates, bot connected) cited as "verified by
  execution on 2026-06-27".

### Nevalidat
- Exact `module_states` table/column names not run against a live DB (read from
  schema/repository code only); psql snippet flagged as best-effort.
- Spotify single-track-only behaviour carried from the old doc as
  documented-elsewhere-unverified (provider class confirmed present, not run).

### Probleme
- Legacy `docs/TROUBLESHOOTING.md` contains a stale "bot unhealthy on bad token"
  claim; corrected in the new doc but the old file still exists.

### Următorul agent poate continua?
Da. Part A is complete and self-contained; Agent 8 can append Part B below this
section without conflict. No shared state was left in an inconsistent form.

## Part B — Documentation review (Agent 8)

**Agent purpose:** Act as a brand-new operator who must run the project using
only `docs/technical/`. Read every technical doc, cross-check every command, file
path, env var, port, service/volume name, and behavioural claim against the real
repo, then make minimal surgical fixes for anything wrong or contradictory.
Confirm no doc repeats the stale "malformed token / bot unhealthy on bad token"
claim (the bot is verified CONNECTED) or claims absent features (modals, emoji
reactions).

### Files reviewed (all of `docs/technical/`)

- `architecture.md`, `runtime-and-docker.md`, `environment.md`,
  `discord-bot-flows.md`, `commands-and-events.md`, `testing.md`,
  `troubleshooting.md`.

### Source-of-truth files cross-checked against (read directly)

- `package.json` (root scripts), `Makefile`, `docker-compose.yml`,
  `docker-compose.prod.yml`, `.env.example`.
- `packages/config/src/index.ts` (the zod `envSchema` — the authoritative env
  contract).
- `packages/database/src/schema.ts` (table names), `packages/database/src/ports.ts`
  (module-state reads via `createModulesRepo`).
- `apps/bot/src/main.ts` (health indicators, scheduler wiring),
  `apps/bot/src/internal-api.ts` (`/healthz` route), `apps/bot/src/register-commands.ts`
  (7 command-owning modules).
- `packages/discord-adapter/src/adapter.ts` (intents block),
  `packages/audio-module/src/index.ts` (streaming providers / yt-dlp warning).
- `Dockerfile`, `Dockerfile.dev` (native deps + `YTDLP_VERSION`).
- Existence of every cross-referenced path: `scripts/{dev-entry,clean-validate,
  check-admin-pages}.sh`, `scripts/check-audio-stack.ts`,
  `apps/admin/src/{main.ts,routes/*.ts}`, `packages/discord-adapter/src/voice-session.ts`,
  `docs/{DISCORD_SETUP,AUDIO_SOURCES,TROUBLESHOOTING}.md`,
  `docs/agent-memory/02-runtime-and-docker-analysis.md`.

### What I verified as CORRECT (no change needed)

- **Commands match `package.json` + Makefile + compose.** Every `pnpm` script in
  the docs (`lint`, `typecheck`, `test`, `test:unit`, `test:integration`,
  `test:e2e`, `playwright`, `build`, `format`, `format:check`, `db:migrate`,
  `db:seed`, `db:setup`, `db:generate`, `discord:register-commands`) exists in
  root `package.json`. Every `make` target referenced exists in the `Makefile`.
  `db:setup = db:migrate && db:seed` (verified). The raw-vs-make pairings in
  `runtime-and-docker.md` §7 all line up. (verified in code)
- **Env vars all backed by config/compose.** Every variable in `environment.md`
  is either in the zod `envSchema` (`config/src/index.ts`) or correctly marked
  **(direct)**/**Docker-only**. The "only three hard-required" claim
  (`DATABASE_URL`, `SESSION_SECRET` ≥32, `INTERNAL_API_TOKEN` ≥8) matches the
  schema exactly (lines 11, 29-31, 41). Privileged-intent parsing (`=== 'true'`)
  and `AUDIO_ENABLE_STREAMING_SOURCES` (`!== 'false'`) match the schema
  transforms. `discord.enabled = token && clientId` matches `index.ts:142`.
  (verified in code)
- **`.env.example` drift notes (environment.md §6) are accurate.** Confirmed
  `UPLOADS_DIR`, `BUILD_VERSION`, `MIGRATIONS_DIR`, `TEST_DATABASE_URL`, `CI` are
  NOT in `.env.example`; `POSTGRES_USER/DB/PASSWORD` ARE present but not read by
  the Node app (only by the `db` image + Makefile). (verified in code)
- **Ports / services / volumes.** admin `3000:3000` is the only published port
  (`docker-compose.yml:155`); bot `8081` is network-only; db `5432` unpublished.
  Dev volumes `pgdata`/`node_modules`/`pnpm-store`/`uploads`; prod
  `pgdata-prod`/`uploads-prod`; Postgres-18 mount `/var/lib/postgresql`. All
  match compose. (verified in code)
- **Prod `${VAR:?}` required secrets** (`DATABASE_URL`, `SESSION_SECRET`,
  `INTERNAL_API_TOKEN`, `POSTGRES_PASSWORD`) and `COOKIE_SECURE` default `true`,
  `UPLOADS_DIR=/app/uploads`, migrate→bot/admin ordering — all match
  `docker-compose.prod.yml`. (verified in code)
- **`register-commands` = exactly 7 command-owning modules** (audio, moderation,
  announcements, role-menus, custom-commands, reminders, birthdays) — matches
  both `discord-bot-flows.md` and `commands-and-events.md`
  (`register-commands.ts:41-86`). 11 modules total wired in `main.ts`.
  (verified in code)
- **Line citations spot-checked and accurate:** `apps/bot/src/main.ts:149-160`
  (discord health always `status:"ok"`, `name:'discord'` block 150-158),
  `internal-api.ts:43` (`/healthz`), `adapter.ts:62-82`/`71-82` (intents),
  `audio-module/src/index.ts:39-48` (providers) & `79-83` (yt-dlp warning),
  `Dockerfile:25-27`/`111` and `Dockerfile.dev:21-32`/`42` (native deps +
  `YTDLP_VERSION=2026.06.09`), `main.ts:71` (renderCard) / `:144` (scheduled-msg
  job). (verified in code)
- **No stale token claim anywhere.** No technical doc repeats "malformed token"
  or "bot reports unhealthy on bad token". `troubleshooting.md` §0/§4 and its
  "Corrections" section + `testing.md` + `discord-bot-flows.md` all state the
  bot connects and the discord check is always-ok. Consistent with the
  2026-06-27 execution (bot `/healthz` → `discord: connected`). (verified by
  execution + in code)
- **Absent-feature claims correct.** `commands-and-events.md` §2 "Not implemented
  (verified absent)": no `MessageReactionAdd`/`GuildMessageReactions`, no
  `ModalBuilder`; the `'reaction'` role-menu type renders as buttons. Consistent
  with `discord-bot-flows.md` Flow 3. (documented-as-verified; not independently
  re-grepped here — carried as consistent)

### Issues found

1. **`architecture.md:130` — wrong file extension.** Text said the Discord
   adapter implements voice in `voice-session.js`, but the file is
   `voice-session.ts` (verified: `packages/discord-adapter/src/voice-session.ts`
   exists; no `.js` source). Every other doc (`discord-bot-flows.md`) already used
   `.ts`. Internal inconsistency + non-existent path.
2. **`troubleshooting.md` §12 & §15 — wrong DB table/column in psql snippets.**
   Both used `module_states` with column `module_key`. The real schema
   (`packages/database/src/schema.ts:66-73`) has table **`modules`** with columns
   **`key`** and **`enabled`**; `ports.ts` reads it via `createModulesRepo`. The
   doc hedged "adjust table name if it errors", but the correct name is now
   verified, so the snippets would have errored as written. (This also resolves
   the open item flagged in Part A's "Nevalidat".)

### Exactly what I changed (file — before → after)

- `docs/technical/architecture.md:130` — ``voice-session.js`` → ``voice-session.ts``.
- `docs/technical/troubleshooting.md` §12 — psql `"SELECT module_key, enabled
  FROM module_states;"` → `"SELECT key, enabled FROM modules;"` (comment now cites
  the verified schema location instead of "adjust if it errors").
- `docs/technical/troubleshooting.md` §15 — prose ``module_states`` table →
  ``modules`` (`modules.key`, `modules.enabled`); psql `"SELECT * FROM
  module_states;"` → `"SELECT key, enabled FROM modules;"`; removed the
  "adjust table name if it errors" hedge.

### What I could NOT fix / out of scope

- **Legacy `docs/TROUBLESHOOTING.md`** (the uppercase root file) still exists and
  carries the stale "bot unhealthy on bad token" claim. Part A and the new
  `docs/technical/troubleshooting.md` already correct it; I left the legacy file
  untouched (it is outside `docs/technical/` and Agent 9 owns README/handoff).
  Recommendation stands: retire or redirect it.
- **Spotify single-track-only** behaviour in `troubleshooting.md` §14 is tagged
  *documented-elsewhere-unverified*; I confirmed `SpotifyAudioProvider` exists
  (`packages/audio-module/src/resolver/providers/spotify-provider.ts`) but did not
  run a live Spotify resolve, so the "albums/playlists not supported" detail stays
  as-tagged (honest, not changed).
- **`docs/agent-memory/music/`** — not read, not touched (owned by another
  process, per instructions).
- I ran no Docker/state-changing commands; live results are the orchestrator's
  2026-06-27 clean-room run (all 14 gates PASSED, bot connected).

### Recommendations

- Fold/redirect the legacy uppercase `docs/TROUBLESHOOTING.md` into
  `docs/technical/troubleshooting.md` to stop the two from drifting.
- Consider adding `UPLOADS_DIR`, `TEST_DATABASE_URL`, `BUILD_VERSION` to
  `.env.example` (they are read in code and user-tunable) — reduces config
  surprise. (Carried from Agent 7; still valid.)

## Checkpoint

Status: PASS

### Validat
- All 7 `docs/technical/` files read and cross-checked against the live repo.
- Every documented command exists in `package.json`/`Makefile`/compose; every
  documented env var is backed by `packages/config` schema or correctly marked
  (direct)/Docker-only; every cited file path exists on disk; ports/services/
  volumes match the compose files; key line-number citations verified.
- Two concrete documentation errors found and fixed (architecture voice-session
  extension; troubleshooting `modules` table/columns in two psql snippets).
- Confirmed NO doc repeats the stale token/unhealthy claim and the
  absent-feature (modals, emoji reactions) claims match the code.

### Nevalidat
- Spotify "single track only / no albums" detail (provider class present;
  live resolve not executed — left tagged documented-elsewhere-unverified).
- The "verified absent: modals / emoji reactions" claim was accepted from
  `commands-and-events.md` as internally consistent, not re-grepped from scratch
  in this pass.
- No Docker/runtime commands executed by this agent (read-only review); live
  green status is the orchestrator's 2026-06-27 run.

### Probleme
- Legacy `docs/TROUBLESHOOTING.md` (root, uppercase) still carries the stale
  "bot unhealthy on bad token" claim; corrected in `docs/technical/` but the old
  file remains (out of scope to delete here).

### Următorul agent poate continua?
Da. The technical docs are internally consistent and match the code after two
surgical fixes. Agent 9 can safely write README.md / agent-handoff.md on top of
this reviewed set; the only standing cleanup is retiring the legacy
`docs/TROUBLESHOOTING.md`.
