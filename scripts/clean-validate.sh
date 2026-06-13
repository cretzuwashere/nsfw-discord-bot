#!/usr/bin/env bash
# Definitive clean-room validation: tear everything down (incl. volumes) and
# bring the whole platform up from scratch, running every gate. Run from the
# host (it drives docker compose). Mirrors the CI pipeline.
set -e
cd "$(dirname "$0")/.."

echo "=== 1/12 down -v (wipe volumes) ==="
docker compose down -v

echo "=== 2/12 build + up db + app ==="
docker compose up -d --build db app

echo "=== 3/12 install ==="
docker compose exec -T app pnpm install --frozen-lockfile

echo "=== 4/12 lint ==="
docker compose exec -T app pnpm lint

echo "=== 5/12 typecheck ==="
docker compose exec -T app pnpm typecheck

echo "=== 6/12 unit tests ==="
docker compose exec -T app pnpm test:unit

echo "=== 7/12 migrate ==="
docker compose exec -T app pnpm db:migrate

echo "=== 8/12 integration tests ==="
docker compose exec -T app pnpm test:integration

echo "=== 9/12 seed ==="
docker compose exec -T app pnpm db:seed

echo "=== 10/12 build ==="
docker compose exec -T app pnpm build

echo "=== 11/12 up bot + admin, wait for health ==="
docker compose up -d bot admin
docker compose exec -T app bash -c 'for i in $(seq 1 60); do curl -fsS http://admin:3000/healthz >/dev/null && break; sleep 2; done'

echo "=== 12/12 e2e tests ==="
docker compose exec -T app pnpm test:e2e

echo ""
echo "=== CLEAN VALIDATION PASSED ==="
