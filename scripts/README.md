# scripts/

## dev-entry.sh

Entrypoint used by the `bot` and `admin` services in `docker-compose.yml`.

In development, `node_modules` lives in a shared named Docker volume that is
empty until you run the one manual install step:

```sh
docker compose exec app pnpm install
```

`dev-entry.sh <bot|admin>` polls for `node_modules/.modules.yaml` (written by a
completed pnpm install), printing a reminder every 5 seconds, then runs
`pnpm --filter @botplatform/<app> dev` (the tsx watcher). This means
`docker compose up -d` always succeeds immediately — services simply wait for
dependencies instead of crash-looping.

Notes:

- The script runs inside the Linux dev container only; never run it on the
  Windows host.
- It must keep LF line endings (`.gitattributes` enforces `*.sh text eol=lf`);
  CRLF endings break `bash` inside the container.
