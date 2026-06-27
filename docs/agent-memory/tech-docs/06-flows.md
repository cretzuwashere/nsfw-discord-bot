# 06 — Discord Bot Flows (agent-memory)

Author pass: DISCORD FLOWS author. Date: 2026-06-27. Output written to
`docs/technical/discord-bot-flows.md` (overwrote a stale prior version).

## What this pass produced

A single end-to-end flows document covering: shared adapter plumbing (intents, event
mapping, component ack contract, GuildService, scheduler), then 12 named flows —
audio play, moderation action, role-menu self-assign, welcome-on-join, automod scan,
announcement delivery, scheduled-message delivery, raise-hand (incl voice.state.update +
gated panel buttons), giveaways, trivia, levels, economy — each as
trigger → steps → persistence → user-visible result with intents/permissions.

## Sources read (verified in code)

- `packages/core/src/contracts/events.ts` — 5 platform events (incl voice.state.update).
- `packages/core/src/contracts/guild-service.ts` — GuildService incl `memberHasPermission`.
- `packages/core/src/scheduler.ts` — overlap guard, unref, DB-backed.
- `packages/discord-adapter/src/adapter.ts` — intents (base 4 + 2 privileged opt-in),
  gateway→platform mapping, component reply/update + deferUpdate fallback, voice capability.
- `packages/discord-adapter/src/voice-session.ts` — joinVoiceChannel selfDeaf, Ready 20s,
  Playing 15s, single terminal event per track.
- `apps/bot/src/main.ts` — all 20 modules wired; scheduler registrations (lines 204-212).
- audio-module: `index.ts`, `now-playing.ts`, `commands.ts`, `engine/manager.ts`,
  `resolver/resolver.ts`.
- moderation: `commands.ts` (runAction scaffold).
- role-menus: `service.ts`. welcome: `index.ts` + `service.ts`. automod: `index.ts`.
- raise-hand: `index.ts` + `service.ts` (isModerator gate, handleVoiceState).
- announcements: `index.ts` + `service.ts`. giveaways/trivia/levels: `index.ts`+`service.ts`.

## Key verified facts (load-bearing)

- Base intents always on: Guilds, GuildVoiceStates, GuildMessages, GuildModeration.
  Privileged GuildMembers / MessageContent are opt-in via config flags; requesting an
  un-enabled privileged intent = gateway close 4014 (bot won't connect).
- Levels subscribes to message.create but only counts (never reads content) → works on the
  base GuildMessages intent; its metadata declaring only `Guilds` is harmless because the
  gateway intent is owned by the adapter, not the module.
- raise-hand uses GuildVoiceStates (non-privileged) for both panel context and voice-leave
  auto-removal; moderator panel buttons (next/clear) re-checked server-side via
  isGuildOwner OR memberHasPermission('MuteMembers'). It never mutes — MuteMembers only
  identifies mods.
- Welcome auto-roles fire on EVERY join independent of the welcome toggle and immediately
  (not delayed). Delayed welcome msg uses in-process setTimeout().unref(), NOT the kernel
  scheduler.
- Announcements/scheduled-messages: bot-offline leaves the row due to retry next tick;
  send-failure paths differ (announcements mark failed after a permission check;
  scheduled-messages reschedule +5min). 30s ticks; admin app has no Discord connection.
- Audio module declares NO metadata block → requiredIntents/requiredPermissions undefined.

## Checkpoint

Status: PASS

### Validat
- All 12 requested flows traced directly from source (adapter + each module's
  index/service/commands). Intents and permission gates cross-checked against
  `adapter.ts` and each module's metadata.
- voice.state.update auto-removal path and memberHasPermission button gating verified in
  `raise-hand-module/src/service.ts`.
- Scheduler delivery semantics (tick, overlap guard, offline-retry) verified in
  `core/src/scheduler.ts` + announcements/scheduled-messages services.
- Privileged-intent opt-in (4014) verified in `adapter.ts:64-84`.

### Nevalidat
- Exact Discord bot permission bits for audio (Connect/Speak) — deduced from behaviour
  (voice-session joinVoiceChannel), not from a declared metadata list (audio declares none).
- birthdays card/role-duration, custom-commands allowedRoleIds, reminders createdByAdmin
  gaps were taken from the provided module notes, not re-read this pass
  (tagged documented-elsewhere-unverified in the doc).

### Probleme
- The prior `docs/technical/discord-bot-flows.md` was stale (older module set); it was
  fully overwritten, not merged.
- Repo working tree has large uncommitted changes (expected per brief); nothing committed.

### Următorul agent poate continua?
Yes. To extend: (1) re-read `birthdays-module`, `custom-commands-module`,
`reminders-module` to upgrade the three "documented-elsewhere-unverified" gap notes to
verified; (2) document the remaining un-flow'd modules (server-stats accumulator/recap,
minigames challenge→accept→move, engagement-prompts QOTD, fun-commands) if a fuller flow
catalog is wanted; (3) add the audio metadata block so the admin panel can display
audio intents/permissions (real code fix, not docs).
