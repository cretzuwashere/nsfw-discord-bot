# Documentation Review — `docs/technical/*` (tech-docs orchestration)

Role: Documentation Reviewer, acting as a zero-context new agent operating the
project purely from the docs. Reviewed `docs/technical/` against the real repo on
2026-06-27. Repo root: `C:/Projects/Mods/Fable - Mod`. The host has no
Node/pnpm/ffmpeg/psql/Playwright; everything runs in Docker (`docker compose exec
app pnpm ...`).

## Files reviewed (read in full)

- `docs/technical/agent-handoff.md`
- `docs/technical/README.md`
- `docs/technical/architecture.md`
- `docs/technical/modules.md`
- `docs/technical/commands-and-events.md`
- `docs/technical/discord-bot-flows.md`
- `docs/technical/environment.md`
- `docs/technical/runtime-and-docker.md`
- `docs/technical/testing.md`
- `docs/technical/troubleshooting.md`
- `AGENTS.md` (repo root)

## Ground truth cross-checked against code

- `packages/shared/src/types.ts` — `MODULE_KEYS` = **exactly 20 keys** ✓ (matches
  docs).
- `apps/bot/src/main.ts` — all **20 modules** wired into `BotKernel({ modules })`;
  scheduler jobs registered at lines 204–212 (announcements 204, scheduled-messages
  205, reminders 206, birthdays 207, engagement-prompts 208, giveaways 209,
  server-stats loop 210, trivia loop 211, minigames 212) ✓.
- `apps/bot/src/register-commands.ts` — spreads commands for the **16
  command-owning modules** ✓ (the 4 command-less ones correctly absent).
- `packages/database/migrations/*.sql` — **10 migrations**, `0000_romantic_moonstone`
  .. `0009_legal_cammi` ✓.
- `packages/core/src/contracts/events.ts` — **5 platform events** incl.
  `voice.state.update` (non-privileged `GuildVoiceStates`) ✓.
- `packages/discord-adapter/src/adapter.ts` — base intents Guilds /
  GuildVoiceStates / GuildMessages / GuildModeration (lines 73–78), opt-in
  GuildMembers (80) / MessageContent (83) ✓.
- `packages/database/src/seed.ts` — 20 module rows; only `audio-player` (line 29)
  and `announcements` (line 35) are `defaultEnabled: true` ✓.
- `Dockerfile` proddeps stage (lines 70–90) — lists 6 infra + discord-adapter +
  **11 module manifests**; the **9 newest module manifests ARE missing**
  (raise-hand, fun-commands, engagement-prompts, giveaways, server-stats, trivia,
  minigames, economy, levels). Docs (runtime-and-docker §9.1, AGENTS GR8) are
  **correct** about this gap ✓ — no fix needed in docs.
- `apps/admin/src/routes/index.ts` — 8 module route plugins + `commands` +
  `placeholders` ✓.
- `apps/admin/src/routes/placeholders.ts` — `PLACEHOLDER_PAGES` = `/reminders`,
  `/permissions` ✓.
- `apps/admin/src/server.ts` — `/audio` inline at **line 282**, `/moderation`
  inline at **line 386** ✓ (key finding; see fixes).
- `apps/admin/views/*.ejs` — `audio.ejs` + `moderation.ejs` exist; NO `.ejs` for
  any of the 9 newest modules ✓.
- `apps/admin/src/command-catalog.ts` — **11 keys** ✓.
- `.env.example` — `UPLOADS_DIR` / `TEST_DATABASE_URL` / `MIGRATIONS_DIR` /
  `BUILD_VERSION` absent; `MAX_PLAYLIST_ITEMS` present. environment.md is correct ✓.

## Issues found

1. **STALE "11 modules" / "14 gates" header** in `agent-handoff.md` (5 spots) and
   `README.md` (header + "unit 332"). AGENTS.md §5 explicitly flags both as stale.
2. **Cross-doc contradiction on admin-page coverage.** `modules.md`,
   `commands-and-events.md` §6/§6.1, `discord-bot-flows.md` §9 and
   `troubleshooting.md` §13 stated `audio-player` and `moderation` have **no admin
   page** / are "configured only via Discord". This is **factually wrong**: both
   have real inline pages (`server.ts:282` `/audio`, `server.ts:386` `/moderation`,
   with `audio.ejs` + `moderation.ejs`). `architecture.md` §7.2 had it right ("11
   have a page"). The other docs used a "routes/-plugin-only" definition and then
   wrongly generalised it to "no admin page".
3. **Wrong `reminders` claim** in `modules.md`: "not covered by the placeholder
   plugin" — but `placeholders.ts:9` has `/reminders`. Other docs correctly call it
   the placeholder page.
4. **Mislabelled matrix cells** in `commands-and-events.md` §6: audio-player and
   moderation marked `none/placeholder` (neither is in `placeholders.ts`); raise-hand
   marked `none/placeholder (GAP)` (raise-hand is `none`, not in placeholders).

## Exact fixes applied (one line each)

- README.md: header "all 14 validation gates ... unit 332" → "all validation gates ... unit 471"; pointer to AGENTS.md §7 / modules.md instead of agent-report.
- README.md: "plus 11 community modules (...)" → "a large set of community modules (20 modules total, ...)" with pointer to modules.md.
- agent-handoff.md: intro "all 14 validation gates" + "11 community modules" → "all validation gates" + "20 community modules" with authoritative-status pointer.
- agent-handoff.md: "runs all 14 checks" → "runs every check".
- agent-handoff.md: file-map "wires the 11 modules" → "wires all 20 modules".
- agent-handoff.md: mental-model "runs 11 feature modules" → "runs all 20 feature modules".
- modules.md: header scope note rewritten — 8 routes/ plugins + 2 inline pages (audio/moderation) = 10 real admin pages; 10 with none; reconciled to architecture.md §7.2.
- modules.md: summary table — audio-player admin cell → "yes — inline `/audio` in server.ts"; moderation cell → "yes — inline `/moderation` in server.ts".
- modules.md: "Totals" block "12 of 20 modules have no admin page" → "10 of 20 ... no real admin page" + names the 10 real pages.
- modules.md: audio-player section "Admin route: none ..." → "has an admin page (inline server.ts:282) ...".
- modules.md: moderation section "Admin route: none — gap" → "has an admin page (inline server.ts:386) ...".
- modules.md: reminders section "not covered by the placeholder plugin" → "placeholder-only ... placeholders.ts:9 ...".
- modules.md: bottom coverage summary "12 of 20 have no admin page" → "10 of 20 have a real page / 10 do not" with inline-page note.
- commands-and-events.md §6 matrix: audio-player + moderation cells → **real** (inline server.ts:282 / :386).
- commands-and-events.md §6 matrix: raise-hand cell "none/placeholder (GAP)" → "none (GAP)".
- commands-and-events.md §6.1: rewrote the "NO dedicated admin route" paragraph to distinguish "no routes/ plugin" from "no real page", noting audio/moderation inline pages → 10 modules with no real page.
- discord-bot-flows.md §9: rewrote the admin-route gap bullet — audio/moderation have inline pages; reminders is placeholder-only; 10 of 20 have a real page.
- troubleshooting.md §13 note: rewrote — audio/moderation have inline pages (server.ts:282,386); the other 10 (reminders + 9 newest) have no real page.

## What I could not fix / out of scope (and why)

- **Prod `Dockerfile` proddeps missing 9 manifests** — this is a real CODE gap
  accurately documented (runtime-and-docker §9.1, AGENTS GR8/§8). Fixing code is
  out of scope for a docs review; the docs already describe it correctly.
- **Line-number drift** — a few cited lines are off-by-one (e.g. adapter intent
  pushes are lines 80/83 vs docs' "79/82"; seed announcements is line 35 vs a "32–36"
  range in one spot). These are immaterial and were left as-is to keep edits
  surgical.
- **"26 packages" in discord-bot-flows.md line 3** — on disk `packages/*` holds 27
  dirs (6 infra + discord-adapter + 20 module packages); pnpm reports 31 workspace
  projects. The "26" matches the brief's own framing (counting audio+cards
  differently) and is not load-bearing, so left unchanged to avoid churn.
- **Could not execute** any gate (no host toolchain; did not bring the Docker stack
  up). All verification was by reading source files, which is sufficient for a docs
  review.

## Checkpoint

Status: PASS

### Validat
- Module count = 20 (`MODULE_KEYS`, main.ts, seed.ts) — confirmed.
- Migrations = 10 (0000..0009) — confirmed on disk.
- Platform events = 5 (events.ts) — confirmed.
- register-commands mirrors the 16 command-owning modules — confirmed.
- Admin pages: 8 routes/ plugins + 2 inline (audio/moderation) + reminders
  placeholder; 9 newest have zero UI — confirmed against server.ts, routes/index.ts,
  placeholders.ts, views/*.ejs.
- proddeps gap (9 missing manifests) — confirmed real; docs already correct.
- All "11 modules / 14 gates / unit 332" stale headers fixed.
- Cross-doc admin-page contradiction reconciled across all 5 affected files.

### Nevalidat
- No gate executed (lint/typecheck/test/build/e2e) — host has no toolchain and the
  task is a docs review; counts in docs (471 unit / 37 integration / 24+1 e2e) were
  taken as the orchestrator's prior execution evidence, not re-run.
- Exact current pnpm workspace project count not re-derived by running pnpm.

### Probleme
- A genuine code gap remains (proddeps missing 9 module manifests) — documented, not
  fixable in a docs pass.
- Minor cited line-number drift remains in a few places (immaterial).

### Următorul agent poate continua?
Da. The `docs/technical/*` set is now internally consistent and matches code on
the load-bearing facts (20 modules, 10 migrations, 5 events, admin-page coverage).
A code agent should still (1) add the 9 missing manifests to the Dockerfile
proddeps stage and (2) optionally add real admin routes/EJS for the 9 newest
modules. A future docs pass could normalise the off-by-one line citations.
