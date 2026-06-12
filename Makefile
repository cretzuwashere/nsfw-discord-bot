# =============================================================================
# make is OPTIONAL — every target shows the underlying docker compose command
# (recipes are not @-silenced, so make prints each command before running it).
# Windows users without make simply copy the commands.
#
#   make up install migrate seed     # first boot, end to end
#   make test                        # unit + integration inside the container
# =============================================================================

COMPOSE      := docker compose
COMPOSE_PROD := docker compose -f docker-compose.prod.yml

# Used by psql/backup/restore; override like: make psql POSTGRES_USER=other
POSTGRES_USER ?= botplatform
POSTGRES_DB   ?= botplatform

.PHONY: build up down logs ps install dev lint typecheck test test-unit \
        test-integration e2e migrate seed register-commands psql backup \
        restore prod-build prod-up prod-down

# --- lifecycle ---------------------------------------------------------------

build: ## Build the dev image
	$(COMPOSE) build

up: ## Start db + app + bot + admin (detached)
	$(COMPOSE) up -d

down: ## Stop everything (named volumes are kept)
	$(COMPOSE) down

logs: ## Follow logs of all services
	$(COMPOSE) logs -f --tail=200

ps: ## Show service status + health
	$(COMPOSE) ps

# --- inside the toolbox container (`app`) -------------------------------------

install: ## Install workspace dependencies into the node_modules volume
	$(COMPOSE) exec app pnpm install

dev: ## (Re)start the bot + admin tsx watchers
	$(COMPOSE) up -d bot admin

lint:
	$(COMPOSE) exec app pnpm lint

typecheck:
	$(COMPOSE) exec app pnpm typecheck

test: ## Unit + integration tests
	$(COMPOSE) exec app pnpm test

test-unit:
	$(COMPOSE) exec app pnpm test:unit

test-integration:
	$(COMPOSE) exec app pnpm test:integration

e2e: ## Playwright end-to-end tests (starts admin and waits until healthy)
	$(COMPOSE) --profile e2e run --rm e2e

migrate: ## Apply Drizzle migrations to the dev database
	$(COMPOSE) exec app pnpm db:migrate

seed: ## Create bootstrap admin user(s) (idempotent)
	$(COMPOSE) exec app pnpm db:seed

register-commands: ## Register Discord slash commands (needs DISCORD_* in .env)
	$(COMPOSE) exec app pnpm discord:register-commands

# --- database ------------------------------------------------------------------

psql: ## Interactive psql shell in the db container
	$(COMPOSE) exec db psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

backup: ## Dump the dev database to ./backup_<timestamp>.sql on the host
	$(COMPOSE) exec -T db pg_dump -U $(POSTGRES_USER) $(POSTGRES_DB) > backup_$(shell date +%Y%m%d_%H%M%S).sql

restore: ## Restore a dump: make restore FILE=backup_20260613_120000.sql
	@test -n "$(FILE)" || { echo "usage: make restore FILE=backup_....sql"; exit 1; }
	$(COMPOSE) exec -T db psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) < $(FILE)

# --- production (standalone compose file, real secrets required) ----------------

prod-build:
	$(COMPOSE_PROD) build

prod-up:
	$(COMPOSE_PROD) up -d

prod-down:
	$(COMPOSE_PROD) down
