# 01 — Current Bot Feature Inventory

> Agent: **AGENT 1 — CURRENT BOT FEATURE INVENTORY**
> Date: 2026-06-27
> Builds on the verified `docs/agent-memory/01-project-inventory.md` and
> `docs/technical/commands-and-events.md` (both current as of 2026-06-27), plus
> source re-read this session. Baseline: **typecheck clean, lint clean, 332 unit
> tests passing** (`docker compose exec -T app pnpm typecheck|lint|test:unit`).

## Purpose

Establish exactly what the bot already does — so the TOP 10 fun features **do not
duplicate** existing functionality, plug into existing infrastructure, and avoid
fragile zones.

---

## 1. Existing modules (11) and their commands

| Module key | What it does | Slash commands | Interactivity | Persistence |
|---|---|---|---|---|
| `audio-player` | Voice music playback (YouTube/SoundCloud/Spotify/direct), queue, now-playing panel | `/join /leave /play /queue /skip /pause /resume /stop /nowplaying /controls` | buttons (control panel) | playback_history, queue_items |
| `moderation` | warn/timeout/kick/ban/purge/lock | `/warn /warnings /clearwarnings /timeout /untimeout /kick /ban /unban /purge /slowmode /lock /unlock` | — | warnings, moderation_actions/cases/rules/settings, permission_mappings |
| `announcements` | Create/schedule/send announcements (admin-panel-first) | `/announcement list\|preview\|send\|cancel` | — | announcements (+ scheduler) |
| `welcome` | Welcome/leave msgs, cards, auto-roles, DMs | — (event-driven) | — | welcome_settings (needs GuildMembers intent) |
| `dynamic-cards` | Server-side PNG rendering (resvg) for welcome/birthday cards | — | — | card_templates, card_assets |
| `role-menus` | Self-assignable roles via **buttons & select menus** (not emoji) | `/roles list\|menu\|refresh\|remove` | buttons + string selects | role_menus, role_menu_options, role_assignment_logs |
| `birthdays` | Opt-in birthday announce/role/card | `/birthday set\|view\|remove\|upcoming` | — | birthdays, birthday_settings, birthday_announcements (+ scheduler) |
| `reminders` | Personal/recurring reminders (DM or channel) | `/reminder create\|list\|remove` | — | reminders (+ scheduler) |
| `scheduled-messages` | One-off + recurring (cron) channel messages | — (admin-panel) | — | scheduled_messages, scheduled_message_runs (+ scheduler) |
| `automod` | Banned words/spam/links with escalation | — (event-driven) | — | automod_rules, automod_violations (content rules need MessageContent intent) |
| `custom-commands` | Text/embed/random custom responses | `/custom name` | — | custom_commands |

> 11 module keys in `packages/shared/src/types.ts:MODULE_KEYS`; all wired in
> `apps/bot/src/main.ts`; 7 own slash commands and are mirrored in
> `apps/bot/src/register-commands.ts`.

## 2. Existing FUN features (so we don't duplicate)

- **Music** (`audio-player`) — the main existing "fun" feature. ✔ exists, complete.
- **Birthdays** — social/fun, opt-in. ✔ exists.
- **Custom commands** — community-authored text/embed responses (a primitive
  "inside jokes"/meme-text mechanism). ✔ exists → an "inside jokes DB" or
  "meme text command" feature would **overlap** and is therefore lower priority.
- **Role menus** — self-roles (engagement utility). ✔ exists.
- Everything else is **utility/moderation/ops**, not "fun".

**Conspicuously ABSENT fun/engagement primitives (greenfield → candidates):**
leveling/XP, leaderboards, economy/points, daily/streak rewards, achievements,
profile cards, trivia/quiz, mini-games, polls (interactive voting), giveaways,
reputation/thanks, conversation starters / would-you-rather / QOTD, starboard,
confessions, suggestions board, event/game-night RSVP, tournament brackets,
random team generator, server stats/highlights, quick random commands
(8ball/dice/roll), meme image commands.

## 3. Reusable infrastructure (extension points — LOW risk to build on)

- **Module factory pattern** — copy `reminders`/`announcements` module shape.
- **Drizzle + Postgres** — add tables to the single `schema.ts`, `db:generate` a
  migration, write a per-module `repo.ts` (see `reminders-module/src/repo.ts`).
- **Scheduler** — `kernel.scheduler.register({ name, intervalMs, run })` for daily
  resets / weekly recaps / giveaway draws (see announcements/reminders jobs).
- **Component interactions** — buttons + string selects via `component.interaction`,
  routed by `customId` prefix (`<feature>:<...>`); `event.reply()` (ephemeral) and
  `event.update()` (edit in place). Pattern in role-menus + audio control panel.
- **GuildService** — `sendMessage`/`editMessage`/`sendDirectMessage`,
  `addRole`/`removeRole`/`canManageRole`, `getMemberRoleIds`, `isGuildOwner`,
  `botHasPermission`, and **mass-mention safety** via `allowMentions` (defaults to
  no @everyone/role pings) — use for any feature that mentions users/roles.
- **Image rendering** (`cards-module`) — reusable to render fun **profile cards**.
- **Admin panel** — per-module route plugin + module enable/disable; config via
  `ModuleMetadata.configSchema`.
- **`UserFacingError` + `truncate`** (`@botplatform/shared`) — safe user errors and
  output length caps (anti-spam).
- **Audit log** (`AuditLogPort`) — record notable actions (`audit.record`).

## 4. Fragile / DO-NOT-BREAK zones

- `packages/core/*` (kernel, registry, contracts) and `packages/discord-adapter/*`
  — shared by all modules. **Prefer zero edits**; any edit must be additive +
  regression-checked. (Avoidable for the chosen TOP 10.)
- `apps/bot/src/main.ts`, `register-commands.ts`, `seed.ts`, `shared/types.ts`,
  `apps/admin/src/routes/index.ts` — shared *wiring* files. Edited additively, one
  feature at a time (why implementation is sequential).
- `packages/database/src/schema.ts` + `migrations/` — append-only discipline;
  generate migrations, never hand-edit applied ones.
- `audio-module` voice internals + `security` (SSRF/streaming) — out of scope; do
  not touch.

## 5. Capability limits that constrain fun-feature design

- **No emoji-reaction listener / no modals** → use buttons & select menus.
- **MessageContent** privileged & OFF → can count messages for XP, but cannot read
  text (so no counting-game / word-trigger without enabling it).
- **GuildMembers** privileged & OFF → join-based features degrade.
- **No voice-state event** → no voice-activity XP without adapter work.

These push the TOP 10 toward: slash + button/select + scheduler features, no
privileged intents, with persistence and cooldowns.

---

## Checkpoint

Status: PASS

### Validat
- All 11 existing modules, their commands, interactivity and persistence
  enumerated and cross-checked against `docs/technical/commands-and-events.md`,
  `seed.ts`, `main.ts`, `MODULE_KEYS`.
- Existing fun features identified (music, birthdays, custom-commands, role-menus);
  absent fun primitives listed as the candidate space.
- Reusable infrastructure and fragile zones mapped.
- Baseline green (332 unit tests) recorded.

### Nevalidat
- Nothing requiring execution beyond the baseline run (read-only inventory).

### Probleme
- `custom-commands` partially overlaps "inside jokes / meme text" ideas → those
  candidates must be deprioritized or clearly differentiated.

### Următorul agent poate continua?
**Da.** It is clear what exists (don't duplicate), what infrastructure to build on
(low risk), and what zones to avoid (regression risk). Research (Agent 2, running
as workflow `wf_9cfb208f-07d`) and ranking can proceed against this inventory.
