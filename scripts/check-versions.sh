#!/usr/bin/env bash
# Temporary helper: print the latest published version of each catalog pin.
set -uo pipefail
packages=(
  eslint @eslint/js typescript-eslint vitest tsx tsup prettier zod undici
  pino pino-pretty argon2 drizzle-orm drizzle-kit pg fastify
  @fastify/secure-session @fastify/csrf-protection @fastify/rate-limit
  @fastify/view @fastify/static @fastify/sensible @fastify/formbody ejs
  discord.js @discordjs/voice @discordjs/opus prism-media ipaddr.js
  @types/node @types/pg @types/ejs typescript @playwright/test
)
for p in "${packages[@]}"; do
  v=$(npm view "$p" version 2>/dev/null || echo MISSING)
  echo "$p = $v"
done
