# Security

What the platform defends against and how, plus the production hardening
checklist.

## Secret handling

- **No secrets in the repository.** `.env` is gitignored; `.env.example`
  documents every variable with placeholders. CI runs **gitleaks** over the
  full history and fails on findings.
- **No secrets in the UI.** The admin settings page renders an explicit
  allowlist of safe values; discord/client credentials appear only as
  "configured: yes/no". Both the integration and e2e suites assert that
  `SESSION_SECRET`, `INTERNAL_API_TOKEN` and passwords appear in no page.
- **No secrets in logs.** The pino factory redacts token/password/secret/
  authorization/cookie fields at any depth; audit metadata keys matching
  `/token|password|secret/i` are stored as `[REDACTED]`; the Discord adapter
  never logs the token (and discord.js errors don't contain it).
- Production compose uses `${VAR:?…}` required-variable syntax — missing
  secrets abort startup loudly instead of falling back to weak defaults.

## Admin authentication

- **argon2id** password hashing (library defaults, OWASP-recommended).
- **Encrypted stateless session cookies** (`@fastify/secure-session`:
  libsodium secretbox keyed from `SESSION_SECRET` + fixed salt) —
  `httpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`.
- **Login rate limiting** (20/min/IP) and uniform "Invalid email or
  password." responses — no user-enumeration hints; failures are audited
  with the attempted email as actor id.
- **CSRF protection** on every mutating route: per-session secret, token in
  every form, POSTs without a valid token get a friendly 403.
- **Role foundation**: owner/admin mutate, viewer is read-only (403 on
  mutating routes).
- Seed refuses admin passwords shorter than 8 characters.

## SSRF protection (user-supplied audio URLs)

Defense in depth in `packages/security`:

1. **Validation** (`validateExternalUrl`): http/https only (rejects file:,
   data:, javascript:, plain paths), no embedded credentials, ≤2048 chars,
   hostname denylist (`localhost`, `*.localhost`, `*.local`, `*.internal`),
   IP-literal range classification via ipaddr.js (loopback, RFC1918,
   link-local — incl. the 169.254.169.254 cloud-metadata endpoint —
   carrier-grade NAT, unspecified, broadcast, reserved, IPv6 equivalents and
   IPv4-mapped forms all blocked), **DNS resolution check**: every A/AAAA
   answer must be public.
2. **Connection-time guard** (`openSafeHttpStream`): the undici Agent uses a
   custom lookup that re-checks every resolved address **at connect time** —
   a DNS answer that changes between validation and connection (DNS
   rebinding) still cannot reach a private address.
3. **Manual redirect handling**: redirects are never followed implicitly;
   each hop (max 5) goes back through full validation.
4. **Optional domain allowlist** (`ALLOWED_AUDIO_DOMAINS`, also per guild in
   the DB): exact domain or subdomain match only — `evil-example.com` does
   not match `example.com`.
5. Request timeouts (headers + body idle), content-type gate (rejects
   text/html etc.), bounded queue (`MAX_QUEUE_SIZE`) and a max-duration
   playback timer cap resource use.

## Known residual risks

- **yt-dlp network egress is not covered by the SSRF guard.** Direct-HTTP
  audio and avatar/background fetches go through `openSafeHttpStream`
  (connection-time DNS-pinning, per-hop redirect re-validation). The
  YouTube/SoundCloud/Spotify providers, however, hand the URL to the bundled
  `yt-dlp` binary, which does its own DNS resolution and redirect-following
  outside Node. The **entry host is constrained** to those known public
  platforms (`canResolve`), so an attacker cannot point the provider at an
  arbitrary host — but yt-dlp's sub-resource fetches are not IP-pinned. For
  hardening in hostile multi-tenant environments, restrict the bot
  container's egress at the network layer (firewall/proxy). Disable streaming
  entirely with `AUDIO_ENABLE_STREAMING_SOURCES=false`.
- **In-memory dedup/rate state assumes a single bot instance.** Welcome-join
  dedup and the automod spam window live in process memory. Birthday and
  announcement delivery dedup are DB-backed (durable). Running multiple bot
  instances/shards for the same guild is not supported in v1 (see
  docs/ASSUMPTIONS.md) — run a single bot worker.

## Error exposure

`UserFacingError.safeMessage` is the **only** error text allowed to reach
Discord replies or the admin UI; everything else becomes a generic message at
the dispatcher / Fastify error-handler boundary while the real error goes to
the logs. The e2e suite asserts no stack frames or error class names render.

## Audit logging

Append-only `audit_logs` table records: admin login/logout/failed login,
module enable/disable, guild settings changes, audio admin actions
(skip/stop/clear), moderation rule toggles, command executions and command
errors (safe message only), bot startup/shutdown, Discord connect errors.
Writes go through a port that **never throws** — auditing can't break
features — and metadata is sanitized.

## Internal API

The bot's control API (port 8081) is **not published to the host** — it
exists only on the Docker network — and every `/internal/*` route requires
the `INTERNAL_API_TOKEN` header, compared in **constant time**
(sha256 + `timingSafeEqual`).

## Docker hardening

- Production runtime images: `node:24-bookworm-slim`, run as the unprivileged
  **`node` user**, contain only dist + prod node_modules + ffmpeg/curl
  (no compilers, no pnpm), `init: true` for signal handling.
- PostgreSQL is never exposed to the host or the internet in either compose
  file.
- Dev conveniences (root user, weak default env values) exist **only** in
  `docker-compose.yml`; the prod file has none.

## Production checklist

- [ ] Fresh random `SESSION_SECRET` (≥32 chars) and `INTERNAL_API_TOKEN`
- [ ] Strong `POSTGRES_PASSWORD`; `DATABASE_URL` matches
- [ ] Strong `ADMIN_PASSWORD`; consider rotating after first login
- [ ] `COOKIE_SECURE=true` + TLS reverse proxy (Caddy/Traefik) in front of the panel; set `PUBLIC_ADMIN_URL` to the https URL
- [ ] Discord token freshly reset (never one that was pasted into chats/issues)
- [ ] Consider `ALLOWED_AUDIO_DOMAINS` to restrict playable sources
- [ ] Off-host database backups scheduled (see DOCKER_DEPLOYMENT.md)
- [ ] OS/Docker auto-updates on the host; firewall exposes only 80/443 (proxy)
- [ ] Branch protection + CI required checks on GitHub (see GITHUB_DEPLOYMENT.md)

## Reporting

This is a self-hosted project; if you find a vulnerability, open a private
GitHub security advisory on your repository rather than a public issue.
