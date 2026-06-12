# Bot Platform

A **modular, self-hosted bot platform**. The first integration is a **Discord audio
player bot** with a browser-based, login-protected **admin panel** — but the
architecture is platform-agnostic: channel adapters (Discord today; Slack,
Telegram, … tomorrow) plug into a bot core, and features ship as modules
(audio playback today; moderation, automod, scheduled announcements next).

**Docker-first:** the only things installed on your machine are **Docker
Desktop, Git, a code editor and a browser**. Node.js, pnpm, ffmpeg, PostgreSQL
and the Playwright browsers all live inside Linux containers.

## Current features

- 🎵 **Audio player module** — `/join`, `/leave`, `/play url:<link>`, `/queue`,
  `/skip`, `/pause`, `/resume`, `/stop`, `/nowplaying` with a bounded queue,
  graceful error handling and SSRF-hardened link validation
- 🛡️ **Moderation foundation** — warnings, action records, configurable rules
  and role→permission mappings persisted and visible in the admin panel
  (slash commands arrive per the [roadmap](docs/MODERATION_ROADMAP.md))
- 🖥️ **Admin panel** (http://localhost:3000) — dashboard, module toggles, live
  audio sessions with skip/stop/clear actions, guild settings, audit logs,
  system settings; argon2 passwords, encrypted session cookies, CSRF
  protection, login rate limiting
- 🗄️ **PostgreSQL persistence** — modules, guild settings, playback history,
  queue mirror, moderation records, audit logs; SQL migrations via Drizzle
- 🔍 **Health endpoints** for every service + Docker healthchecks
- ✅ **Three test layers** — 182 unit, 37 integration, 22 Playwright e2e —
  plus a GitHub Actions pipeline that runs the identical Docker workflow

## Quick start (Windows, macOS or Linux — only Docker required)

```bash
git clone <your-repo-url> bot-platform
cd bot-platform
cp .env.example .env          # then edit .env (see below)

docker compose up -d --build  # db + dev containers
docker compose exec app pnpm install
docker compose exec app pnpm db:migrate
docker compose exec app pnpm db:seed

# → open http://localhost:3000 and log in with ADMIN_EMAIL / ADMIN_PASSWORD
```

To connect Discord, fill `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` and
`DISCORD_GUILD_ID` in `.env` ([how to get them](docs/DISCORD_SETUP.md)), then:

```bash
docker compose restart bot
docker compose exec app pnpm discord:register-commands
```

Everything else you ever run goes through `docker compose exec app pnpm …` —
see [docs/DOCKER_DEVELOPMENT.md](docs/DOCKER_DEVELOPMENT.md) for the full
command reference and [docs/LOCAL_RUN.md](docs/LOCAL_RUN.md) for a guided
first run.

## Slash commands

| Command | Behavior |
|---------|----------|
| `/join` | Join your current voice channel |
| `/leave` | Leave the channel (stops playback safely) |
| `/play url:<link>` | Validate + resolve the link; play now or queue |
| `/queue` | Show now playing + upcoming tracks |
| `/skip` | Skip to the next track (stops cleanly when queue is empty) |
| `/pause` / `/resume` | Pause / resume with honest edge-case replies |
| `/stop` | Stop and clear the queue, stay connected |
| `/nowplaying` | Title, source, status, requester |

Supported links: direct HTTP(S) audio files (mp3/ogg/wav/m4a/…). Private and
internal addresses are blocked; an allowlist is available via
`ALLOWED_AUDIO_DOMAINS`. The provider layer is built for future sources.

## Architecture (short version)

```
apps/bot ──────► BotKernel (packages/core)
                  ├─ ChannelAdapter: packages/discord-adapter
                  ├─ Module: packages/audio-module  (resolver → queue → voice)
                  ├─ Module: packages/moderation-module (foundation)
                  └─ Ports → packages/database (Drizzle + PostgreSQL)
apps/admin ────► Fastify SSR panel ── internal HTTP API ──► apps/bot
packages/security ── SSRF-safe URL validation + streaming, argon2, tokens
```

Modules never see Discord types; adapters never contain feature logic.
Full tour: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
apps/bot              Discord worker + internal API + CLI entries
apps/admin            Admin panel (Fastify 5 + EJS, server-rendered)
packages/core         Kernel, module/adapter/voice contracts, error boundary
packages/discord-adapter
packages/audio-module
packages/moderation-module
packages/database     Drizzle schema, migrations, repositories, seed
packages/security     URL validation, SSRF-safe streaming, passwords
packages/{config,logger,shared}
tests/e2e             Playwright suite (runs inside the dev container)
docs/                 All documentation
```

## Environment variables

Copy `.env.example` → `.env`. Key variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL`, `POSTGRES_*` | PostgreSQL connection (host `db` in Docker) |
| `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_GUILD_ID` | Discord credentials — leave empty to run without Discord |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First admin user, created by `pnpm db:seed` |
| `SESSION_SECRET` | ≥32 random chars — encrypts admin session cookies |
| `INTERNAL_API_TOKEN` | Shared secret between admin panel and bot worker |
| `ADMIN_PORT`, `PUBLIC_ADMIN_URL`, `HEALTH_PORT` | Ports/URLs |
| `ALLOWED_AUDIO_DOMAINS`, `MAX_QUEUE_SIZE`, `MAX_TRACK_DURATION_SECONDS`, `AUDIO_REQUEST_TIMEOUT_MS` | Audio limits |

Never commit `.env` — it is gitignored; CI scans for leaked secrets.

## Testing

```bash
docker compose exec app pnpm test:unit
docker compose exec app pnpm test:integration   # real PostgreSQL test DB
docker compose exec app pnpm test:e2e           # Playwright vs http://admin:3000
docker compose exec app pnpm lint
docker compose exec app pnpm typecheck
```

Details: [docs/TESTING.md](docs/TESTING.md).

## Deployment

- **Local server / production-like:** `docker compose -f docker-compose.prod.yml up -d --build`
  (multi-stage images, one-shot migrate, opt-in seed) — [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md)
- **GitHub + CI/CD:** push to your repo; Actions runs the full Docker
  pipeline + prod image builds + secret scanning — [docs/GITHUB_DEPLOYMENT.md](docs/GITHUB_DEPLOYMENT.md)

## Security notes

No secrets in the repo or the UI; argon2id password hashing; encrypted
stateless sessions; CSRF tokens on every form; login rate limiting; URL
validation with private/internal IP blocking **and** connection-time DNS
pinning; audited admin actions. Full write-up: [docs/SECURITY.md](docs/SECURITY.md).

## Roadmap

Moderation commands (warn/mute/kick/ban/purge), automod rules, scheduled
announcements, more adapters (Slack/Telegram), per-guild audio overrides,
video playback. See [docs/MODERATION_ROADMAP.md](docs/MODERATION_ROADMAP.md)
and [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).

## Documentation index

| Doc | Contents |
|-----|----------|
| [LOCAL_RUN.md](docs/LOCAL_RUN.md) | Guided first run |
| [DOCKER_DEVELOPMENT.md](docs/DOCKER_DEVELOPMENT.md) | Day-to-day dev commands |
| [DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md) | Server deployment, backup/restore |
| [DISCORD_SETUP.md](docs/DISCORD_SETUP.md) | Bot creation, token, invite, IDs |
| [ADMIN_PANEL.md](docs/ADMIN_PANEL.md) | Panel guide |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design deep-dive |
| [TESTING.md](docs/TESTING.md) | Test layers + CI |
| [GITHUB_DEPLOYMENT.md](docs/GITHUB_DEPLOYMENT.md) | Repo + Actions setup |
| [SECURITY.md](docs/SECURITY.md) | Threat model + hardening |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Fixes incl. Windows specifics |
| [MODERATION_ROADMAP.md](docs/MODERATION_ROADMAP.md) | Future moderation design |
| [ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Autonomous decisions + how to change them |
