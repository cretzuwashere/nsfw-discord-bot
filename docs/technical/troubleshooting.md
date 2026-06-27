# Troubleshooting — botplatform (project-specific)

> Practical, project-specific troubleshooting for the Docker-first botplatform.
> The Windows host needs **only Docker** — there is **no** Node, pnpm, ffmpeg,
> psql, or Playwright on the host. Every `pnpm` command runs **inside** the
> long-lived `app` toolbox container (`docker compose exec app pnpm …`). Repo
> root: `C:/Projects/Mods/Fable - Mod`; run all commands there.
>
> **Evidence legend used throughout:**
> - **(verified in code)** — read directly from the source/compose file cited on
>   2026-06-27.
> - **(verified by execution on 2026-06-27)** — confirmed by the orchestrator's
>   run against the warm dev stack (all gates green; bot connected to Discord;
>   admin reachable; e2e 24 passed / 1 skipped). Counts are point-in-time.
> - **(deduced)** — reasoned from verified facts; not separately executed.
> - **(documented-elsewhere-unverified)** — carried from another doc, not
>   re-confirmed against source here.
>
> **Cross-references:** `docs/technical/runtime-and-docker.md` (operator
> runbook), `docs/technical/environment.md` (every env var + validation rules),
> `docs/technical/commands-and-events.md` (the 20 modules, commands, the 5 events,
> intents, permissions). The legacy `docs/TROUBLESHOOTING.md` now **redirects
> here** and keeps only a few Windows/WSL2 host notes, so the two cannot drift —
> see "Corrections to the legacy docs" at the end.
>
> **Scope check (verified on disk 2026-06-27):** 20 modules
> (`packages/shared/src/types.ts` `MODULE_KEYS`), all wired in
> `apps/bot/src/main.ts`; 16 own slash commands, 4 are command-less (welcome,
> dynamic-cards, scheduled-messages, automod); 10 Drizzle migrations
> (`0000_romantic_moonstone` .. `0009_legal_cammi`); 5 platform events.

---

## 0. First reflexes (run these first, always)

```bash
docker compose ps                       # which service is unhealthy / stuck?
docker compose logs --tail=200 bot      # bot worker logs
docker compose logs --tail=200 admin    # admin panel logs
docker compose logs --tail=200 db       # postgres logs
docker compose exec app pnpm --version  # is the toolbox container alive at all?
```

Health endpoints:

```bash
# admin (host-published on 3000)
curl http://localhost:3000/healthz
# → {"status":"ok","checks":{"database":{"status":"ok"}}}

# bot (port 8081 is Docker-network-only — run from inside the app container)
docker compose exec app curl -fsS http://bot:8081/healthz
# → {"status":"ok","checks":{"discord":{"status":"ok","detail":"connected"},"database":{"status":"ok"}}}
```

> **Internalise this (verified in code — `apps/bot/src/main.ts:215-226`):** the
> bot's **`discord` health check ALWAYS returns `status:"ok"`**, carrying the
> real connection state in `detail` (`"connected"`, `"error"`, `"connecting"`,
> `"disabled"`, or `"DISCORD_TOKEN / DISCORD_CLIENT_ID not configured"`). A bad
> or expired token therefore does **NOT** make the bot container unhealthy — this
> is deliberate, so a Discord problem cannot trigger a restart loop while the
> internal API, scheduler and DB keep working. To see the true Discord state read
> `checks.discord.detail` from `/healthz`, the admin dashboard, or the logs —
> **not** `docker compose ps`. (verified by execution on 2026-06-27: detail was
> `"connected"`.)

---

## 1. Docker engine not running / Docker build fails

**Symptom**
- `docker …` errors with `Cannot connect to the Docker daemon` (Linux) or
  `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file
  specified.` (Docker Desktop on Windows).
- A first/cold build sits for minutes on the `@discordjs/opus` step, or fails
  with `gyp ERR!` / `make: not found` / `python3: not found`.

**Cause**
- Docker Desktop / Docker Engine is not started.
- Cold builds are genuinely slow: `@discordjs/opus` **compiles from source on
  glibc**, which needs `python3`, `make`, and `g++`. These ARE installed in both
  images (verified in code — `Dockerfile` `builder` stage installs
  `python3 make g++`; `Dockerfile.dev` is the fat Playwright base). A compile
  failure usually means you edited those lines out or are building a hand-rolled
  image. (verified by execution on 2026-06-27: prod images built ~60s warm.)

**Investigation**

```bash
docker version                       # daemon reachable? prints Client + Server
docker compose config                # compose file parses / interpolates cleanly
docker compose build --progress=plain app   # full build log, no truncation
```

**Solution**

```bash
# Windows: start Docker Desktop, wait for the whale icon to go steady, then:
docker version
docker compose build app             # cache-hit is fast; cold is slow but expected
docker compose build --no-cache app  # force a clean rebuild if a layer is corrupt
```

If the compile step fails, confirm the toolchain is present (baked in):

```bash
docker compose exec app sh -c 'python3 --version && make --version && g++ --version'
```

---

## 2. `pnpm install` fails (frozen-lockfile / empty node_modules volume)

**Symptom**
- `pnpm install --frozen-lockfile` aborts with `ERR_PNPM_OUTDATED_LOCKFILE` /
  "frozen-lockfile … but the lockfile is not up to date".
- `bot`/`admin` never start; `tsx: not found` or "Cannot find module" in logs.

**Cause**
- `node_modules` is a **shared named Docker volume that starts EMPTY on first
  boot** (verified in code — `docker-compose.yml` mounts the `node_modules`
  volume on all dev services; `scripts/dev-entry.sh` comment). Nothing works
  until you run `pnpm install` once into that volume. Installs are **manual on
  purpose** so the four dev services never race each other on the shared volume.
- `--frozen-lockfile` mismatch means `package.json` changed without regenerating
  `pnpm-lock.yaml`. CI uses `--frozen-lockfile`, so the lockfile must be in sync.
  (verified by execution on 2026-06-27: lockfile up to date; 31 workspace
  projects; ~9s.)

**Investigation**

```bash
# Is the volume populated? (.modules.yaml = a COMPLETED install)
docker compose exec app sh -c 'ls -la /workspace/node_modules/.modules.yaml'
docker compose exec app pnpm install --frozen-lockfile   # reproduce CI exactly
```

**Solution**

```bash
# Normal first-run install (writes into the shared volume):
docker compose exec app pnpm install

# Lockfile genuinely out of date (you changed deps) — regenerate, then commit:
docker compose exec app pnpm install --no-frozen-lockfile

# Corrupt/partial volume — wipe just that volume and reinstall:
docker compose down
docker volume rm botplatform_node_modules    # name = <compose-project>_node_modules
docker compose up -d db app
docker compose exec app pnpm install
```

> After any dependency add/remove you MUST re-run
> `docker compose exec app pnpm install`; the watchers never install for you.

---

## 3. `bot`/`admin` container "stuck" / idle on first boot (dev-entry.sh wait)

**Symptom**
- `docker compose ps` shows `bot`/`admin` up but `health: starting`, and their
  logs repeat:
  `[dev-entry] waiting for dependencies — run: docker compose exec app pnpm install`.

**Cause**
- `scripts/dev-entry.sh` (the dev entrypoint for both services) intentionally
  **idles in a 5s wait-loop until `/workspace/node_modules/.modules.yaml`
  appears**, then `exec pnpm --filter @botplatform/<bot|admin> dev` (the tsx
  watcher) (verified in code — `scripts/dev-entry.sh:16-22`). That marker file is
  written only by a *completed* `pnpm install`. The healthcheck has a 90s
  `start_period` to allow for this (verified in code — `docker-compose.yml`).
  Net effect: `docker compose up -d` always succeeds immediately; services wait
  for deps instead of crash-looping.

**Investigation**

```bash
docker compose logs --tail=20 bot
docker compose exec app sh -c 'ls -la /workspace/node_modules/.modules.yaml'
```

**Solution**

```bash
docker compose exec app pnpm install
# bot/admin detect .modules.yaml within ~5s and start on their own.
docker compose ps          # admin should progress to healthy
```

> If it still says "waiting" after install completes, the install failed mid-way
> (no `.modules.yaml` written). Re-run it and read its output.

---

## 4. Discord token invalid / bot won't log in

**Symptom**
- Bot logs show `DiscordjsError [TokenInvalid]` or never reach `discord connected`.
- `/healthz` → `checks.discord.detail` is `"error"` (NOT `"connected"`); the
  admin dashboard shows the adapter in an error state.
- The bot container stays **healthy** (by design — §0); only Discord features die.

**Cause**
- `DISCORD_TOKEN` is wrong/reset, or you pasted the Application ID / public key /
  client secret instead of the bot token.
- `config.discord.enabled` is **true only when BOTH `DISCORD_TOKEN` and
  `DISCORD_CLIENT_ID` are non-empty** (verified in code — `adapter.ts:55-62`
  shows the adapter sets state `disabled` with detail
  `"DISCORD_TOKEN / DISCORD_CLIENT_ID not configured"` when not enabled). If
  either is empty, the adapter simply does not connect — that's not an error;
  admin and tests still run.

**Investigation**

```bash
docker compose exec app curl -fsS http://bot:8081/healthz   # read checks.discord.detail
docker compose logs --tail=100 bot | grep -i "discord\|token\|TokenInvalid\|4014"
```

**Solution**

```bash
# Discord Developer Portal → Bot → Reset Token; paste into .env (DISCORD_TOKEN),
# then restart just the bot:
docker compose restart bot
docker compose exec app curl -fsS http://bot:8081/healthz   # expect detail:"connected"
```

> A valid bot token is long with two dots (`MTE4…xxxx.Gh7aBc.yyyy…`); the
> Application ID / public key / client secret are NOT the token. On 2026-06-27 the
> local `.env` had a **valid** token (bot `/healthz` → `discord: connected`,
> verified by execution) — so the bot↔Discord path is known-good; a failure here
> means a *changed* credential. Never print or paste the token anywhere; use the
> placeholder `<DISCORD_BOT_TOKEN>`.

---

## 5. Privileged-intent error 4014 ("Disallowed intents")

**Symptom**
- Bot refuses to connect; logs show gateway close code **4014** / "Disallowed
  intents"; `checks.discord.detail` never becomes `"connected"`.

**Cause** (verified in code — `packages/discord-adapter/src/adapter.ts:64-84`)
- You set `DISCORD_ENABLE_GUILD_MEMBERS=true` and/or
  `DISCORD_ENABLE_MESSAGE_CONTENT=true`, which makes the adapter **request** the
  privileged `GuildMembers` / `MessageContent` intents, but you did **not** toggle
  the matching intent in the Discord Developer Portal. The portal toggle and the
  env flag MUST agree — requesting a privileged intent that isn't enabled in the
  portal makes the gateway reject the connection outright.
- A pure audio/music bot needs **neither** intent — leave both `false`. The base
  set `Guilds`, `GuildVoiceStates`, `GuildMessages`, `GuildModeration` is always
  requested and is **non-privileged** (requires zero portal toggles).
  `GuildVoiceStates` (used by audio and the `voice.state.update` event) is **NOT**
  privileged.

**Investigation**

```bash
docker compose logs --tail=100 bot | grep -i "4014\|disallowed\|intent"
docker compose exec app sh -c 'env | grep -i DISCORD_ENABLE'
```

**Solution**
- Either enable the matching intent in the portal (Bot → Privileged Gateway
  Intents → **Server Members Intent** for `GuildMembers`, **Message Content
  Intent** for `MessageContent`), **or** set the env flag back to `false`:

```bash
# In .env (audio bot needs neither):
# DISCORD_ENABLE_GUILD_MEMBERS=false
# DISCORD_ENABLE_MESSAGE_CONTENT=false
docker compose restart bot
```

> Parsing detail (verified in code — `packages/config/src/index.ts`): each flag is
> `true` only when the value equals the string `"true"`; anything else is `false`.

---

## 6. Missing intents → welcome / automod silently inactive (no 4014)

**Symptom**
- Bot connects fine, but the **welcome/leave** module never posts (no join/leave
  messages, no welcome cards, no join-time auto-roles).
- **Automod** content rules (banned words / links / caps) never trigger even
  though the module is enabled.

**Cause** (verified in code — `adapter.ts:73-84`,
`packages/core/src/contracts/events.ts`; see `commands-and-events.md` §4)
- `GuildMembers` OFF (default): `member.join` / `member.leave` events **never
  fire**, so welcome has nothing to react to (and birthdays-on-join is silent).
- `MessageContent` OFF (default): `message.create.content` is delivered as the
  **empty string**, so automod **content** rules cannot match. The automod module
  logs a **DEGRADED** warning at load. Count-based rules (mention count,
  attachments, spam window) and the count-based modules (server-stats, levels)
  still work — they don't need message text.

**Investigation**

```bash
docker compose logs bot | grep -i "degraded\|automod\|message content"
docker compose exec app sh -c 'env | grep -i DISCORD_ENABLE'
```

**Solution**
- Enable the matching portal intent **and** set the env flag (the §5 pairing),
  then `docker compose restart bot`. After enabling `GuildMembers`, also confirm
  the welcome module is **enabled** in the admin panel (see §13).

> Distinction from §5: a *missing* privileged intent (flag OFF) **degrades
> silently** — the bot connects normally. A *requested-but-not-portal-enabled*
> intent (flag ON, portal OFF) is the **hard 4014 failure** in §5.

---

## 7. Missing Discord permissions (role too low, can't moderate)

**Symptom**
- Moderation commands run but fail with a permissions error; the bot can't add a
  role from a role-menu / welcome / birthday flow; "I can't manage that role".
- Kick/ban/timeout refuses to act on certain members.

**Cause** (verified in code —
`packages/discord-adapter/src/guild-service.ts`; see `commands-and-events.md` §5)
- The bot's own role is **too low in the role hierarchy**: managing a role
  requires the bot to have `ManageRoles`, its highest role to be **above** the
  target role, and the role to be non-managed.
- Channel-level permission overrides deny what the server role grants (common for
  `Connect`/`Speak` in a specific voice channel).
- **Owner protection**: kick/ban/timeout deliberately refuse the **guild owner**
  (verified in code — owner check in moderation). This is intended, not a bug.
- Per-command Discord gating: moderation commands set `default_member_permissions`
  (`BanMembers`, `ModerateMembers`, etc.), so members without those Discord
  permissions don't even see them. raise-hand moderator buttons re-check
  server-side via `GuildService.memberHasPermission` (Discord's
  `default_member_permissions` does NOT apply to component clicks).

**Investigation**

```bash
docker compose logs bot | grep -i "permission\|manage\|hierarchy\|kickable"
# Each module's declared requiredPermissions/requiredIntents show in the admin panel.
```

**Solution**
- In Discord **Server Settings → Roles**, drag the **bot's role above** the roles
  it must assign; ensure it has `Manage Roles` (plus `Connect`+`Speak` for audio).
- Re-invite with the right permissions if needed. The documented audio-minimum
  invite is **View Channels + Send Messages + Connect + Speak** (permissions
  integer **`3147776`**, from `docs/DISCORD_SETUP.md` —
  documented-elsewhere-unverified; the repo itself computes no permissions
  integer). For moderation/community features, regenerate the invite via the
  portal **OAuth2 → URL Generator** with the extra bits ticked.

---

## 8. Database connection failures (host `db`, migrations, TEST_DATABASE_URL)

**Symptom**
- `admin`/`bot` log `ECONNREFUSED`, `getaddrinfo ENOTFOUND db`, or
  `password authentication failed`.
- admin never becomes healthy; `/healthz` → `checks.database.status` not `"ok"`.

**Cause** (verified in code — `environment.md` §Database; `docker-compose.yml`)
- `DATABASE_URL` host must be the **compose service name `db`**, not `localhost`,
  inside containers (dev default
  `postgres://botplatform:change_me_dev_password@db:5432/botplatform`).
- Migrations not run yet (tables missing).
- The `pgdata` volume was first-initialized with a **different**
  `POSTGRES_PASSWORD` than your current `.env` — Postgres applies credentials only
  on **first** init of the data directory.
- Integration tests use a **separate** `TEST_DATABASE_URL` (dev default
  `…@db:5432/botplatform_test`, set in `docker-compose.yml`; derived as
  `DATABASE_URL` with `_test` appended if unset — `packages/database/src/test-url.ts`).
  If it's missing/corrupt, integration tests fail.

**Investigation**

```bash
docker compose ps db                                  # healthy?
docker compose logs --tail=100 db
docker compose exec db psql -U botplatform -d botplatform -c '\dt'   # tables exist?
docker compose exec app sh -c 'echo "$DATABASE_URL"'  # host should be db, not localhost
```

**Solution**

```bash
# Missing tables → run migrations:
docker compose exec app pnpm db:migrate

# Password mismatch (DESTROYS local DB data — dev only):
docker compose down -v
docker compose up -d db app
docker compose exec app pnpm db:setup       # migrate + seed

# Integration test DB problems — recreate the _test database:
docker compose exec db psql -U botplatform -c 'DROP DATABASE IF EXISTS botplatform_test'
docker compose exec app pnpm test:integration   # recreates/migrates it as needed
```

> Postgres 18 stores data at **`/var/lib/postgresql`** (NOT the pre-18
> `…/data`); the compose files already mount the `pgdata` volume there. There are
> **10 migrations** (`0000_romantic_moonstone` .. `0009_legal_cammi`) — verified
> applied by execution on 2026-06-27.

---

## 9. Port 3000 already in use (admin)

**Symptom**
- `docker compose up` fails with `bind: address already in use` / "port is
  already allocated" for `3000`, or the panel is served by some *other* app.

**Cause**
- Admin is the only host-published service:
  `${ADMIN_PORT:-3000}:${ADMIN_PORT:-3000}` (verified in code —
  `docker-compose.yml`). Something else on the host already holds 3000. The bot's
  8081 is Docker-network-only and never conflicts; db's 5432 is not published.

**Investigation**

```bash
# Windows (PowerShell or cmd):
netstat -ano | findstr :3000        # note the PID in the last column
# Linux/macOS:
lsof -i :3000
```

**Solution**

```bash
# Either stop the other process, or change the port in .env:
# ADMIN_PORT=3001
# PUBLIC_ADMIN_URL=http://localhost:3001
docker compose up -d admin
# Panel now at http://localhost:3001
```

---

## 10. Container exits immediately (bad env / crash on boot)

**Symptom**
- `docker compose ps` shows a service `Exited (1)` seconds after start, or it
  restart-loops.

**Cause** (verified in code/compose)
- **Dev:** a watcher crashed on a config error. On invalid config, `loadConfig()`
  throws `CONFIG_INVALID` listing the **offending variable NAMES only** (never
  values) — usually `SESSION_SECRET` < 32 chars or `INTERNAL_API_TOKEN` < 8 chars
  (verified in code — `packages/config/src/index.ts`).
- **Prod:** required secrets use `${VAR:?message}`; compose refuses to start and
  the error names the missing variable (`DATABASE_URL`, `SESSION_SECRET`,
  `INTERNAL_API_TOKEN`, `POSTGRES_PASSWORD`). No dev fallbacks in the prod file.
- A `scripts/*.sh` saved as **CRLF** → `bash\r: No such file or directory` (LF is
  enforced by `.gitattributes`).

**Investigation**

```bash
docker compose logs --tail=100 bot     # or admin
docker compose logs bot | grep -i "CONFIG_INVALID\|SESSION_SECRET\|INTERNAL_API_TOKEN"
docker compose ps                      # exit code in the STATUS column
```

**Solution**
- Fix the named env var in `.env` (e.g. `SESSION_SECRET` ≥32 chars,
  `INTERNAL_API_TOKEN` ≥8 chars), then `docker compose up -d <service>`.
- Generate a strong secret inside the container:

```bash
docker compose exec app node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- CRLF problem → re-checkout with `git config core.autocrlf false`, or convert
  the offending `scripts/*.sh` to LF.

> Related: can't log in to admin over plain HTTP usually means `COOKIE_SECURE=true`
> without HTTPS (dev default is `false`, prod compose default is `true`). Set
> `COOKIE_SECURE=false` for local HTTP trials, then `docker compose up -d admin`.

---

## 11. Slash commands not appearing in Discord

**Symptom**
- The bot is online but `/play`, `/warn`, etc. don't show in the picker.

**Cause** (verified in code — `apps/bot/src/register-commands.ts`;
`commands-and-events.md` §1, §7)
- Commands were never registered — registration is a **separate CLI step**, not
  done automatically at boot. The CLI concatenates the commands of all **16
  command-owning modules** and registers them in one call. The 4 command-less
  modules (welcome, dynamic-cards, scheduled-messages, automod) own no commands
  and are correctly absent.
- **Global** registration (no `DISCORD_GUILD_ID`) can take up to **~1 hour** to
  propagate; **guild** registration (with `DISCORD_GUILD_ID` set) is **instant**
  for that server.
- The invite lacked the `applications.commands` scope.
- The Discord client cached the old command set.

> **Reality check on "20 modules, 7-ish commands":** of the 20 modules, only 16
> own slash commands; several of those expose **one** parent command with
> subcommands (announcements `/announcement`, role-menus `/roles`, birthdays
> `/birthday`, reminders `/reminder`, giveaways `/giveaway`, custom-commands
> `/custom`), so the count of **top-level** commands is far smaller than 20. The
> heavy hitters are audio-player (12) and moderation (12). (verified in code —
> see the catalog in `commands-and-events.md` §1.)

**Investigation**

```bash
docker compose exec app sh -c 'env | grep -E "DISCORD_TOKEN|DISCORD_CLIENT_ID|DISCORD_GUILD_ID"'
# (Token shown only as set/empty — do not paste it anywhere.)
```

**Solution**

```bash
docker compose exec app pnpm discord:register-commands
# Prints: "Registered N slash commands for guild <id> (instant)."  OR
#         "Registered N slash commands for all servers (global — may take up to an hour to appear)."
```

> The CLI **exits 1** if `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` are unset
> (verified in code — `register-commands.ts:36-42`, the `config.discord.enabled`
> gate). Set `DISCORD_GUILD_ID` for instant local registration. If commands still
> look stale, fully reload the Discord client (Ctrl+R).

---

## 12. Bot online but not responding to a command

**Symptom**
- The bot shows online in Discord, but a command does nothing, or replies with
  one of: **"Unknown command."** / **"This command only works inside a server."**
  / **"The `<Module Name>` module is currently disabled."**

**Cause** (verified in code — `packages/core/src/registry.ts:102-123`, the exact
dispatcher replies)
- **"Unknown command."** → the command isn't registered with this bot
  (`registry.ts:104-106`); register it (§11), or you renamed/removed it without
  re-registering.
- **"This command only works inside a server."** → a `guildOnly` command invoked
  in a DM (`registry.ts:110-113`).
- **"The `<Module Name>` module is currently disabled."** → the owning module is
  disabled in the DB (`registry.ts:115-122`). The reply uses the module's display
  name (e.g. "Auto-Moderation", "Speaker Queue"). **Note:** runtime defaults to
  **enabled** if the module row is missing or the DB lookup fails
  (`CachedModuleState` returns the last known value, default `true` —
  `packages/core/src/module-state.ts:29`; `modulesRepo.isEnabled` treats a missing
  row as enabled — `repositories/modules.ts:44-47`). So a "disabled" reply means
  an explicit `enabled=false` row exists in `modules`.
- Permissions/intents missing for that feature (§6, §7).

> **Three-place wiring** that a working command depends on (verified in code):
> (1) the module is in the kernel `modules` array in `apps/bot/src/main.ts` (so
> its handlers are dispatchable), (2) it owns the command and that module is in
> `apps/bot/src/register-commands.ts` (so Discord knows the command shape), and
> (3) the `modules` row is `enabled=true` (seeded by `db:seed`, toggled in the
> admin panel). All three must line up.

**Investigation**

```bash
docker compose logs bot | grep -i "disabled\|unknown command\|command execution failed"
# Read module enabled-state directly (table modules, columns key/enabled — verified
# in code, packages/database/src/schema.ts:66-70):
docker compose exec db psql -U botplatform -d botplatform -c "SELECT key, enabled FROM modules;"
```

**Solution**
- Register commands (§11).
- Re-enable the module in the **admin panel** (Modules page — the supported way)
  or directly in the DB:

```bash
docker compose exec db psql -U botplatform -d botplatform -c \
  "UPDATE modules SET enabled = true WHERE key = '<module-key>';"
```

- Fix intents/permissions for content/member/voice features (§6, §7).

> **Only two modules are enabled by default** after a fresh seed: `audio-player`
> and `announcements` (verified in code — `seed.ts:29,35`). Everything else
> defaults OFF and must be enabled before its commands respond. **Second enable
> flag gotcha:** some modules have a *row-level* enable on top of the module
> enable — e.g. `levels` needs `level_settings.enabled=true` (default false), set
> via `/levelconfig enabled:true`, even after the levels module is enabled.

---

## 13. New module added but not appearing — full checklist

Adding a module touches **four** places. If a new module's commands don't show,
or it never runs, walk this list (verified in code):

1. **`MODULE_KEYS`** — add the key in `packages/shared/src/types.ts`
   (`MODULE_KEYS`). This is the single source of truth (20 keys today). Skipping
   this leaves the key untyped everywhere downstream.
2. **Kernel wiring** — add `…Handle.module` to the `modules: [ … ]` array in
   `apps/bot/src/main.ts` (and register any `schedulerJob` / `schedulerJobs[]`
   there too). A module not in this array is never loaded — its events,
   interactions, and scheduler jobs never fire.
3. **Slash-command registration** — if it owns commands, import its factory and
   spread `…module.commands` into the `commands` array in
   `apps/bot/src/register-commands.ts`, **and re-run**
   `docker compose exec app pnpm discord:register-commands`. Command-less modules
   (event/scheduler/service-only) are correctly absent from this file.
4. **Seed row** — add it to `builtInModules` in `packages/database/src/seed.ts`
   (key + name + description + `defaultEnabled`) and run
   `docker compose exec app pnpm db:seed`. Without a row the module still runs
   (missing row = enabled by default — §12), but the admin Modules page won't list
   it and you can't toggle it from the panel.

```bash
# After wiring all four, from the repo root:
docker compose restart bot
docker compose exec app pnpm db:seed                  # idempotent; adds the new row
docker compose exec app pnpm discord:register-commands # if it owns commands
docker compose exec db psql -U botplatform -d botplatform -c \
  "SELECT key, enabled FROM modules WHERE key = '<new-module-key>';"
```

> **`db:seed` never downgrades your choice** (verified in code —
> `repositories/modules.ts:9,24-31`: `ensure()` updates name/description on
> conflict but does **not** rewrite `enabled`). So re-seeding will neither
> re-enable a module you turned off nor disable one you turned on; it only inserts
> missing rows (with `defaultEnabled`) and refreshes names/descriptions.

> **Admin route is optional and is a known gap.** A module works fully via Discord
> without an admin page. `apps/admin/src/routes/index.ts` registers **9 real**
> route plugins (announcements, cards, welcome, role-menus, scheduled-messages,
> custom-commands, birthdays, automod, commands) + a placeholder plugin that
> "MUST stay last and only covers paths no real module owns yet". **`audio-player`
> and `moderation` have no `routes/` plugin but DO have a real admin page defined
> inline in `apps/admin/src/server.ts`** (`/audio` line 282, `/moderation` line
> 386) — so 10 of 20 modules have a real admin page. The other **10** modules
> (`reminders` plus the 9 newest: raise-hand, fun-commands, engagement-prompts,
> giveaways, server-stats, trivia, minigames, economy, levels) have **no real
> admin page** — configured via Discord commands only. `reminders` is the most
> notable gap (a static read-only placeholder page, no CRUD). (verified in code —
> `routes/index.ts`, `routes/placeholders.ts`, `server.ts:282,386`.)

---

## 14. e2e (Playwright) failures

**Symptom**
- `docker compose --profile e2e run --rm e2e` fails: admin unreachable,
  "browser not found", or auth/setup failures.

**Cause** (verified in code/compose; verified by execution on 2026-06-27 — 24
passed / 1 skipped)
- The `e2e` service depends on **`admin` being healthy**; if admin never reached
  healthy (deps not installed, migration missing), e2e can't connect.
- Browser/version drift: the `Dockerfile.dev` base tag
  (`mcr.microsoft.com/playwright:v1.60.0-noble`) MUST match the
  `@playwright/test` pin (`1.60.0`) in `pnpm-workspace.yaml`, or Playwright
  refuses to run.
- The auth setup (`tests/e2e/playwright/helpers.ts`) needs the seeded **E2E
  admin** (`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, dev defaults
  `e2e-admin@example.com` / `e2e_test_password_123`).
- `PLAYWRIGHT_BASE_URL` must be `http://admin:3000` (the compose service name),
  not `localhost`.

**Investigation**

```bash
docker compose ps admin                       # must be healthy before e2e
docker compose logs --tail=100 admin
docker compose exec app sh -c 'env | grep -E "PLAYWRIGHT_BASE_URL|E2E_ADMIN"'
```

**Solution**

```bash
# Ensure deps + DB + seed are done and admin is healthy, THEN run e2e:
docker compose exec app pnpm install
docker compose exec app pnpm db:setup         # migrate + seed (creates the E2E admin if configured)
docker compose up -d admin
# wait until: docker compose ps admin → healthy
docker compose --profile e2e run --rm e2e
```

> Do **not** run `playwright install` or set `PLAYWRIGHT_BROWSERS_PATH` — browsers
> ship in the dev image (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). If Playwright
> complains about a missing browser, the npm pin drifted from the image tag:
> realign both to the same version and `docker compose build app`.

---

## 15. Audio won't play (yt-dlp / ffmpeg / allowlist / streaming / cookies / playlist)

**Symptom**
- `/play <url>` errors, the track is skipped immediately, or the bot joins but
  stays silent.

**Cause** (verified in code — `packages/audio-module/src/index.ts`,
`resolver/*`; `packages/security/src/url-validation.ts`)
- **Streaming disabled:** with `AUDIO_ENABLE_STREAMING_SOURCES=false`, only
  direct audio-file links work — the YouTube/SoundCloud/Spotify providers are
  **not even constructed** (`index.ts:41-50`). The flag is parsed inverted
  (`!== 'false'`), so any value other than the string `false` keeps streaming on.
- **yt-dlp not available:** at load the module logs "streaming sources are enabled
  but yt-dlp is not available — YouTube/SoundCloud/Spotify links will fail …"
  (`index.ts:103-107`) and `streamingSources: 'unavailable'` in the "audio player
  ready" line. yt-dlp ships in both images (pinned `YTDLP_VERSION`, default
  `2026.06.09`); missing ⇒ you're on a stale or hand-built image.
- **Allowlist:** if `ALLOWED_AUDIO_DOMAINS` is non-empty, only those hostnames
  pass; everything else is rejected (`URL_BLOCKED` / `URL_UNSUPPORTED`).
- **SSRF protection:** links to `localhost`, private/internal IPs, or
  `*.local`/`*.internal` are blocked by design (`URL_BLOCKED`). Host test files on
  a real public URL.
- **Private/age-restricted YouTube:** needs a Netscape cookies file via
  `YTDLP_COOKIES_FILE` (a path **inside the container**); without it yt-dlp may
  emit "Sign in to confirm you're not a bot" / extraction errors. **Unlisted**
  videos do NOT need cookies.
- **Track too long:** tracks over `MAX_TRACK_DURATION_SECONDS` (default 3600;
  `0` = unlimited) are rejected/skipped.
- **Playlist size:** `/playlist` pulls at most `MAX_PLAYLIST_ITEMS` tracks
  (default 100, max 1000). As of 2026-06-27 this var is wired through both compose
  files (`${MAX_PLAYLIST_ITEMS:-100}`), so setting it in `.env` and recreating the
  bot (`docker compose up -d bot`) takes effect. (It was previously missing from
  the compose env blocks — a value in `.env` did not reach the container.)
- **ffmpeg/opus broken:** silence despite a successful resolve usually means the
  voice stack is missing ffmpeg or `@discordjs/opus`.

**Investigation**

```bash
docker compose logs bot | grep -i "audio\|yt-dlp\|stream\|resolve\|URL_BLOCKED\|sign in"
docker compose exec app yt-dlp --version           # expect 2026.06.09 (or your pin)
docker compose exec app ffmpeg -version
docker compose exec app pnpm exec tsx scripts/check-audio-stack.ts   # opus + encryption + ffmpeg report
docker compose exec app sh -c 'env | grep -E "AUDIO_ENABLE_STREAMING_SOURCES|ALLOWED_AUDIO_DOMAINS|MAX_TRACK_DURATION_SECONDS|MAX_PLAYLIST_ITEMS|YTDLP_"'
```

**Solution**

```bash
# Streaming was off → re-enable:
#   AUDIO_ENABLE_STREAMING_SOURCES=true   (in .env), then:
docker compose restart bot

# yt-dlp stale / "Sign in to confirm you're not a bot" → bump version + rebuild:
#   edit YTDLP_VERSION in Dockerfile / Dockerfile.dev to the latest release
docker compose build app
docker compose up -d bot
docker compose exec app yt-dlp --version

# Private/age-restricted YouTube → mount a cookies file and point INSIDE the container:
#   YTDLP_COOKIES_FILE=/workspace/secrets/youtube-cookies.txt   (dev)
#   (keep the file under secrets/, bind-mounted; never commit it)
docker compose restart bot
```

> If `ALLOWED_AUDIO_DOMAINS` is set with streaming on, include the platforms you
> use, e.g. `youtube.com,youtu.be,soundcloud.com,open.spotify.com`. Spotify plays
> the closest YouTube match (their audio is DRM-protected); only single
> `…/track/…` links work — not albums/playlists (documented-elsewhere-unverified;
> the `SpotifyAudioProvider` is verified present, `index.ts:48`). Per-track
> failures are also surfaced in the admin panel (Audio Player → recent playback
> errors).

---

## 16. How to: logs / shell / health / module state

**Logs**

```bash
docker compose logs -f --tail=200            # all services, follow
docker compose logs -f bot                   # one service
docker compose logs --since=10m admin        # recent window
```

**Shell into a container**

```bash
docker compose exec app bash    # toolbox: pnpm, psql, git, yt-dlp, ffmpeg, node
docker compose exec bot bash
docker compose exec admin bash
docker compose exec db sh       # alpine image → sh, not bash
```

**Inspect health**

```bash
docker compose ps                                          # health column per service
curl http://localhost:3000/healthz                         # admin (host)
docker compose exec app curl -fsS http://bot:8081/healthz  # bot (network-only)
docker inspect "$(docker compose ps -q admin)" | grep -i health -A5  # raw healthcheck state
```

**Check / change module state** (table `modules`, columns `key`/`enabled` —
verified in code, `schema.ts:66-70`):

```bash
# Read enabled flags:
docker compose exec db psql -U botplatform -d botplatform -c "SELECT key, enabled FROM modules;"
# Toggle one (admin panel → Modules page is the supported way):
docker compose exec db psql -U botplatform -d botplatform -c \
  "UPDATE modules SET enabled = false WHERE key = 'automod';"
```

**Voice/audio runtime report**

```bash
docker compose exec app pnpm exec tsx scripts/check-audio-stack.ts
```

---

## Corrections to the legacy docs

Re-verified against code on 2026-06-27. The legacy `docs/TROUBLESHOOTING.md` now
**redirects to this file** and keeps only Windows/WSL2 host notes, so the two
can't drift. What changed:

1. **"Invalid Discord token → the bot container reports unhealthy (by design)"
   was WRONG.** The bot's `discord` health check **always returns
   `status:"ok"`**, carrying the real state in `detail` (verified in code —
   `apps/bot/src/main.ts:215-226`). A bad token does **NOT** mark the container
   unhealthy — the opposite is intentional, to avoid restart loops. Diagnose token
   problems via `checks.discord.detail`, the admin dashboard, or the logs — never
   `docker compose ps` (§0, §4).
2. **Scope drift:** older docs described **11 modules**. The repo now has **20**
   (`MODULE_KEYS`), 16 of which own slash commands; 10 migrations
   (0000..0009); 5 platform events (incl. the newer non-privileged
   `voice.state.update`). The "module disabled" reply now uses the module's
   **display name**, and **only `audio-player` + `announcements` are enabled by
   default** (§12).
3. The rest of the legacy doc (yt-dlp staleness, SSRF blocking, `COOKIE_SECURE`
   over HTTP, port conflicts, WSL2/CRLF, db password-on-first-init) was broadly
   accurate and is folded into the sections above.

---

_See `docs/technical/runtime-and-docker.md` for the full operator runbook and
command reference, and `docs/technical/environment.md` for every environment
variable and its validation rules._
