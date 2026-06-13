# Admin Panel

Server-rendered admin interface at **http://localhost:3000** (configurable
via `ADMIN_PORT` / `PUBLIC_ADMIN_URL`).

## Login & bootstrap

- The first admin user is created by the seed:
  `docker compose exec app pnpm db:seed` reads `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` from `.env` (idempotent — it never overwrites an existing
  user; passwords under 8 chars are refused).
- Passwords are hashed with **argon2id**. Sessions are **encrypted stateless
  cookies** (`@fastify/secure-session`, key derived from `SESSION_SECRET`),
  `httpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`.
- Login is **rate-limited** (20/min per IP) and every attempt — success or
  failure — is written to the audit log. Failed logins get a deliberately
  vague "Invalid email or password."
- **Roles:** `owner` and `admin` can change things; `viewer` (foundation for
  future use) is read-only — mutating routes return 403.

## Pages

The panel has a page per module. Community-module pages
(Announcements, Dynamic Cards, Welcome/Leave, Reaction Roles, Birthdays,
Reminders, Scheduled Messages, Auto-Moderation, Custom Commands) each provide
the create/edit/configure UI for that module — see the per-module docs linked
from [COMMUNITY_MODULES.md](COMMUNITY_MODULES.md). The core pages:

| Page | What it shows / does |
|------|----------------------|
| **Dashboard** | Bot worker status via its internal API (adapters with connection state + identity + server count, uptime, version, environment), database health, active modules, audio session count, 10 most recent audit entries. Shows an honest "unreachable" card when the bot container is down. |
| **Modules** | Every registered module with its enabled state. **Enable/Disable** buttons persist to the database; the bot picks changes up within ~10 s (cached module state). Toggles are audited. |
| **Audio Player** | Configured limits (queue size, max duration, allowed domains, timeout), live per-guild sessions (now playing, queue, status) with **Skip / Stop / Clear queue** actions proxied to the bot worker, recent playback errors and history from the database. |
| **Guild Settings** | Servers the bot has seen. Per-guild editor for allowed audio domains, max queue size and max track duration (blank = inherit the global env value). Stored now; engine applies overrides in a future iteration (see ASSUMPTIONS.md #10). |
| **Moderation** | Module status, recorded warnings, moderation actions and configurable rules with enable/disable toggles — the foundation described in MODERATION_ROADMAP.md. |
| **Audit Logs** | Filterable (substring match on the action key, e.g. `admin`), paginated table: time, actor, action, guild, target, metadata. |
| **System Settings** | Explicitly allow-listed safe configuration values, environment readiness checklist (database reachable, secrets configured, Discord configured — booleans only), deployment hints. |

## How the panel talks to the bot

The bot worker exposes an **internal HTTP API** (port `HEALTH_PORT`, default
8081) that is **not published to the host** — it exists only on the Docker
network. The panel authenticates to it with the `INTERNAL_API_TOKEN` shared
secret (constant-time compared). If the bot is down, the panel renders
honest offline states instead of errors.

## Security notes

- **Secrets are never rendered.** The settings page uses an explicit
  allowlist; the e2e suite literally asserts that `SESSION_SECRET`,
  `INTERNAL_API_TOKEN` and passwords appear on no page.
- **CSRF**: every form carries a token bound to the session; POSTs without it
  are rejected (403, friendly page).
- **No stack traces** ever reach the browser — the error handler logs the
  real error and renders a generic page.
- All meaningful actions are audited: login/logout/failed login, module
  toggles, guild settings changes, audio admin actions, moderation rule
  toggles, plus bot-side events (startup/shutdown, Discord connect errors,
  command executions).

See [SECURITY.md](SECURITY.md) for the full picture.
