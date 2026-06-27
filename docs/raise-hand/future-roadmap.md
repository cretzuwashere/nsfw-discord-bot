# Speaker Queue — Future Roadmap (OPTIONAL, post-MVP)

> Module: **Speaker Queue** (`raise-hand`, `packages/raise-hand-module`).
> This file lists enhancements that are **explicitly NOT in the MVP**. The MVP is
> the raise-hand queue, slash commands, button panel, voice-leave cleanup, and
> priority — as built per [`../agent-memory/05-implementation-plan.md`](../agent-memory/05-implementation-plan.md).
> Everything below is deferred. Each item states **what it needs** and the
> **trade-off** so a future maintainer can decide deliberately.

> **Why these are out of MVP:** they either require **extra Discord permissions /
> privileged intents**, **new `GuildService` methods**, **new infrastructure**
> (timers, scheduler jobs, admin pages), or they change the social contract of the
> feature (e.g. force-muting people). The MVP deliberately stays read-only on voice
> state and needs **no Mute/Move Members permission and no privileged intent**.

---

## 1. Role-based auto-priority

**What it is:** members with a configured role (e.g. *Speaker*, *Verified*, *Staff*)
are automatically enqueued at a higher `priority`, jumping ahead of regular raisers
without a moderator running `/promote-speaker`.

**What it needs:**
- Per-guild config mapping role id → priority bonus (a new `speaker_queue_settings`
  table, or reuse the `module_settings` JSON pattern other modules use).
- At `/raise-hand` time, read the caller's roles. The component-interaction event
  already carries `userRoleIds`; for the slash path, use
  `guildService.getMemberRoleIds(userExternalId)` (already exists).
- A logic change so `priority` is seeded from the role bonus instead of `0`.

**Trade-off:** introduces config surface + a fairness question (role holders
permanently outrank others). Keeps the existing manual `/promote-speaker` as the
override. No new Discord permission needed — `getMemberRoleIds` is already available.

---

## 2. Optional server-mute / move integration

**What it is:** when a speaker becomes `active`, optionally **server-unmute** them and
**server-mute** the previous speaker; optionally **move** a finished speaker out of a
"stage" VC. This makes the queue *enforce* who can talk, instead of being advisory.

**What it needs:**
- **Discord permissions the MVP does not request:** `Mute Members` (for
  server-mute/deafen) and `Move Members` (to move between VCs). These are powerful
  moderation permissions and change the bot's trust profile.
- **New `GuildService` methods** (none exist today):
  `setVoiceMute(userExternalId, muted, reason?)` and
  `moveMember(userExternalId, targetChannelId, reason?)`, each implemented in
  `packages/discord-adapter/src/guild-service.ts` against discord.js
  (`member.voice.setMute(...)` / `member.voice.setChannel(...)`), honouring the
  no-throw contract.
- A per-guild opt-in flag (default **off**) so guilds choose the invasive mode.

**Trade-off:** much stronger UX (the queue physically controls the mic) but it is
**invasive** — it overrides what users set themselves, requires elevated permissions,
and can fight with other moderation bots. Per the capability analysis this was
deliberately excluded from MVP; ship it only behind an explicit opt-in.

---

## 3. DM notifications

**What it is:** DM a user "🎤 You're up next / it's your turn to speak" instead of (or
in addition to) the in-channel announce.

**What it needs:**
- `guildService.sendDirectMessage(userExternalId, message)` — **already exists**, so
  no new contract.
- Handle the common failure: users with DMs closed. The no-throw contract means a
  failed DM is swallowed, so keep the in-channel announce as the reliable path and
  treat DMs as best-effort.
- A per-user or per-guild opt-in (DMs from bots are easily seen as spam).

**Trade-off:** more reliable than expecting users to watch the channel, but DM
deliverability is unreliable (closed DMs, rate limits) and unsolicited bot DMs annoy
users. Best as opt-in, never the only notification path.

---

## 4. Per-guild config in the admin panel

**What it is:** a real admin page (`/raise-hand`) to configure the module per guild:
default announce channel, role-priority map (item 1), whether server-mute mode (item
2) is on, time limits (item 5), max queue length, etc. — instead of binding
everything implicitly through slash commands.

**What it needs:**
- An `AdminRoutePlugin` (`apps/admin/src/routes/raise-hand.ts`) + EJS views,
  registered in `apps/admin/src/routes/index.ts` before the `placeholders.ts`
  catch-all — mirroring `announcements`/`role-menus` admin routes.
- A settings table (or `module_settings` rows) the bot reads at runtime.
- The usual admin guards: auth, mutating-role + CSRF on writes, audit on save.

**Trade-off:** central, discoverable configuration and the natural home for items
1/2/5, but it couples the SSR admin app to the module's repo (the same coupling the
architecture analysis already notes for other modules) and adds maintenance surface.
The MVP keeps config implicit (panel binds to the mod's current VC) to avoid this.

---

## 5. "Time-to-speak" limits / timers

**What it is:** each `active` speaker gets a countdown (e.g. 2 minutes); when it
expires the bot auto-advances to the next speaker (or warns the moderator).

**What it needs:**
- A timer mechanism. The project already has a **DB-backed in-process scheduler**
  (`packages/core/src/scheduler.ts`) with named `ScheduledJob`s — a `raise-hand`
  job could poll for expired `active` entries (needs an `activeSince` / `expiresAt`
  column on `speaker_queue_entries`) and call the same advance logic.
- Config for the limit (per guild, item 4) and a choice between auto-advance vs.
  warn-only.
- Combined with item 2 it could auto-mute the expired speaker.

**Trade-off:** keeps discussions moving and removes moderator babysitting, but
auto-cutting someone off mid-sentence is socially harsh; "warn-only" is safer.
Reuses existing scheduler infra, so the cost is mostly a column + a job + config,
not new dependencies.

---

## 6. Multiple concurrent active speakers

**What it is:** allow N simultaneous `active` speakers (a panel/debate format) rather
than exactly one at a time.

**What it needs:**
- Relax the single-active assumption in the logic (`findActive` → `findActives`,
  `computeAdvance` promotes up to N), plus a per-queue `maxActive` setting (item 4).
- Panel/announce rendering to list several current speakers.
- No schema change beyond a config value (`status` already supports many `active`
  rows; the partial unique index only prevents duplicate *users*, not multiple
  actives).

**Trade-off:** supports panels/debates, but complicates the mental model ("who's
next" is ambiguous with several actives) and the moderator controls. Best gated
behind a config so the default stays single-speaker.

---

## 7. Analytics

**What it is:** per-guild stats — how many raised hands, average wait time, who spoke
most, busiest channels/sessions.

**What it needs:**
- Either derive from a retained history (don't hard-delete entries — mark `done` and
  keep them, optionally with a `spokeAt` timestamp) or write a separate
  `speaker_queue_events` log table (like `role_assignment_logs`).
- An admin analytics view (item 4) or a `/speaker-stats` command.
- A retention/privacy policy — this is per-user activity data (Discord IDs +
  timestamps), so document retention and provide a purge, consistent with the
  privacy notes in the role-menus docs.

**Trade-off:** useful for community organizers, but it means **retaining personal-ish
data** (who raised hands, when) instead of cleaning up on `done`/leave. Needs an
explicit retention decision and a purge path; the MVP intentionally keeps the queue
ephemeral (entries are removed on lower/leave/clear), holding no history.

---

## Roadmap-at-a-glance

| # | Enhancement | New Discord perm? | New `GuildService` method? | New infra |
|---|---|---|---|---|
| 1 | Role-based auto-priority | No | No (`getMemberRoleIds` exists) | Settings table/config |
| 2 | Server-mute / move | **Yes** (`Mute Members`, `Move Members`) | **Yes** (`setVoiceMute`, `moveMember`) | Per-guild opt-in |
| 3 | DM notifications | No | No (`sendDirectMessage` exists) | Opt-in flag |
| 4 | Admin config page | No | No | Admin route + views + settings table |
| 5 | Time-to-speak timers | No (unless combined with #2) | No | Scheduler job + `expiresAt` column |
| 6 | Multiple active speakers | No | No | `maxActive` config |
| 7 | Analytics | No | No | History/log table + retention policy |

**Bottom line:** the MVP needs **no new Discord permission and no privileged
intent** (it only reads voice state via the already-enabled `GuildVoiceStates`).
Items 1, 3, 4, 5, 6, 7 stay within that boundary and mostly add config/infra. **Only
item 2** crosses into elevated permissions and an invasive UX — so it is the most
significant, most clearly opt-in deferral.
