# Troubleshooting

> **Moved.** The authoritative, code-verified troubleshooting guide is now
> **[docs/technical/troubleshooting.md](technical/troubleshooting.md)**. Use it
> for Docker engine/build, `pnpm install`, Discord token & intents, database,
> ports, audio, e2e, line endings/CRLF, health checks, and module state — it is
> kept in sync with the code (verified 2026-06-27).
>
> Only the Windows/WSL2 host notes that the authoritative guide does **not**
> cover are retained below, as a quick reference. (Diagnosing a bad Discord
> token in particular has moved: the bot container stays **healthy by design**
> on a bad token, so check `checks.discord.detail` from `/healthz`, the admin
> dashboard, or the bot logs — *not* `docker compose ps`. See
> [technical/troubleshooting.md §0/§4](technical/troubleshooting.md).)

## Docker on Windows

**WSL2 backend issues**
- Settings → General → "Use the WSL 2 based engine" should be ON.
- `wsl --update` then restart Docker Desktop fixes most "engine won't start"
  states; `wsl --shutdown` (then reopen Docker Desktop) is the bigger hammer.
- Out-of-memory during builds → create `%UserProfile%\.wslconfig` with
  `[wsl2]\nmemory=6GB` and restart WSL.

**Slow bind mounts / slow installs**
- Source lives on the Windows filesystem → file I/O crosses a VM boundary.
  We already keep `node_modules` and the pnpm store in named Linux volumes
  (the slow part). If the repo itself feels slow, clone it inside the WSL
  filesystem (`\\wsl$\...`) and run compose from there.

**File changes not picked up by the watchers**
- Known Windows limitation: inotify events don't always cross the bind
  mount. Cheap fix: `docker compose restart bot admin`.

---

_Everything else — including Docker Desktop not running, port conflicts, and
line-ending/CRLF issues — is covered in
**[docs/technical/troubleshooting.md](technical/troubleshooting.md)**._
