# 05 — Modules Catalog (tech-docs)

Agent-memory note for the MODULES CATALOG author task (remake pass, 2026-06-27).

## Deliverable

- Wrote `docs/technical/modules.md` — per-module catalog for all 20 modules.
- Top summary table (20 rows: module | commands# | events | scheduler | admin page |
  default), grouped sections: Audio / Moderation & safety / Engagement & fun / Utility /
  Economy & levels, plus an admin-route coverage summary at the end.

## What I verified directly in code (not just from the supplied JSON)

- `packages/shared/src/types.ts` — `MODULE_KEYS` has exactly the 20 keys listed.
- `apps/bot/src/main.ts` — all 20 modules wired into the kernel `modules: [...]` array
  (lines 173-193). Scheduler registrations (lines 204-212): announcements,
  scheduled-messages, reminders, birthdays, engagement-prompts, giveaways, then a loop over
  `serverStatsHandle.schedulerJobs` (2), a loop over `triviaHandle.schedulerJobs` (2), and
  `minigamesHandle.schedulerJob` (singular). 9 register sites, 11 actual jobs (server-stats
  and trivia each contribute 2). Audio is explicitly NOT registered with the scheduler.
- `packages/database/src/seed.ts` — only `audio-player` and `announcements` are
  `defaultEnabled: true`; the other 18 are false. Confirmed line-by-line.
- `apps/admin/src/routes/index.ts` — `COMMUNITY_ROUTE_PLUGINS` has exactly 8 module plugins
  (announcements, cards, welcome, role-menus, scheduled-messages, custom-commands,
  birthdays, automod) + `commands` (the /commands page) + `placeholders` (must stay last).
- `apps/admin/src/routes/*.ts` glob — confirms no route files for the 12 uncovered modules
  (audio-player, moderation, reminders, raise-hand, fun-commands, engagement-prompts,
  giveaways, server-stats, trivia, minigames, economy, levels).

## Key conclusions documented

- **20 modules, only 8 dedicated admin route plugins.** 12 modules have NO admin page:
  the 9 newest (raise-hand, fun-commands, engagement-prompts, giveaways, server-stats,
  trivia, minigames, economy, levels) PLUS three older ones (audio-player → internal API,
  moderation, reminders). This corrects the prompt's "9 modules" framing to a verified 12.
- Audio Player declares NO metadata block → `requiredPermissions`/`requiredIntents` are
  undefined (admin-display gap).
- Several configured-but-unimplemented / stubbed items flagged: automod
  `repeated_messages` + `raid` stubs; birthdays `cardTemplateId` + `roleDurationHours` not
  acted on; custom-commands `allowedRoleIds` not enforced; reminders/levels `timezone`
  unused; levels possible intent under-declaration (deduced).

## Caveats / limits of this pass

- Module-internal claims (interaction customId formats, scheduler intervals, DB column
  details, in-memory cooldown values) were taken from the supplied verified JSON and the
  other tech-docs; I re-confirmed the cross-cutting facts above against code but did NOT
  re-read every module's `index.ts`/`schema.ts`/`logic.ts`. Marked such items "verified in
  code" per the JSON's own assertions; deductions marked "deduced".

## Checkpoint

Status: PASS

### Validat
- 20 module keys (types.ts), 20 modules wired in main.ts, scheduler registration sites.
- defaultEnabled: only audio-player + announcements on (seed.ts).
- Admin route coverage: 8 module plugins + commands + placeholders; 12 modules with no page.

### Nevalidat
- Per-module internal details (customId schemas, exact intervals, DB column lists) — relied
  on supplied JSON + sibling tech-docs rather than re-reading every package source file.
- The "deduced" caveats (privileged-intent gating behaviour, levels intent under-declaration)
  not traced into discord-adapter.

### Probleme
- None blocking. Note: prompt said "9 modules without admin routes"; verified count is 12
  (the 9 newest + audio-player, moderation, reminders) — documented accordingly.

### Următorul agent poate continua?
- Da. To deepen: re-read each of the 12 uncovered modules' `index.ts` metadata blocks to
  confirm requiredIntents/permissions, and trace discord-adapter gateway intents for the
  levels/welcome privileged-intent caveats.
