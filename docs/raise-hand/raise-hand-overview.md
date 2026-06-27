# Speaker Queue (Raise Hand) — Overview

The **Speaker Queue** module (module key `raise-hand`) gives a voice channel an
orderly, fair "raise your hand to speak" line. Members raise their hand to join
the queue for the voice channel they are currently in; a moderator advances the
queue one speaker at a time. It is built for meetings, AMAs, town halls, study
rooms, and any voice conversation where people should take turns instead of
talking over each other.

There is **no special client, no bots in your ears, and no forced muting** — the
queue tells everyone *who's next*, and people honour it. The bot tracks order,
announces the next speaker, and keeps a live, always-up-to-date panel so nobody
has to guess where they are in line.

Source package: `packages/raise-hand-module` (mirrors the `role-menus` module
structure: `index.ts` / `commands.ts` / `service.ts` / `logic.ts` / `repo.ts`).

---

## The approach, and why

The feature uses a **hybrid** design: **slash commands** for the primary actions,
a **persistent button control panel** for one-tap participation, a
**self-managed queue** (members add and remove themselves), and **moderator
controls** to advance and curate the line. All state is stored in **Postgres**
(via Drizzle), so a queue survives a bot restart.

We chose this after comparing every realistic option (full analysis in
[`../agent-memory/02-discord-raise-hand-research.md`](../agent-memory/02-discord-raise-hand-research.md)).
Two tempting alternatives were deliberately rejected. **Reaction-based queues**
(react with ✋) are unordered, easy to desync, and aren't part of this platform's
event model, which makes fair ordering unreliable. **Voice-activity / "who's
speaking" detection** is not viable: Discord only exposes a speaking signal over a
voice-receive connection, which is privacy-invasive, discouraged, and — on the
`@discordjs/voice` version this platform uses, under Discord's now-mandatory
end-to-end voice encryption (DAVE) — effectively broken. So the queue is an
**explicit, managed raise-hand line**, never voice-activity-driven.

The hybrid we landed on also fits this codebase exactly. The button panel reuses
the proven **role-menus** interaction pattern (a posted message whose buttons
route by a `customId` prefix and whose embed the bot edits in place). Detecting
when someone leaves the call uses the `GuildVoiceStates` intent, which the bot
**already** requests — so no privileged intent and no new permissions are needed.
And because Discord can hide *slash commands* from members who lack a permission
but **cannot** gate *buttons*, moderator actions are protected both ways: slash
commands via Discord's `default_member_permissions`, and panel buttons by a
server-side permission re-check. **Forced server-mute and moving members between
channels are intentionally out of scope** for the first version (they require
powerful, invasive permissions); they are noted in the roadmap as opt-in.

---

## Commands at a glance

All commands are **guild-only**. Raising a hand requires you to be **in a voice
channel** — the queue you join is the one for *your current* voice channel.

### Everyone

| Command | What it does |
|---|---|
| `/raise-hand` | Adds you to the queue for the voice channel you're in. Idempotent — raising again just tells you your current position. |
| `/lower-hand` | Removes you from your voice channel's queue. |
| `/speaker-queue` | Shows the current ordered queue for your voice channel (private/ephemeral reply). |

### Moderators

Moderator commands require the **Mute Members** permission (the guild owner is
always allowed), and you must be **in the voice channel you want to manage**.

| Command | What it does |
|---|---|
| `/next-speaker` | Marks the current speaker done and promotes the next person in line to "now speaking", announcing them. |
| `/remove-speaker user:@u` | Removes a specific person from the queue. |
| `/clear-speaker-queue` | Empties the queue for your voice channel. |
| `/promote-speaker user:@u` | Bumps someone to the front of the waiting list. |
| `/speaker-panel` | Posts the persistent button control panel in the current text channel, bound to your voice channel. |

---

## How the queue works at a glance

- **Scope:** one independent queue per **(server, voice channel)**. Two voice
  channels in the same server are two separate rooms with two separate lines.
- **Order:** people are served by **priority first, then the time they raised
  their hand** (earliest first). A moderator can `/promote-speaker` someone to the
  front.
- **States:** each entry is *waiting* → *active* (currently speaking) → *done*.
  `/next-speaker` moves the line forward one step.
- **No duplicates:** you can't be in the same queue twice; re-raising just reports
  your position.
- **Leaving the call drops you:** if you disconnect from (or move out of) the
  voice channel, the bot removes you from that channel's queue automatically and
  refreshes the panel.
- **The panel stays live:** the control-panel embed always shows the current
  speaker and the waiting list, and is re-edited whenever the queue changes.
- **Announcements:** when the line advances, the bot edits the panel and posts
  "🎤 @user is next to speak", pinging only that one person.

---

## Related documentation

- [`user-flows.md`](user-flows.md) — step-by-step member journeys (raise, check
  position, lower, get called).
- [`moderator-flows.md`](moderator-flows.md) — running a session: panel, advancing,
  removing, clearing, promoting.
- [`commands-and-interactions.md`](commands-and-interactions.md) — exact commands,
  options, button `customId`s, and replies.
- [`queue-and-priority-rules.md`](queue-and-priority-rules.md) — ordering,
  priority, states, duplicate prevention, and voice-leave handling.
- [`permissions.md`](permissions.md) — who can do what, the Discord permissions and
  intents required, and how button actions are re-checked server-side.
- [`testing.md`](testing.md) — how to test the module (unit + Docker), and what can
  only be checked against a live server.
- [`troubleshooting.md`](troubleshooting.md) — common problems and fixes.
- [`future-roadmap.md`](future-roadmap.md) — deferred ideas (role-based priority,
  select-menu actions, optional server-mute / move enforcement, DMs).
