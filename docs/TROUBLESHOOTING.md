# Troubleshooting

First reflexes, always:

```bash
docker compose ps                 # which service is unhealthy?
docker compose logs --tail 100 bot
docker compose logs --tail 100 admin
docker compose exec app pnpm --version    # is the toolbox alive?
```

## Bot / Discord

**Bot does not join the voice channel**
- Are you in a voice channel yourself? `/join` joins *your* channel.
- Does the bot have **Connect** + **Speak** permissions in that channel
  (channel-level overrides can deny what the server role allows)?
- Dashboard → is the Discord adapter `connected`? If `error`, fix the token.
- `docker compose logs bot` — a 20 s connect timeout surfaces as
  "I could not connect to the voice channel."

**Slash commands not visible in Discord**
- Run `docker compose exec app pnpm discord:register-commands`.
- Without `DISCORD_GUILD_ID`, global registration takes up to **1 hour**;
  with it, registration is instant in that server.
- The invite must have included the `applications.commands` scope — re-invite
  with the URL from [DISCORD_SETUP.md](DISCORD_SETUP.md) if unsure.
- Fully restart your Discord client (Ctrl+R) — it caches commands.

**Invalid Discord token**
- Log shows `DiscordjsError [TokenInvalid]`; dashboard shows adapter `error`,
  and the bot container reports **unhealthy** (by design — the rest of the
  platform keeps working).
- A real bot token is ~70 chars with two dots (`MTE4….G….…`). The
  *Application ID*, *public key* and *client secret* are NOT the token.
- Developer portal → Bot → **Reset Token**, update `.env`,
  `docker compose restart bot`.

**Audio does not play / stops immediately**
- Supported: **YouTube, SoundCloud, Spotify** (single tracks) and **direct
  audio-file links**. See [AUDIO_SOURCES.md](AUDIO_SOURCES.md).
- `"Sign in to confirm you're not a bot"` in the bot logs → yt-dlp is stale
  or YouTube is rate-limiting this IP. Bump `YTDLP_VERSION` in `Dockerfile`/
  `Dockerfile.dev` to the latest release and
  `docker compose build app && docker compose up -d`. Verify with
  `docker compose exec app yt-dlp --version`.
- Spotify plays the closest YouTube match (their own audio is DRM-protected);
  only single `…/track/…` links work, not albums/playlists.
- Links to `localhost`/private IPs/internal hostnames are **blocked by
  design** (SSRF protection) — host test files on a real public URL, or relax
  consciously via guild allowlist + code change.
- Streaming disabled? Check `AUDIO_ENABLE_STREAMING_SOURCES` is not `false`,
  and `docker compose exec app pnpm exec tsx scripts/check-audio-stack.ts`.
- If `ALLOWED_AUDIO_DOMAINS` is set, only those domains pass.
- Admin panel → Audio Player → **Recent playback errors** shows the safe
  error per track.
- Tracks longer than `MAX_TRACK_DURATION_SECONDS` are skipped by the safety
  timer (default 3600 s).

**ffmpeg issues**
- Verify inside the container:
  `docker compose exec app ffmpeg -version` and
  `docker compose exec app pnpm exec tsx scripts/check-audio-stack.ts`
  (prints the full voice dependency report — opus, encryption, ffmpeg).
- ffmpeg is baked into both the dev and prod images; if it's missing you're
  running a stale image → `docker compose build --no-cache app`.
- Never install ffmpeg on Windows — the bot doesn't run there.

## Admin panel

**Cannot log in**
- Did the seed run? `docker compose exec app pnpm db:seed` (it prints
  `admin user created: …` or `already exists`).
- Email matching is case-insensitive; the password is exactly what's in
  `.env` **at the time you seeded** — changing `.env` later does NOT change
  an existing user's password (delete the row or use a new email).
- `429 Too many attempts` → login rate limit; wait one minute.
- Behind HTTPS? With `COOKIE_SECURE=true` the session cookie is dropped over
  plain HTTP and login silently bounces back — set `COOKIE_SECURE=false` for
  HTTP trials.

**Admin panel not reachable from the browser**
- `docker compose ps` — is `admin` healthy? If it logs
  "waiting for dependencies", run `docker compose exec app pnpm install`.
- Port conflict: something else on 3000 → change `ADMIN_PORT` in `.env` and
  `docker compose up -d admin`.
- Try `http://127.0.0.1:3000` instead of `localhost` (rare IPv6 binding
  quirk on Windows).

## Database

**`db` unhealthy / connection refused**
- `docker compose logs db`. Most common: the `pgdata` volume was initialized
  with a *different* `POSTGRES_PASSWORD` than your current `.env` —
  PostgreSQL only applies credentials on FIRST init.
  Fix (destroys local data): `docker compose down -v && docker compose up -d`.
- `DATABASE_URL` must use host **`db`** (the compose service name), not
  `localhost`, when running inside containers.

**Migrations fail**
- `relation already exists` → you probably hand-created tables; reset the dev
  DB (`down -v`) or fix manually via
  `docker compose exec db psql -U botplatform botplatform`.
- Integration tests use a separate `botplatform_test` database created
  automatically; if it gets corrupted just drop it:
  `docker compose exec db psql -U botplatform -c 'DROP DATABASE botplatform_test'`.

## Docker on Windows

**Docker Desktop not running**
- `docker version` errors with `open //./pipe/dockerDesktopLinuxEngine` →
  start Docker Desktop and wait for the whale icon to settle.

**WSL2 backend issues**
- Settings → General → "Use the WSL 2 based engine" should be ON.
- `wsl --update` then restart Docker Desktop fixes most "engine won't start"
  states; `wsl --shutdown` (then reopen Docker Desktop) is the bigger hammer.
- Out-of-memory during builds → create `%UserProfile%\.wslconfig` with
  `[wsl2]\nmemory=6GB` and restart WSL.

**Slow bind mounts / slow installs**
- Source lives on the Windows filesystem → file I/O crosses a VM boundary.
  We already keep `node_modules` and the pnpm store in named Linux volumes
  (the slow part). If the repo itself feels slow, clone it inside the WSL
  filesystem (`\\wsl$\...`) and run compose from there.

**File changes not picked up by the watchers**
- Known Windows limitation: inotify events don't always cross the bind
  mount. Cheap fix: `docker compose restart bot admin`.

**Line ending issues**
- Symptom: `bash\r: No such file or directory` running `scripts/*.sh`.
- `.gitattributes` forces LF for shell scripts; if you somehow got CRLF:
  `git config core.autocrlf false` + re-checkout, or convert the file to LF
  in your editor.

**Port already in use**
- `netstat -ano | findstr :3000` → find the PID, stop it, or change
  `ADMIN_PORT`.

**Container cannot reach another service**
- Use service names (`db`, `bot`, `admin`) — never `localhost` — between
  containers. From the **e2e/app** container the panel is `http://admin:3000`.

**Reset everything Docker-side**
```bash
docker compose down -v          # containers + volumes (DB data!)
docker compose build --no-cache
docker compose up -d
docker compose exec app pnpm install
docker compose exec app pnpm setup
```

**Playwright browser issues inside the container**
- The dev image ships matched browsers at `/ms-playwright`. If Playwright
  complains about missing browsers, the npm package version drifted from the
  image tag — keep `@playwright/test` in `pnpm-workspace.yaml` **exactly**
  equal to the `Dockerfile.dev` base tag (currently 1.60.0), then
  `docker compose build app`.
- Do not set `PLAYWRIGHT_BROWSERS_PATH` and do not run `playwright install`.

**Database volume problems**
- Postgres 18 images store data under `/var/lib/postgresql` (the compose
  files already mount the volume there). If you change Postgres major
  versions, the old volume is incompatible: dump first
  (`pg_dump`), `docker compose down -v`, start, restore.
