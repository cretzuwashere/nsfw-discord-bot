# Docker Development — command reference

Everything runs inside Linux containers. The host never needs Node, pnpm,
ffmpeg, psql or browsers. All commands below were validated on this project.

## The services (docker-compose.yml)

| Service | Role | Ports on host |
|---------|------|---------------|
| `db` | PostgreSQL 18 | none (intentionally) |
| `app` | long-lived **toolbox** — every `pnpm` command runs here | none |
| `bot` | Discord worker (`tsx watch`), internal API on 8081 | none |
| `admin` | admin panel (`tsx watch`) | **3000** |
| `e2e` | optional Playwright runner (profile `e2e`) | none |

## Lifecycle

```bash
docker compose build              # build the dev image
docker compose up -d              # start db + app + bot + admin
docker compose ps                 # status + health
docker compose logs -f            # all logs, follow
docker compose logs -f bot        # one service
docker compose restart bot admin  # pick up changes if the watcher missed them
docker compose down               # stop everything (volumes survive)
docker compose down -v            # ALSO wipe volumes (database reset!)
```

## Everyday commands (all inside the `app` container)

```bash
docker compose exec app pnpm install                    # install/update deps
docker compose exec app pnpm dev                        # run bot+admin in one container (stop the bot/admin services first)
docker compose exec app pnpm build                      # tsup build of both apps
docker compose exec app pnpm lint                       # eslint
docker compose exec app pnpm lint:fix
docker compose exec app pnpm typecheck                  # tsc --noEmit everywhere
docker compose exec app pnpm test                       # unit + integration
docker compose exec app pnpm test:unit
docker compose exec app pnpm test:integration           # uses botplatform_test DB
docker compose exec app pnpm test:e2e                   # Playwright vs admin service
docker compose exec app pnpm playwright test --ui       # (headed modes need extra X setup — usually not worth it; use traces)
docker compose exec app pnpm db:generate                # create migration from schema changes
docker compose exec app pnpm db:migrate
docker compose exec app pnpm db:seed
docker compose exec app pnpm discord:register-commands
docker compose exec app pnpm format                     # prettier --write
```

`pnpm setup` = `db:migrate` + `db:seed` in one go.

## Database access

```bash
docker compose exec db psql -U botplatform botplatform        # SQL shell
docker compose exec db pg_dump -U botplatform botplatform > backup.sql
```

## Playwright

The dev image is built **from the official Playwright image** — browsers and
system dependencies are preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`).
Never run `playwright install` and never install browsers on Windows.

Tests target `http://admin:3000` over the Docker network
(`PLAYWRIGHT_BASE_URL`). Run them either way:

```bash
docker compose exec app pnpm test:e2e          # inside the toolbox
docker compose --profile e2e run --rm e2e      # one-shot runner service
```

The HTML report lands in `tests/e2e/playwright-report/`; open it from Windows
in your browser.

## How dependencies work here

- `node_modules` is a **named Docker volume** (`botplatform_node_modules`),
  not part of the Windows bind mount — native speed, no symlink problems.
  Consequence: you won't see `node_modules` on the Windows filesystem; that's
  intentional. Your editor's TypeScript still works because it reads source
  files; for full editor IntelliSense use the **Dev Container** (below).
- pnpm uses `node-linker=hoisted` (one flat tree) and a persistent store
  volume, so re-installs are fast.
- `bot`/`admin` wait politely (via `scripts/dev-entry.sh`) until
  `pnpm install` has completed, then start automatically.

## VS Code Dev Container (optional)

`.devcontainer/devcontainer.json` attaches VS Code to the `app` service:
*Dev Containers: Reopen in Container*. You get a Linux workspace with
node_modules visible, ESLint/Prettier extensions preinstalled and a terminal
that already lives inside Docker. Plain `docker compose` keeps working
without it.

## Makefile (optional)

If you have `make` (Linux/macOS/WSL), `make help`-style wrappers exist for
every command above (`make up`, `make test`, `make e2e`, `make psql`,
`make backup` …). Each target is a thin `docker compose` call — Windows users
without make just use the commands in this document.
