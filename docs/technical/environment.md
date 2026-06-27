# Environment & Configuration Reference

> Verified against code on 2026-06-27. Markers used below:
> **(verified in code)** — confirmed by reading the source file cited;
> **(deduced)** — inferred from the code but not stated literally;
> **(documented-elsewhere-unverified)** — taken from another doc, not re-checked here.
>
> This platform is **Docker-first**: the Windows host has no Node/pnpm/ffmpeg/psql.
> Every command runs inside a container, e.g.
> `docker compose exec app pnpm db:migrate`. Services read their environment from
> Docker Compose, which in turn reads your `.env`.

## How configuration is loaded

There are **two** ways env vars reach the code:

1. **The validated config object** — `loadConfig()` in
   `packages/config/src/index.ts` (verified in code). It parses `process.env`
   with a Zod schema, applies defaults, coerces types, and on failure throws
   `PlatformError('CONFIG_INVALID', ...)` listing the offending **variable
   names only** (never values). The bot and admin apps consume the resulting
   typed `AppConfig`. This is the canonical list of "platform" variables.

2. **Direct `process.env` reads** — a handful of variables are read straight
   from `process.env`, **outside** the Zod schema (verified in code via Grep).
   These are used by CLIs (migrate/seed), the Drizzle config, the integration
   test-DB resolver, and the Playwright e2e harness:
   - `packages/database/drizzle.config.ts` → `DATABASE_URL`
   - `packages/database/src/migrate.ts` → `MIGRATIONS_DIR`
   - `packages/database/src/migrate-cli.ts` → `DATABASE_URL`
   - `packages/database/src/seed-cli.ts` → `DATABASE_URL`, `ADMIN_EMAIL`,
     `ADMIN_PASSWORD`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`
   - `packages/database/src/test-url.ts` → `TEST_DATABASE_URL`, `DATABASE_URL`
   - `apps/bot/src/migrate.ts` → `DATABASE_URL`
   - `apps/bot/src/seed.ts` → `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
     `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`
   - `tests/e2e/playwright.config.ts` → `CI`, `PLAYWRIGHT_BASE_URL`
   - `tests/e2e/playwright/global-setup.ts` → `PLAYWRIGHT_BASE_URL`
   - `tests/e2e/playwright/helpers.ts` → `E2E_ADMIN_EMAIL`,
     `E2E_ADMIN_PASSWORD` (and a dynamic `process.env[key]` lookup)

> `ADMIN_EMAIL` / `ADMIN_PASSWORD` are in the Zod schema (optional, default `''`)
> **and** read directly by the seed CLIs. The `E2E_*` and `TEST_DATABASE_URL`
> vars are **only** read directly (not in the Zod schema) (verified in code).

---

## Full variable reference

Legend: **Docker-specific?** = the value is meaningful only because services
talk over the Compose network (e.g. host `db`, `bot`, `admin`) or a container
path.

### Runtime

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `NODE_ENV` | optional | `development` | `config.nodeEnv`; Zod enum `development\|test\|production` (`packages/config/src/index.ts`). Forced to `production` by the prod compose and the Dockerfile `runtime-base` stage. | No |
| `LOG_LEVEL` | optional | `info` | `config.logLevel`; Zod enum `fatal\|error\|warn\|info\|debug\|trace`. | No |

### Database

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `DATABASE_URL` | **required** | none (Zod `min(1)`) | `config.database.url`; also read directly by migrate/seed CLIs, `drizzle.config.ts`, and `test-url.ts`. In Docker the host is the compose service name `db`. | Yes (host `db`) |
| `POSTGRES_USER` | optional | `botplatform` | Read **only by the `db` container** (postgres image init), via compose, not by Node. | Yes |
| `POSTGRES_PASSWORD` | optional (dev) / **required (prod)** | `change_me_dev_password` (dev) | Postgres image init. Prod compose marks it required (`${POSTGRES_PASSWORD:?...}`). | Yes |
| `POSTGRES_DB` | optional | `botplatform` | Postgres image init (database name). | Yes |
| `MIGRATIONS_DIR` | optional | resolves to `../migrations` next to the migrate module (`packages/database/src/migrate.ts`); set to `/app/migrations` in the prod Dockerfile `bot` stage. | Drizzle migration runner. **Not in `.env.example`** (verified in code). | Yes (container path) |
| `TEST_DATABASE_URL` | optional | derived: `DATABASE_URL` with `_test` appended to the DB name (`packages/database/src/test-url.ts`). | Integration tests. **Not in `.env.example`**, but **is** set in dev `docker-compose.yml` to `...@db:5432/botplatform_test` (verified in code). | Yes |

### Discord

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `DISCORD_TOKEN` | optional | `''` | `config.discord.token`. Empty = no Discord connection (admin/tests still work). `config.discord.enabled` is true only when **both** token and client id are non-empty (`packages/config/src/index.ts:148`). | No |
| `DISCORD_CLIENT_ID` | optional | `''` | `config.discord.clientId`; used by command registration (`packages/discord-adapter/src/register-commands.ts`) and to derive `enabled`. | No |
| `DISCORD_GUILD_ID` | optional | `''` | `config.discord.guildId`. If set, slash commands register **per-guild** (instant); if empty, **globally** (up to ~1h to appear) — `register-commands.ts` chooses `applicationGuildCommands` vs `applicationCommands`. | No |
| `DISCORD_ENABLE_GUILD_MEMBERS` | optional | `false` | `config.discord.enableGuildMembers`; string→bool (`=== 'true'`). When true, the adapter adds the **GuildMembers** privileged intent (`packages/discord-adapter/src/adapter.ts:79`). | No |
| `DISCORD_ENABLE_MESSAGE_CONTENT` | optional | `false` | `config.discord.enableMessageContent`; string→bool. When true, the adapter adds the **MessageContent** privileged intent (`adapter.ts:82`). | No |

> **Base gateway intents are always requested** (verified in code,
> `adapter.ts:73-78`): `Guilds`, `GuildVoiceStates`, `GuildMessages`,
> `GuildModeration`. None of these is privileged, so the default audio bot
> connects with **zero** Developer-Portal toggles. `GuildVoiceStates` (used by
> audio and by the newer `voice.state.update` event) is **not** privileged.

### Admin panel

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `ADMIN_PORT` | optional | `3000` | `config.admin.port`; Zod int 1–65535. Also the published host port in compose (`${ADMIN_PORT}:${ADMIN_PORT}`). | Partially |
| `PUBLIC_ADMIN_URL` | optional | `http://localhost:3000` | `config.admin.publicUrl`; used for absolute links in the admin UI. | No |
| `SESSION_SECRET` | **required** | none (Zod `min(32)`) | `config.admin.sessionSecret`; session cookie encryption. **Must be ≥32 chars** or config validation fails. Prod compose marks it required. | No |
| `COOKIE_SECURE` | optional | `false` (dev), `true` (prod compose) | `config.admin.cookieSecure`; string→bool. Set `true` behind HTTPS; on plain HTTP with `true`, logins won't work. | No |
| `ADMIN_EMAIL` | optional | `''` | `config.admin.bootstrapEmail`; also read directly by seed CLIs — the bootstrap admin user created by `pnpm db:seed`. | No |
| `ADMIN_PASSWORD` | optional | `''` | `config.admin.bootstrapPassword`; bootstrap admin password (seed). | No |

### Bot worker (internal API)

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `HEALTH_PORT` | optional | `8081` | `config.bot.healthPort`; bot health endpoint + internal status API. Used in compose healthchecks and the Dockerfile `HEALTHCHECK`. **Not published** to the host. | Yes |
| `INTERNAL_API_TOKEN` | **required** | none (Zod `min(8)`) | `config.bot.internalApiToken`; shared secret between admin and bot internal API. Prod compose marks it required. | Yes |
| `BOT_INTERNAL_URL` | optional | `http://bot:8081` | `config.bot.internalUrl`; where admin reaches the bot. Host `bot` is the compose service name. | Yes (host `bot`) |

### Audio module

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `ALLOWED_AUDIO_DOMAINS` | optional | `''` (empty = any public domain) | `config.audio.allowedDomains` (CSV parsed, lowercased). If set with streaming, include `youtube.com,youtu.be,soundcloud.com,open.spotify.com`. | No |
| `MAX_QUEUE_SIZE` | optional | `50` | `config.audio.maxQueueSize`; Zod int 1–1000. | No |
| `MAX_PLAYLIST_ITEMS` | optional | `100` | `config.audio.maxPlaylistItems`; Zod int 1–1000. Max tracks pulled from one YouTube playlist. Wired through both compose files (`${MAX_PLAYLIST_ITEMS:-100}`) as of 2026-06-27, so a value in `.env` now reaches the container. | No |
| `MAX_TRACK_DURATION_SECONDS` | optional | `3600` (1h) | `config.audio.maxTrackDurationSeconds`; Zod int min 0. **`0` = unlimited** (allows multi-hour tracks and live/radio streams) (verified in code). | No |
| `AUDIO_REQUEST_TIMEOUT_MS` | optional | `15000` | `config.audio.requestTimeoutMs`; Zod int min 100. | No |
| `AUDIO_ENABLE_STREAMING_SOURCES` | optional | `true` | `config.audio.enableStreamingSources`; string→bool but **inverted** (`!== 'false'`), so any value other than `false` is treated as true. `false` = only direct audio-file links. | No |
| `YTDLP_PATH` | optional | `yt-dlp` | `config.audio.ytdlpPath`; the yt-dlp binary (ships in the images at `/usr/local/bin/yt-dlp`, pinned via Dockerfile `ARG YTDLP_VERSION`). | No |
| `YTDLP_COOKIES_FILE` | optional | `''` (none) | `config.audio.ytdlpCookiesFile`; Netscape cookies.txt for **private/age-restricted** YouTube (unlisted videos do NOT need it). Mount into the bot container, e.g. `/workspace/secrets/youtube-cookies.txt` (dev) or `/secrets/youtube-cookies.txt` (prod). | Yes (container path) |

### Storage

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `UPLOADS_DIR` | optional | `/workspace/uploads` (Zod default); overridden to `/app/uploads` by the prod Dockerfile (`ENV UPLOADS_DIR=/app/uploads`) and prod compose. | `config.storage.uploadsDir`; dynamic-cards uploaded assets. Backed by a named volume (`uploads` dev / `uploads-prod` prod). **Not in `.env.example`** (verified in code). | Yes (container path + volume) |

### Build metadata

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `BUILD_VERSION` | optional | `0.1.0` | `config.version`; shown on the admin dashboard/settings (`apps/admin/src/server.ts:252,460`) and asserted by an e2e test (`tests/e2e/playwright/dashboard.spec.ts`). **Not in `.env.example`** and **not set in any compose file or the Dockerfile** — so it currently always resolves to the default `0.1.0` (verified in code). | No |

### E2E test harness (Playwright)

| Variable | Req? | Default | Consumer | Docker-specific? |
|---|---|---|---|---|
| `E2E_ADMIN_EMAIL` | optional | `e2e-admin@example.com` | Seeded e2e admin login; read by seed CLIs + `tests/e2e/playwright/helpers.ts`. **Not in the Zod schema.** | No |
| `E2E_ADMIN_PASSWORD` | optional | `e2e_test_password_123` | Seeded e2e admin password. **Not in the Zod schema.** | No |
| `PLAYWRIGHT_BASE_URL` | optional | `http://admin:3000` | Base URL for the e2e runner (`playwright.config.ts`, `global-setup.ts`). Host `admin` is the compose service. | Yes (host `admin`) |
| `CI` | optional | unset | `playwright.config.ts` — sets `retries: 1` when truthy. Provided by the CI runner, not `.env`. | No |

---

## Discrepancies between `.env.example`, code, and Compose

(verified in code on 2026-06-27)

**Consumed in code but MISSING from `.env.example`:**

- `UPLOADS_DIR` — read by `config` and set in both compose files; absent from
  `.env.example`. Harmless (has a default) but undocumented for users.
- `TEST_DATABASE_URL` — read by `test-url.ts`; set in dev `docker-compose.yml`
  but absent from `.env.example`.
- `MIGRATIONS_DIR` — read by the migration runner; set in the prod Dockerfile;
  absent from `.env.example`.
- `BUILD_VERSION` — read by `config.version`; absent everywhere (compose,
  Dockerfile, `.env.example`) so it always defaults to `0.1.0`.
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — **are** in
  `.env.example`; they are consumed by the postgres container (not Node) and are
  *not* in the Zod schema. Listed here only to note that split.

**Compose env-block coverage:** every audio var in `.env.example` is now wired
through both `docker-compose.yml` and `docker-compose.prod.yml`, including
`MAX_PLAYLIST_ITEMS` (`${MAX_PLAYLIST_ITEMS:-100}`, added 2026-06-27 — it was
previously missing, so a `.env` value did not reach the container). Setting any of
these in `.env` and recreating the affected service (`docker compose up -d bot`)
now takes effect.

**No vars in `.env.example` are entirely unread** — every other entry maps to a
known consumer above.

---

## Secrets

Treat the following as secrets — never commit, never paste in chat, rotate on
leak. Config-validation error messages deliberately print **names only**, never
values (`packages/config/src/index.ts`).

- `DISCORD_TOKEN` — bot token. If leaked, **Reset Token** in the Developer
  Portal; the old one stops working.
- `SESSION_SECRET` — admin session cookie encryption (≥32 chars).
- `INTERNAL_API_TOKEN` — admin↔bot shared secret (≥8 chars).
- `POSTGRES_PASSWORD` / the password embedded in `DATABASE_URL` (and
  `TEST_DATABASE_URL`).
- `ADMIN_PASSWORD` / `E2E_ADMIN_PASSWORD` — bootstrap credentials.
- `YTDLP_COOKIES_FILE` — points at your **personal** YouTube cookies; the file
  itself is sensitive (account access). Keep it out of git (`./secrets/`).

Generate a strong `SESSION_SECRET` inside Docker:

```bash
docker compose exec app node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the same approach for `INTERNAL_API_TOKEN` (any long random string ≥8 chars).

---

## Discord Developer-Portal setup

Placeholders below — substitute your own values, never commit real ones:
`<DISCORD_BOT_TOKEN>`, `<DISCORD_CLIENT_ID>`, `<DISCORD_GUILD_ID>`.

### Getting the three values

1. <https://discord.com/developers/applications> → **New Application**.
2. **General Information** → **Application ID** ⇒ `DISCORD_CLIENT_ID`
   (`<DISCORD_CLIENT_ID>`).
3. **Bot** → **Reset Token** → copy once ⇒ `DISCORD_TOKEN`
   (`<DISCORD_BOT_TOKEN>`). A real token is long with two dots
   (`MTE4…xxxx.Gh7aBc.yyyy…`); the *public key* / *client secret* are different
   values and won't work.
4. Discord client → **User Settings → Advanced → Developer Mode: ON**, then
   right-click your server → **Copy Server ID** ⇒ `DISCORD_GUILD_ID`
   (`<DISCORD_GUILD_ID>`). Setting it makes command registration **instant**;
   leaving it empty registers commands **globally** (up to ~1h to appear).

### The two privileged intents ↔ `.env` flags

The **portal toggle** and the **`.env` flag** must agree. Setting a flag `true`
without enabling the matching portal intent makes Discord reject the gateway
connection with **close code 4014 "Disallowed intents"** and the bot won't log
in (verified in code, `adapter.ts:64-84`).

| Portal toggle ("Privileged Gateway Intents") | `.env` flag | Adds gateway intent | Enables |
|---|---|---|---|
| **Server Members Intent** | `DISCORD_ENABLE_GUILD_MEMBERS=true` | `GuildMembers` | Welcome/Leave + Birthdays-on-join (member events). `packages/welcome-module/src/index.ts` declares `requiredIntents: ['GuildMembers']`. With it off, `member.join`/`member.leave` never fire. |
| **Message Content Intent** | `DISCORD_ENABLE_MESSAGE_CONTENT=true` | `MessageContent` | Content-based automod rules only (banned words, links, caps, mention/invite). With it off, `message.create.content` is empty and automod content rules run **DEGRADED**. |

The **audio bot needs neither** — leave both off and it connects with only the
non-privileged base intents.

### Bot permissions & invite-URL derivation

The bot's OAuth2 scopes are `bot` + `applications.commands`. Permissions are a
bitfield. The audio-minimum permission integer is **`3147776`**
(documented-elsewhere: `docs/DISCORD_SETUP.md`): View Channels + Send Messages +
Connect + Speak.

Invite-URL template (substitute `<DISCORD_CLIENT_ID>`):

```
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=3147776
```

Community modules need more permissions (Manage Roles for welcome/role-menus/
birthday roles, Manage Messages/Moderate Members for automod & moderation,
Attach Files for cards). Build a larger permission integer via the portal's
**OAuth2 → URL Generator**, or add the bits to the integer above. For role
management, the bot's own role must sit **above** the roles it manages
(documented-elsewhere-unverified: `docs/PERMISSIONS.md`).

---

## Minimal `.env` recipes

All three rely on Compose dev defaults for anything omitted; the values shown are
the ones you'd realistically set. Copy `.env.example` to `.env` first.

### A. No-Discord dev (admin panel + tests only)

Leave Discord empty; the platform runs, admin panel works, health checks pass.

```env
NODE_ENV=development
DATABASE_URL=postgres://botplatform:change_me_dev_password@db:5432/botplatform
SESSION_SECRET=<32+ random chars from the crypto one-liner above>
INTERNAL_API_TOKEN=<long random string>
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<choose one>
```

### B. Audio / music bot (NO privileged intents)

Add the three Discord values; keep both privileged flags `false`.

```env
NODE_ENV=development
DATABASE_URL=postgres://botplatform:change_me_dev_password@db:5432/botplatform
SESSION_SECRET=<32+ random chars>
INTERNAL_API_TOKEN=<long random string>
DISCORD_TOKEN=<DISCORD_BOT_TOKEN>
DISCORD_CLIENT_ID=<DISCORD_CLIENT_ID>
DISCORD_GUILD_ID=<DISCORD_GUILD_ID>
DISCORD_ENABLE_GUILD_MEMBERS=false
DISCORD_ENABLE_MESSAGE_CONTENT=false
AUDIO_ENABLE_STREAMING_SOURCES=true
MAX_QUEUE_SIZE=50
MAX_PLAYLIST_ITEMS=100
MAX_TRACK_DURATION_SECONDS=3600
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<choose one>
```

> For private/age-restricted YouTube only: export cookies to
> `./secrets/youtube-cookies.txt` and set
> `YTDLP_COOKIES_FILE=/workspace/secrets/youtube-cookies.txt`.

### C. Full community bot (both privileged intents ON)

Enable **both** portal toggles first, then:

```env
NODE_ENV=development
DATABASE_URL=postgres://botplatform:change_me_dev_password@db:5432/botplatform
SESSION_SECRET=<32+ random chars>
INTERNAL_API_TOKEN=<long random string>
DISCORD_TOKEN=<DISCORD_BOT_TOKEN>
DISCORD_CLIENT_ID=<DISCORD_CLIENT_ID>
DISCORD_GUILD_ID=<DISCORD_GUILD_ID>
DISCORD_ENABLE_GUILD_MEMBERS=true
DISCORD_ENABLE_MESSAGE_CONTENT=true
ALLOWED_AUDIO_DOMAINS=youtube.com,youtu.be,soundcloud.com,open.spotify.com
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<choose one>
```

After enabling `GuildMembers`, restart the bot: `docker compose restart bot`.

---

## First-run command sequence (Docker)

```bash
cp .env.example .env          # then edit secrets
docker compose up -d --build
docker compose exec app pnpm install
docker compose exec app pnpm db:migrate
docker compose exec app pnpm db:seed
# admin panel → http://localhost:3000
```

Register slash commands once Discord is configured:

```bash
docker compose exec app pnpm discord:register-commands
```
