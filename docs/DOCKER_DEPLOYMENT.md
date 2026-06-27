# Docker Deployment — local server / production

The production setup is a **standalone compose file** (`docker-compose.prod.yml`)
with multi-stage images (`Dockerfile`): a builder compiles everything, the
runtime images contain only `dist/`, production `node_modules`, migrations,
ffmpeg and curl, and run as the unprivileged `node` user.

## Deploy on any Docker host

```bash
git clone <your-repo-url> bot-platform
cd bot-platform
cp .env.example .env
# EDIT .env with REAL values — prod refuses to start with missing secrets:
#   POSTGRES_PASSWORD, DATABASE_URL, SESSION_SECRET, INTERNAL_API_TOKEN
#   (+ DISCORD_*, ADMIN_EMAIL/ADMIN_PASSWORD for the seed)

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml --profile seed run --rm seed
```

Startup order is enforced: `db` (healthy) → `migrate` (one-shot Drizzle
migrations) → `bot` + `admin`. The panel listens on `ADMIN_PORT` (default
3000).

> **HTTPS note:** `COOKIE_SECURE` defaults to `true` in production — logins
> only work over HTTPS. Put a TLS-terminating reverse proxy (Caddy, Traefik,
> nginx) in front of `admin`, or set `COOKIE_SECURE=false` for a plain-HTTP
> trial on a trusted LAN.

## Operations

```bash
# Status / logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f bot admin

# Restart
docker compose -f docker-compose.prod.yml restart bot

# Update to a new version (migrations run automatically before bot/admin start)
git pull
docker compose -f docker-compose.prod.yml up -d --build

# Stop everything (data survives in the pgdata-prod volume)
docker compose -f docker-compose.prod.yml down
```

## Backup and restore

```bash
# Backup (run on the host; output lands in the current directory)
docker compose -f docker-compose.prod.yml exec db pg_dump -U botplatform botplatform > backup-$(date +%F).sql

# Restore into a fresh database
docker compose -f docker-compose.prod.yml exec -T db psql -U botplatform botplatform < backup-2026-06-13.sql
```

For scheduled backups, cron the `pg_dump` line on the server. The named
volume `botplatform-prod_pgdata-prod` holds all PostgreSQL data — include it
in filesystem-level backups only when the database is stopped; prefer
`pg_dump`.

## Environment configuration

Everything is configured via `.env` (or real environment variables — e.g.
from your server's secret manager). The prod compose uses
`${VAR:?error message}` syntax for secrets, so a missing value aborts startup
with a clear message instead of running with a weak default.

| Required in production | Notes |
|------------------------|-------|
| `POSTGRES_PASSWORD`, `DATABASE_URL` | keep them consistent |
| `SESSION_SECRET` | ≥32 random chars; rotating it logs every admin out |
| `INTERNAL_API_TOKEN` | long random string |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` | bot connectivity |
| `PUBLIC_ADMIN_URL` | the URL users reach the panel on |

## Updating containers / images

Images are built locally from the repo (`build:` + `image:` in the compose
file). `docker compose -f docker-compose.prod.yml up -d --build` rebuilds
what changed and restarts only affected services. To roll back: check out the
previous git tag/commit and run the same command.

## Reverse proxy / alternatives

A proxy is intentionally not bundled (see docs/ASSUMPTIONS.md). The simplest
production-grade addition is Caddy:

```yaml
# add to docker-compose.prod.yml services:
  caddy:
    image: caddy:2-alpine
    ports: ['80:80', '443:443']
    volumes: ['./Caddyfile:/etc/caddy/Caddyfile', 'caddy-data:/data']
```

```text
# Caddyfile
your-domain.example.com {
    reverse_proxy admin:3000
}
```

Tools like Portainer/Coolify/Dokploy work fine with this repo (it's plain
compose), but aren't required.

## Common issues

- `migrate` exits non-zero → `docker compose -f docker-compose.prod.yml logs migrate`;
  usually `DATABASE_URL` doesn't match `POSTGRES_*`.
- Panel unreachable → is `ADMIN_PORT` free on the host? `docker compose ps`
  healthy? See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
- Bot online but Discord features dead → likely an invalid `DISCORD_TOKEN`. A
  bad token does **not** make the bot container unhealthy (by design — it stays
  healthy so a token problem can't trigger a restart loop); the health endpoint
  reports the real adapter state in `checks.discord.detail`. Diagnose via that,
  the admin dashboard, or `docker compose logs bot` — not `docker compose ps`.
