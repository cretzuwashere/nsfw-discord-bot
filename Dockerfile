# syntax=docker/dockerfile:1
# =============================================================================
# Production image — multi-stage build producing two small runtime images:
#
#   docker build --target bot   -t botplatform-bot   .
#   docker build --target admin -t botplatform-admin .
#
# (normally driven by docker-compose.prod.yml, which sets the targets)
#
# Stages:
#   builder      full workspace install + `pnpm build` (tsup bundles each app
#                with the @botplatform/* workspace packages INLINED; only
#                external/native deps remain require()d at runtime)
#   proddeps     production-only node_modules, built from manifests alone so
#                the Docker layer cache survives source-code edits
#   runtime-base shared slim runtime (ffmpeg + curl)
#   bot / admin  final images
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — builder: compile TypeScript bundles
# -----------------------------------------------------------------------------
FROM node:24-bookworm AS builder

# python3/make/g++ are REQUIRED: @discordjs/opus compiles from source on glibc.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Pinned pnpm, matching "packageManager" in package.json. No corepack.
RUN npm install -g pnpm@10.34.3

WORKDIR /app

# .dockerignore already excludes node_modules, dist, .env — this copies source
# and manifests only.
COPY . .

# pnpm-lock.yaml is committed to the repository; --frozen-lockfile makes the
# build fail loudly if it is missing or out of sync instead of drifting.
RUN pnpm install --frozen-lockfile

# tsup bundles apps/bot and apps/admin into self-contained dist/ directories.
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 2 — proddeps: production-only hoisted node_modules
#
# Only manifests are copied, so this stage is cached until a package.json or
# the lockfile changes — editing source never re-runs the install.
# .npmrc sets node-linker=hoisted, so the result is ONE flat /app/node_modules
# containing every external production dependency (discord.js, fastify, pg,
# natively compiled @discordjs/opus + argon2, ...). The @botplatform/* entries
# are symlinks into empty package dirs — harmless, because tsup already inlined
# all workspace code into the app bundles.
# -----------------------------------------------------------------------------
FROM node:24-bookworm AS proddeps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.34.3

WORKDIR /app

COPY pnpm-workspace.yaml package.json .npmrc pnpm-lock.yaml ./
# Every workspace manifest, paths preserved (pnpm needs all of them to resolve
# the workspace graph declared in pnpm-workspace.yaml).
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/audio-module/package.json packages/audio-module/package.json
COPY packages/moderation-module/package.json packages/moderation-module/package.json
COPY packages/discord-adapter/package.json packages/discord-adapter/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY tests/e2e/package.json tests/e2e/package.json

RUN pnpm install --prod --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3 — runtime-base: shared slim runtime
# -----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime-base

# ffmpeg — audio transcoding; curl — container HEALTHCHECKs + yt-dlp fetch;
# ca-certificates — outbound HTTPS (Discord gateway, audio URLs);
# python3 — yt-dlp's runtime interpreter for the standalone binary's needs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp — YouTube/SoundCloud/Spotify playback. Standalone binary, pinned;
# bump YTDLP_VERSION to update.
ARG YTDLP_VERSION=2026.06.09
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version

ENV NODE_ENV=production
WORKDIR /app

# -----------------------------------------------------------------------------
# Stage 4 — bot: Discord worker (also carries migrate/seed entrypoints,
# reused by the one-shot `migrate` and `seed` services in compose.prod)
# -----------------------------------------------------------------------------
FROM runtime-base AS bot

COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=builder /app/apps/bot/dist ./dist
# Drizzle SQL migrations ship inside the image; dist/migrate.js finds them via
# MIGRATIONS_DIR (see packages/database/src/migrate.ts).
COPY --from=builder /app/packages/database/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations

USER node
EXPOSE 8081
# Shell form on purpose: ${HEALTH_PORT} expands at runtime inside the
# container, so the check follows the configured port (default 8081).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://localhost:${HEALTH_PORT:-8081}/healthz" || exit 1
CMD ["node", "dist/main.js"]

# -----------------------------------------------------------------------------
# Stage 5 — admin: server-rendered admin panel
# -----------------------------------------------------------------------------
FROM runtime-base AS admin

COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=builder /app/apps/admin/dist ./dist
# EJS templates and static assets are served from disk, not bundled.
COPY --from=builder /app/apps/admin/views ./views
COPY --from=builder /app/apps/admin/public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS "http://localhost:${ADMIN_PORT:-3000}/healthz" || exit 1
CMD ["node", "dist/main.js"]
