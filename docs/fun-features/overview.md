# Fun & Engagement Features — Overview

This directory documents the **fun / engagement** feature initiative for the
`botplatform` Discord bot: a set of new modules designed to make a **large**
community more fun, engaging and sticky, without breaking the existing bot or
requiring heavy Discord permissions.

## How this fits the existing bot

The bot is a modular monorepo (see `docs/ARCHITECTURE.md` and
`docs/COMMUNITY_MODULES.md`). It already ships 11 modules — music, moderation,
announcements, welcome, dynamic-cards, role-menus, birthdays, reminders,
scheduled-messages, automod, custom-commands. The fun features are **new modules**
that follow the exact same pattern (a `create<Name>Module` factory, a Drizzle repo,
adapter-neutral slash commands + button/select interactions, an optional scheduler
job, and an optional admin page). Each can be **enabled/disabled per server** from
the admin panel like every other module.

## Design principles for fun features

1. **No privileged intents** for the core set — XP is earned from *message
   activity counts* (no message-content reading), so the bot needs no special
   Discord intents beyond what it already has.
2. **Buttons & select menus, not emoji reactions** — matches the existing
   interaction model (the bot has no emoji-reaction listener).
3. **Anti-spam by default** — every interactive feature has per-user cooldowns,
   output length caps, and farming/abuse guards. Leaderboards and economy have
   explicit anti-farming rules.
4. **Moderator control** — every feature can be turned off per server; sensitive
   features (confessions, giveaways, economy admin) gate mutating actions behind
   Discord permissions.
5. **They reinforce each other** — XP → leaderboard → profile card; economy →
   daily streak → shop. This compounds engagement instead of being one-off novelty.

## Documents in this directory

| File | Contents |
|---|---|
| `overview.md` | This file. |
| `research-summary.md` | The fun-feature research: ~30 candidate ideas analyzed, engagement insights, sources. |
| `selected-top-10.md` | The scoring matrix and the TOP 10 selected (with why, order, waves). |
| `commands-and-interactions.md` | Every new slash command / button / select across all fun features. |
| `permissions.md` | Permissions & intents each fun feature needs. |
| `testing.md` | How the fun features are tested (automated + manual). |
| `troubleshooting.md` | Common problems and fixes. |
| `future-roadmap.md` | Deferred ideas and next steps. |
| `features/feature-01..10.md` | One spec sheet per implemented feature (status, flows, commands, data, cooldowns, edge cases, rollback). |

## Status

This initiative is tracked agent-by-agent in
`docs/agent-memory/fun-features/` (orchestrator plan, inventory, research,
ranking, design, per-feature implementation+validation, regression, final report).
See `selected-top-10.md` for the chosen features and their live status.
