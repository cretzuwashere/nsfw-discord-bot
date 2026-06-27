# Agent Memory — 04 Commands & Events (tech-docs remake)

Author: COMMANDS & EVENTS author. Date: 2026-06-27.
Deliverable: `docs/technical/commands-and-events.md` (full rewrite of the stale
11-module version → current 20-module scope).

## What this doc covers

A complete, verified reference for the bot's command/event surface across all 20
modules:
1. Slash command catalog (every command + subcommand, owning module,
   `defaultMemberPermissions` gate, one-line description) — 16 command-owning
   modules; 4 own none.
2. The 5 platform events + which modules subscribe (+ event→module matrix).
3. Interaction handlers (customId prefixes/patterns) per module.
4. Gateway intents: 4-intent non-privileged base set + 2 privileged opt-in flags
   + what breaks when each is off.
5. Scheduler jobs table (11 jobs across 7 modules, with main.ts line refs).
6. Module → C/E/I/S matrix + admin-route coverage gap.

## Key verified facts (re-confirmed against code this pass)

- 20 module keys in `packages/shared/src/types.ts`; all 20 wired in
  `apps/bot/src/main.ts` (modules array lines 172–193).
- Command counts (16 command-owning modules): audio 12, moderation 12,
  announcements 1, role-menus 1, birthdays 1, reminders 1, custom-commands 1,
  raise-hand 8, fun-commands 5, engagement-prompts 6, giveaways 1, server-stats 3,
  trivia 3, minigames 2, economy 8, levels 5.
- 4 modules own NO commands: welcome, dynamic-cards (cards), scheduled-messages,
  automod.
- 5 platform events (`packages/core/src/contracts/events.ts`): member.join,
  member.leave, message.create, component.interaction, voice.state.update.
  voice.state.update rides non-privileged GuildVoiceStates.
- Base intents (adapter.ts:73–78): Guilds, GuildVoiceStates, GuildMessages,
  GuildModeration. Privileged opt-ins (adapter.ts:79–84):
  GuildMembers (DISCORD_ENABLE_GUILD_MEMBERS), MessageContent
  (DISCORD_ENABLE_MESSAGE_CONTENT). Requesting a privileged intent not enabled in
  the portal → gateway close 4014, bot won't connect.
- 11 scheduler jobs registered in main.ts lines 204–212. server-stats (2) and
  trivia (2) use `schedulerJobs[]` loops; the rest use singular `schedulerJob`.
- register-commands.ts (apps/bot/src) imports exactly the 16 command-owning
  modules — registration parity confirmed, no command-owning module missing.
- Only 2 modules default-enabled: audio-player + announcements (seed.ts:29,36).

## GAPS documented (verified or deduced, tagged in the doc)

- audio-player has NO metadata block → requiredPermissions/requiredIntents
  undefined (verified in audio index.ts).
- 12 modules have no dedicated admin route (routes/index.ts has 9 real + 1
  placeholder). reminders gap notable (createdByAdmin column unreachable).
- automod repeated_messages + raid rule types are NO_MATCH stubs.
- custom-commands allowedRoleIds stored but unenforced.
- role-menus /roles publish has no defaultMemberPermissions gate.
- levels declares only Guilds intent but subscribes to message.create (deduced
  under-declaration, not a runtime bug).

## Checkpoint

Status: PASS

### Validat (verified in code this pass)
- Module roster + wiring: main.ts (lines 51–212), shared/src/types.ts MODULE_KEYS.
- Command registration set: apps/bot/src/register-commands.ts (16 modules).
- 5 platform events + payload shapes: core/src/contracts/events.ts.
- Option-type mapping + truncation: discord-adapter/src/command-mapper.ts.
- Gateway intents base set + 2 privileged flags + 4014 failure mode:
  discord-adapter/src/adapter.ts:64–85; config/src/index.ts:86–91,152–153.
- defaultEnabled per module + seed names: database/src/seed.ts.
- audio metadata-absent gap: audio-module/src/index.ts (no metadata key).
- raise-hand metadata + dual event subscription: raise-hand-module/src/index.ts.
- Admin route registration (9 real + placeholder): apps/admin/src/routes/index.ts.

### Nevalidat (taken from supplied module data set, not re-opened file-by-file)
- Exact option min/max ranges and per-subcommand option lists for every command
  (e.g. timeout 1–40320, slowmode 0–21600) — trusted from the verified
  MODULES_JSON; command-mapper confirms the option-type vocabulary is sufficient.
- Internal constants (TICK_MS, ROUND_TIMEOUT_SEC, PAGE_SIZE, cooldown ms,
  MAX_PER_USER, etc.) — sourced from module data, not re-grepped this pass.
- Exact customId encode/parse internals beyond the documented prefix patterns.
- birthdays card/role-duration "configured-but-unimplemented" claim (deduced,
  carried from module data — not re-read in birthdays scheduler this pass).

### Probleme
- None blocking. Minor: several "deduced" caveats (levels intent
  under-declaration, reminders/birthdays unused columns) are inference-level, not
  failures — clearly tagged `[deduced]` in the doc.

### Următorul agent poate continua?
Da. To deepen: (1) open each module index.ts to confirm option ranges/constants
verbatim (currently trusted from MODULES_JSON); (2) confirm the placeholder admin
plugin (apps/admin/src/routes/placeholders.ts) does not silently cover any of the
12 "no route" modules; (3) cross-link this doc with the per-module deep dives in
docs/agent-memory/tech-docs/modules-group-1..5.md and the architecture doc.
