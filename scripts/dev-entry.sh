#!/usr/bin/env bash
# Dev entrypoint for the `bot` and `admin` compose services.
#
# node_modules is a named Docker volume that starts EMPTY on first boot, and
# installs are deliberately manual (docker compose exec app pnpm install) so
# they never race each other. This script idles until the install has finished,
# then execs the app's tsx watcher.
#
# Must be LF-terminated (enforced by .gitattributes) — CRLF breaks bash.
set -euo pipefail

APP="${1:?usage: dev-entry.sh <bot|admin>}"

# pnpm writes node_modules/.modules.yaml as part of a completed install — its
# presence is the "dependencies are ready" signal.
until [ -f /workspace/node_modules/.modules.yaml ]; do
  echo "[dev-entry] waiting for dependencies — run: docker compose exec app pnpm install"
  sleep 5
done

echo "[dev-entry] dependencies present — starting @botplatform/${APP}"
exec pnpm --filter "@botplatform/${APP}" dev
