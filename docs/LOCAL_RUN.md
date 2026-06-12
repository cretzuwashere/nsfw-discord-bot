# Local Run — guided first start

You need exactly four things on your machine: **Docker Desktop, Git, an
editor, a browser**. Do **not** install Node.js, pnpm, PostgreSQL, ffmpeg or
Playwright on Windows — they all live inside the Linux containers.

## 1. Clone and configure

```bash
git clone <your-repo-url> bot-platform
cd bot-platform
cp .env.example .env
```

Edit `.env`:

- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your admin panel login (seeded in step 4)
- `SESSION_SECRET` — at least 32 random characters
- `INTERNAL_API_TOKEN` — another random string
- `POSTGRES_PASSWORD` + matching `DATABASE_URL` / `TEST_DATABASE_URL`
- Discord values can stay empty for now — everything except the Discord
  connection works without them.

Generate random secrets inside Docker (no Node needed on the host):

```bash
docker compose run --rm app node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 2. Build and start the stack

```bash
docker compose up -d --build
docker compose ps
```

Four services start: `db` (PostgreSQL), `app` (your command toolbox), `bot`
and `admin`. `bot`/`admin` print a polite *waiting for dependencies* line
until step 3 — that's expected.

## 3. Install dependencies (inside the container)

```bash
docker compose exec app pnpm install
```

The first install compiles the Discord opus encoder from source — give it a
couple of minutes. `bot` and `admin` start their dev watchers automatically
once it finishes.

## 4. Migrate and seed the database

```bash
docker compose exec app pnpm db:migrate
docker compose exec app pnpm db:seed
```

The seed is idempotent: it registers the built-in modules and creates the
admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (and the Playwright test user
from `E2E_ADMIN_*`) only if they don't exist yet.

## 5. Open the admin panel

Browse to **http://localhost:3000** and log in with your `ADMIN_EMAIL` /
`ADMIN_PASSWORD`. You should see the dashboard with database **OK** and the
Discord adapter shown as `disabled` (no token yet) — that's the honest state.

## 6. Connect Discord (optional, any time)

Follow [DISCORD_SETUP.md](DISCORD_SETUP.md) to create the application, then
fill `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` in `.env` and:

```bash
docker compose restart bot
docker compose exec app pnpm discord:register-commands
```

In Discord, join a voice channel and try `/join`, then
`/play url:<direct link to an .mp3/.ogg file>`.

## 7. Run the checks (optional but recommended)

```bash
docker compose exec app pnpm lint
docker compose exec app pnpm typecheck
docker compose exec app pnpm test:unit
docker compose exec app pnpm test:integration
docker compose exec app pnpm test:e2e
```

## Daily workflow

Edit files on Windows in your editor; the `bot`/`admin` watchers inside the
containers restart automatically (if a change doesn't get picked up — a known
Windows bind-mount limitation — run `docker compose restart bot admin`).

Useful commands live in [DOCKER_DEVELOPMENT.md](DOCKER_DEVELOPMENT.md);
problems are covered in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
