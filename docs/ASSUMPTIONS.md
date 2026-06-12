# Assumptions

Decisions made autonomously during the initial build, why, and how to change them later.
(Each was made because the brief allows reasonable technical assumptions instead of blocking.)

## Stack and architecture

| # | Assumption | Why | How to change |
|---|-----------|-----|---------------|
| 1 | **Server-rendered admin panel** (Fastify 5 + EJS) instead of a React/Next.js SPA. | Fastest maintainable approach from the allowed options: one container, no frontend build pipeline, trivially testable with Playwright, no CDN dependencies. The HTTP API layer is cleanly separated in route handlers, so a SPA can be added later without rewriting business logic. | Add a separate frontend app under `apps/` and reuse the same Fastify routes as a JSON API. |
| 2 | **Drizzle ORM** (0.45.x) + `drizzle-kit` migrations instead of Prisma. | Lighter inside Docker (no codegen engines), TypeScript-first, SQL-transparent migrations committed to the repo. Drizzle 1.0 was still RC at build time — pinned to the stable 0.45 line. | Migrations are plain SQL in `packages/database/migrations`; another ORM could be adopted per-repository behind the repo factories. |
| 3 | **No Redis.** Queue/playback state is in-memory in the bot worker with a best-effort PostgreSQL mirror (`queue_items`, `playback_history`). The admin panel reads live state over the bot's internal HTTP API. | A second stateful service wasn't justified for v1: playback state is inherently volatile and single-process. The job/queue layer boundary exists in the architecture for when Redis becomes useful (scheduled announcements, automod counters). | Add a `redis` service to compose and introduce a queue adapter in the job layer. |
| 4 | **Node 24 (Active LTS)** in all containers; `engines.node >= 22.12` (the hard floor required by `@discordjs/voice` 0.19). | Node 24 is Active LTS as of June 2026; the Playwright dev image ships Node 24 too, so dev/prod match. | Change base images in `Dockerfile` / `Dockerfile.dev` and the `engines` field. |
| 5 | **pnpm 10 with `node-linker=hoisted`** (flat `node_modules`). | A single root `node_modules` needs exactly ONE Docker named volume, avoiding pnpm-symlink problems on Windows bind mounts. Trade-off: less strict dependency isolation — acceptable for a private monorepo. | Remove `node-linker=hoisted` from `.npmrc` and add per-package `node_modules` volumes to `docker-compose.yml`. |
| 6 | **TypeScript 5.9** (not the 6.0 line) and **stateless encrypted session cookies** (`@fastify/secure-session`) instead of a DB session store. | TS 5.9 is the conservative last-5.x line with guaranteed ecosystem compat; sessions-in-cookie removes a whole table + cleanup job, and logout/rotation needs are modest for an admin panel. | Swap to `@fastify/session` with a Postgres store if server-side revocation becomes a requirement. |
| 7 | **No sodium/libsodium packages for Discord voice.** | On Node ≥ 22.12, `@discordjs/voice` 0.19 uses the native `aes-256-gcm` cipher (`aead_aes256_gcm_rtpsize`); DAVE E2EE arrives automatically via its `@snazzah/davey` dependency. | n/a — only relevant if downgrading Node below 22.12 (don't). |

## Audio

| # | Assumption | Why | How to change |
|---|-----------|-----|---------------|
| 8 | **First audio provider = direct HTTP(S) audio links** (mp3/ogg/wav/m4a/…), streamed and transcoded by ffmpeg inside the bot container. No YouTube/streaming-platform extraction in v1. | Platform extraction (yt-dlp etc.) is a heavy, legally grey, fast-rotting dependency. The provider/resolver layer (`AudioProvider`) is designed so such a provider can be added without touching command handlers. | Implement a new `AudioProvider` in `packages/audio-module/src/resolver/providers/` and register it ahead of the direct-HTTP catch-all. |
| 9 | **Max track duration enforced by a playback timer** (skip when exceeded) rather than by probing metadata. | Arbitrary HTTP streams often have no trustworthy duration metadata; a hard timer is provider-agnostic and cannot be spoofed. | Add ffprobe-based duration extraction in the resolver and reject before queueing. |
| 10 | **Guild-specific audio settings exist in the DB** (`guild_settings`) and are editable in the admin panel, but the bot applies the **global env config** in v1; per-guild overrides are wired in a later iteration. | Keeps the v1 playback engine simple; the data model and admin UI are already in place. | Read `guild_settings` in the audio module's session factory and merge over `config.audio`. |

## Operations

| # | Assumption | Why | How to change |
|---|-----------|-----|---------------|
| 11 | **`docker-compose.yml` is the dev environment** (bind mount + tsx watch); production uses the separate standalone `docker-compose.prod.yml` with multi-stage images. | "Clone → `docker compose up -d`" must be the dev experience per the Docker-first requirement. | Use `docker compose -f docker-compose.prod.yml ...` for server deployment (see docs/DOCKER_DEPLOYMENT.md). |
| 12 | **No reverse proxy in v1.** The admin panel publishes one port (default 3000); `COOKIE_SECURE=true` + a TLS-terminating proxy (Caddy/Traefik) are documented as the production hardening path, not shipped. | Avoids overcomplicating the default deployment; nothing in the app assumes a proxy is absent (`trustProxy` is enabled). | Add a `caddy` service in `docker-compose.prod.yml` and point it at `admin:3000`. |
| 13 | **Admin bootstrap via `ADMIN_EMAIL` + `ADMIN_PASSWORD` env consumed by `pnpm db:seed`** (idempotent; also seeds an isolated E2E test user when `E2E_ADMIN_*` are set). | Simple, non-interactive, container-friendly; the seed refuses passwords shorter than 8 chars. | Replace with an invite/first-run flow in the admin panel. |
| 14 | **Git identity** in this repo is set locally to `Bot Platform Dev <dev@botplatform.local>` because no global git identity existed on the machine. | Commits needed an identity; didn't want to touch global config. | `git config user.name "You"; git config user.email "you@example.com"` |
| 15 | **CI mirrors local exactly**: GitHub Actions drives the same Docker Compose workflow instead of installing Node on the runner. | One source of truth for the pipeline; if CI passes, the local Docker workflow works, and vice versa. | Add a faster non-Docker job later if CI minutes become a concern. |
| 16 | **Module defaults**: `audio-player` seeds enabled, `moderation` seeds disabled (it's a foundation without commands). | Sensible first-run behavior. | Toggle in the admin panel (persisted in the `modules` table). |
