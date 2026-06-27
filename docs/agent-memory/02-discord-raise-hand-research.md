# 02 — Discord Raise-Hand Research

> Agent: **AGENT 2 — DISCORD RAISE-HAND RESEARCH**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)
> Feature: **Raise Hand / Speaker Queue** (module key `raise-hand`).

This file compares every candidate UX method for a "raise your hand to speak"
feature, maps it against what the **Discord API + discord.js v14** actually allow
(adversarially web-verified), and lands on the **locked hybrid design** from
[`00-orchestrator-plan.md`](00-orchestrator-plan.md) §3, justified against *this*
codebase.

Prior context (read, not duplicated):
[`01-project-inventory.md`](01-project-inventory.md),
[`03-architecture-analysis.md`](03-architecture-analysis.md),
[`00-orchestrator-plan.md`](00-orchestrator-plan.md).

---

## 1. Method comparison

Each candidate is rated on: how it works, pros, cons, implementation complexity,
risks, Discord-compatibility, testability, and ease for non-technical users. The
existing reference for a button-driven, persistent, `component.interaction`-routed
feature is **role-menus** (`packages/role-menus-module/*`); the existing reference
for slash commands + ephemeral replies is every module's `commands.ts`.

### 1.1 `/raise-hand` + `/lower-hand` slash commands

- **How it works:** two guild-only slash commands. `/raise-hand` reads the
  caller's current voice channel via `CommandContext.voice.getUserVoiceChannel()`
  and inserts a `speaker_queue_entries` row for that `(guild, voiceChannelId)`;
  `/lower-hand` removes it. Replies are ephemeral.
- **Pros:** first-class platform primitive used by every module; discoverable in
  the Discord command picker; permission-gateable via `default_member_permissions`;
  trivially unit-testable (the `execute(ctx)` handler is pure given a mocked
  `CommandContext`); idempotent re-raise reports current position.
- **Cons:** typing a command is one extra step vs. a single button tap; the user
  must already be in a VC (we reject with "Join a voice channel first.").
- **Complexity:** Low. Mirrors existing `commands.ts` handlers.
- **Risks:** none platform-specific. Only the usual "user not in VC" / "already
  active" edge cases, all handled with friendly replies.
- **Discord-compatibility:** Full. Slash commands + ephemeral replies are core.
- **Testability:** High (pure logic + mocked ctx).
- **Non-technical ease:** Medium-high. Slash UI is guided (autocomplete of the
  command name, inline description), but still requires invoking a command.

### 1.2 `/speaker-queue` command

- **How it works:** guild-only slash command that renders the **ordered** queue
  for the caller's current VC as an ephemeral embed (current speaker + waiting
  list, ordered by `(priority DESC, raisedAt ASC)`).
- **Pros:** read-only, zero side effects, safe for everyone; gives the queue a
  canonical "show me where I am" entry point that does not depend on the panel
  message still existing; ephemeral so it never clutters the channel.
- **Cons:** a snapshot — it does not live-update (unlike the panel embed). Re-run
  to refresh.
- **Complexity:** Low.
- **Risks:** none.
- **Discord-compatibility:** Full.
- **Testability:** High (formatting is a pure function of the entry list).
- **Non-technical ease:** High. "What's the queue?" → one command, private reply.

### 1.3 Persistent button control panel

- **How it works:** `/speaker-panel` (moderator) posts a message with an embed
  (live ordered queue + current speaker) and a row of buttons. Buttons route by
  `customId` prefix `rh:` through the existing `component.interaction` event —
  exactly the role-menus pattern (`rolemenu:<id>:<roleId>` →
  `rh:<action>:<vcId>`). Everyone-buttons: Raise Hand, Lower Hand, Show Queue.
  Moderator-buttons: Next Speaker, Clear Queue. The panel's
  `panelChannelId`/`panelMessageId` are persisted so the bot can edit it on every
  change via `event.update(message)` or `GuildService.editMessage`.
- **Pros:** one-tap raise/lower — the lowest-friction UX for non-technical users;
  a single always-visible, auto-refreshing source of truth for the room; reuses
  the codebase's proven button-routing + message-edit machinery.
- **Cons:** Discord **cannot** gate a button per-permission (see §2), so the
  moderator buttons must be re-checked server-side; the panel message can be
  deleted by a user with Manage Messages, after which buttons on the stale copy
  do nothing useful (we re-post via `/speaker-panel`).
- **Complexity:** Medium. Needs `customId` parsing, server-side re-check, and
  panel-message persistence + edit-on-change (all have direct precedents).
- **Risks:** server-side re-check is **mandatory** — a missing check would let any
  member press Next/Clear. Mitigated by `memberHasPermission('MuteMembers')` OR
  `isGuildOwner`.
- **Discord-compatibility:** Full (buttons, action rows, message edit are core).
- **Testability:** High for the pure pieces (customId parse, embed render,
  authorization predicate); the live edit path needs the adapter (integration).
- **Non-technical ease:** Highest of all methods — tap a labelled button.

### 1.4 Select menu for actions

- **How it works:** a string select menu ("Raise hand", "Lower hand", "Show
  queue", …) instead of/alongside buttons. Arrives as the same
  `component.interaction` event with `values[]`.
- **Pros:** compact (one component slot instead of up to five buttons); scales if
  the action list grows; supported and already used by role-menus' select type.
- **Cons:** **worse** for the primary actions — a select needs open → pick →
  submit (≥2 taps) where a button is one tap; the selected value does not "stick"
  as a toggle, so it reads oddly for raise/lower; mobile users dislike multi-step
  selects for high-frequency actions.
- **Complexity:** Low-medium (same routing as buttons).
- **Risks:** UX regression for the most common action; same lack of per-permission
  gating as buttons.
- **Discord-compatibility:** Full.
- **Testability:** High.
- **Non-technical ease:** Medium. More steps than a button for the same result.
- **Verdict:** keep as a *possible* roadmap addition for "many actions", **not**
  the primary control. Buttons win for raise/lower/next.

### 1.5 Reaction-based queue

- **How it works:** members add an emoji reaction (e.g. ✋) to a posted message;
  the bot reads `MessageReactionAdd`/`Remove` to build the queue.
- **Pros:** familiar "react to join" idiom; visually obvious.
- **Cons (disqualifying):**
  1. **Not in the platform's event model.** `PlatformEvent`
     (`packages/core/src/contracts/events.ts`) has **only** `member.join`,
     `member.leave`, `message.create`, `component.interaction` — there is **no
     reaction event**. Adding one is a larger core+adapter change than this
     feature warrants.
  2. **Reactions are unordered.** Discord does not expose a reliable per-user
     reaction *timestamp*, so reconstructing fair join order is fragile.
  3. **Desync-prone.** Reactions removed out of band (user clears, bot restart,
     message deleted) silently corrupt the queue.
  4. Reading reaction *content/members* reliably can pull in extra gateway load
     and, for some flows, message-content concerns.
- **Complexity:** High *relative to value* (new event type + ordering hacks).
- **Risks:** high (ordering correctness, desync).
- **Discord-compatibility:** Possible but a poor fit.
- **Testability:** Low (ordering depends on gateway timing we cannot fake well).
- **Non-technical ease:** High to *use*, but the correctness problems make it a
  bad foundation.
- **Verdict:** **REJECTED** (matches the locked design). Buttons give the same
  one-tap ergonomics with deterministic ordering and zero new event type.

### 1.6 Text-channel control panel

- **How it works:** a plain text message in a channel that the bot edits to show
  the queue (a panel *without* interactive components — actions happen only via
  slash commands).
- **Pros:** trivially simple; no components; works anywhere the bot can post +
  edit; the "live edited message" half of the button panel is reused as-is.
- **Cons:** no one-tap actions — every interaction is a slash command, raising
  friction for the most common case; for non-technical users the visible queue is
  nice but they still must type to participate.
- **Complexity:** Low.
- **Risks:** low.
- **Discord-compatibility:** Full.
- **Testability:** High.
- **Non-technical ease:** Medium (read-only convenience; no quick actions).
- **Verdict:** this is effectively the **panel embed minus the buttons**. We keep
  the live-edited embed but *add* buttons (1.3) rather than ship text-only.

### 1.7 Moderator-only controls

- **How it works:** privileged commands/buttons — `/next-speaker`,
  `/remove-speaker @u`, `/clear-speaker-queue`, `/promote-speaker @u`,
  `/speaker-panel` — that advance/curate the queue. Gated by Discord
  `default_member_permissions: ['MuteMembers']`, and (for buttons) re-checked
  server-side. The moderator must be **in** the VC they manage
  (`getUserVoiceChannel()`), else "Join the voice channel you want to manage."
  Guild owner always allowed.
- **Pros:** gives the room a chairperson; `MuteMembers` is the natural "controls
  who speaks" permission and Discord **hides** such commands from members who lack
  it (verified §2); the in-VC requirement prevents a mod accidentally driving the
  wrong room.
- **Cons:** none beyond the universal button-gating caveat (handled server-side).
- **Complexity:** Medium (authorization predicate + in-VC check, both small pure
  functions).
- **Risks:** the server-side re-check on buttons is load-bearing (see 1.3).
- **Discord-compatibility:** Full. `default_member_permissions` for slash; manual
  re-check for buttons.
- **Testability:** High (authorization is pure: has `MuteMembers` OR is owner).
- **Non-technical ease:** High for the mod (clear, labelled controls).
- **Verdict:** **CORE** of the design — needed for fair turn-taking.

### 1.8 Self-managed queue

- **How it works:** members add/remove *themselves* (`/raise-hand`,
  `/lower-hand`, panel Raise/Lower). Moderators only *advance* and *curate*; they
  do not have to enqueue everyone by hand.
- **Pros:** scales to large rooms (no mod bottleneck); respects user agency;
  idempotent and forgiving (re-raise = "you're already #N"); leaving the VC
  auto-drops you (via the new `voice.state.update` event).
- **Cons:** relies on members actually raising (acceptable — that *is* the
  feature); needs duplicate prevention (partial unique index on
  `(queueId, userExternalId) WHERE status <> 'done'`).
- **Complexity:** Low-medium.
- **Risks:** stale entries if a user leaves without lowering — solved by the
  voice-leave handler.
- **Discord-compatibility:** Full.
- **Testability:** High (enqueue/dequeue/ordering are pure DB-backed logic).
- **Non-technical ease:** High.
- **Verdict:** **CORE.** Self-managed + moderator-advance is the right division of
  labour.

### 1.9 Voice-channel integration (move / mute)

- **How it works:** the bot would **server-mute** non-active speakers (needs
  `Mute Members`) and/or **move** members between VCs / disconnect them (needs
  `Move Members`), enforcing the queue by actually controlling who can be heard.
- **Pros:** "hard" enforcement — only the active speaker is audible.
- **Cons (disqualifying for MVP):**
  1. **Invasive.** Server-mute and forced moves change the room's social contract
     and require granting the bot two of Discord's most powerful voice
     permissions. Server-mute persists until explicitly cleared — a crash mid-turn
     can leave members muted.
  2. **Operational risk.** A bug, a permission/hierarchy gap, or a restart can
     strand the room muted or shuffled.
  3. **Not needed** for an explicit raise-hand queue — the queue communicates
     *order*; humans honour it. Enforcement is a separate, heavier feature.
- **Complexity:** High (lifecycle of mute/unmute, failure recovery, hierarchy).
- **Risks:** High (member-visible side effects; cleanup correctness).
- **Discord-compatibility:** Possible (`Mute Members` / `Move Members` exist) but
  deliberately **out of scope**.
- **Testability:** Low-medium (real voice-state side effects).
- **Non-technical ease:** N/A (it's automatic, but scary when it misfires).
- **Verdict:** **REJECTED for MVP**; documented in `future-roadmap.md` as opt-in.

---

## 2. Capability matrix — what the Discord API + discord.js v14 DO / DO NOT allow

All rows below are web-verified (sources in §4) and reconciled against the brief.
discord.js pinned here is **`^14.26`** with **`@discordjs/voice ^0.19`**
(`pnpm-workspace.yaml` catalog).

| Capability | Supported? | Detail / constraint | Used by this design? |
|---|---|---|---|
| **Read voice state** (who is in which VC; join/leave/move) | ✅ Yes | Needs `GatewayIntentBits.GuildVoiceStates`, which is **NOT a privileged intent** — no Developer-Portal toggle, no verification. The adapter already requests it (`adapter.ts:71-76`). | ✅ Core — leave/move detection |
| **`VoiceStateUpdate` gateway event** | ✅ Yes | Fires on join/leave/move/mute/deafen for guild members when `GuildVoiceStates` is enabled. We add a `voice.state.update` platform event carrying `oldChannelId`/`newChannelId`. | ✅ Core |
| **Detect who is *speaking* (voice activity)** | ⚠️ Technically exists, **not viable** | A `speaking` start/end signal exists only over a **voice-RECEIVE** connection (bot must join the VC + use the `@discordjs/voice` receiver). It is privacy-invasive, discouraged, and — critically for **`@discordjs/voice ^0.19`** — **broken by Discord's DAVE end-to-end encryption** (now enforced on all voice channels): receive enters reconnect loops and captures zero audio, so `speaking` never fires. | ❌ **Excluded** — queue is explicit, not voice-activity-driven |
| **Slash commands** (guild-only, options, subcommands) | ✅ Yes | Core. `CommandDefinition[]` already maps cleanly. | ✅ |
| **Ephemeral replies / embeds** | ✅ Yes | Core. | ✅ |
| **Buttons / select menus** (message components) | ✅ Yes | Action-row limits: **5 buttons per row, 5 rows per message → 25 buttons max**; a select menu occupies a whole row (1 per row). | ✅ (buttons; select optional) |
| **Gate a slash command by permission** | ✅ Yes | `default_member_permissions` — Discord **hides** the command from members who lack the permission and blocks execution (Administrator bypasses). Known historical flakiness exists, so we still re-validate server-side for safety. | ✅ `['MuteMembers']` on mod cmds |
| **Gate a *button/select* by permission** | ❌ No | Discord has **no** per-permission filter for message components — anyone who sees the message can click. Long-standing feature request, still unimplemented. **Must** re-check in code. | ✅ server-side re-check |
| **Order control** (deterministic queue order) | ✅ Yes (our DB) | Discord gives no ordering primitive; we own it: `ORDER BY priority DESC, raisedAt ASC` in `speaker_queue_entries`. | ✅ Core |
| **Server mute / deafen a member** | ✅ Yes, needs `Mute Members` | Persists until cleared; member-visible; invasive. | ❌ Out of MVP |
| **Move / disconnect a member between VCs** | ✅ Yes, needs `Move Members` | Can move into channels they cannot join, or disconnect them. Invasive. | ❌ Out of MVP |
| **Send / edit / delete messages** (live panel) | ✅ Yes | Needs Send Messages, Embed Links, View Channel, Read Message History. Already in `GuildService`. | ✅ Core |
| **Allowed-mentions scoping** (ping only the next speaker) | ✅ Yes | We limit mentions to the single target user when announcing "next to speak". | ✅ Core |

### Adversarial reconciliation (claim-by-claim vs. the brief)

- **Brief:** "CANNOT reliably auto-detect who is speaking." **Verified — and
  stronger than stated.** A `speaking` event *does* exist in `@discordjs/voice`,
  so the literal word "cannot" is imprecise; but in practice it requires a
  voice-receive connection that is privacy-invasive, discouraged, and — on the
  repo's pinned **`@discordjs/voice ^0.19`** under Discord's now-mandatory **DAVE
  E2EE** — effectively non-functional (reconnect loops, zero capture). So the
  design conclusion (no speaking-detection in MVP) is **correct and reinforced**;
  the doc states it as "exists but not viable" rather than a flat "cannot".
- **Brief:** "`GuildVoiceStates` needs no privileged intent." **Verified.** Only
  `GuildMembers`, `GuildPresences`, and `MessageContent` are privileged.
- **Brief:** "`default_member_permissions` hides the command from members who lack
  the permission." **Verified**, with the caveat that Discord has shipped bugs in
  this field over time — hence the additional server-side re-check on the buttons
  (and the slash handlers still operate on the mod's own VC, so even a leaked
  command can only touch a room the mod is in).
- **Brief:** "Buttons cannot be permission-gated by Discord." **Verified** —
  no component-level permission filter exists; server-side gating is mandatory.
- **Brief:** "5 buttons/row, 5 rows." **Verified** (25 buttons max; one select
  per row). The panel uses well under one row, so we are far inside limits.
- **Brief:** "Mute Members / Move Members are powerful and out of MVP scope."
  **Verified** — both exist and both are invasive; correctly deferred.

No source **contradicted** the locked design. The only nuance is the wording
around speaking-detection ("exists but unusable" vs "cannot"), captured above.

---

## 3. Recommendation — the locked hybrid design

**Recommended (and locked):** a **hybrid** of
**slash commands (primary) + a persistent button control panel + a self-managed
queue + moderator controls**, with **persistent Postgres/Drizzle state** and a new
additive **`voice.state.update`** event for leave/move handling. This is exactly
methods **1.1 + 1.2 + 1.3 + 1.7 + 1.8**, with **1.4** (select) deferred as
optional and **1.5** (reactions), **1.6** (text-only panel), **1.9** (voice
move/mute) rejected for MVP.

### Why this fits THIS codebase (not a generic recommendation)

1. **It reuses proven patterns verbatim.** The button panel is the **role-menus**
   pattern: a posted message whose components route through the existing
   `component.interaction` event by `customId` prefix
   (`rolemenu:…` → `rh:<action>:<vcId>`), with `event.update()` /
   `GuildService.editMessage` to refresh the live embed. No new interaction
   machinery is invented. (`packages/role-menus-module/src/service.ts`,
   `logic.ts`.)
2. **The required intent is already on.** Voice-leave detection needs
   `GuildVoiceStates`, which the Discord adapter **already** requests by default
   (`adapter.ts:71-76`) — so the only platform addition is mapping
   `Events.VoiceStateUpdate` to the new `voice.state.update` event. No privileged
   intent, no Developer-Portal change.
3. **Permissions match the platform's grain.** Slash mod-commands gate via
   `default_member_permissions: ['MuteMembers']` (Discord hides them from
   non-mods); because Discord **cannot** gate buttons, the moderator buttons are
   re-checked server-side with a new additive
   `GuildService.memberHasPermission(userExternalId, 'MuteMembers')` (plus
   `isGuildOwner`). This mirrors the repo's existing dual model (Discord gating +
   server-side RBAC re-check).
4. **Persistence is the house style.** Every DB module owns a `repo.ts` over the
   single `schema.ts`; `speaker_queues` + `speaker_queue_entries` follow the same
   uuid-PK / `guildId` FK-cascade / timestamptz conventions, with deterministic
   ordering (`priority DESC, raisedAt ASC`) and a partial unique index for
   duplicate prevention. State survives restart like the rest of the platform.
5. **It is testable inside the existing harness.** Enqueue/dequeue/advance/order,
   `customId` parsing, the embed renderer, and the authorization predicate are all
   **pure** and unit-testable with mocked contexts — exactly how role-menus tests
   its `logic.ts`/`service.ts`. Only the live panel edit + real VC leave need
   integration/manual verification.
6. **It refuses what the platform can't honour.** No speaking-detection (broken on
   `@discordjs/voice ^0.19` + DAVE) and no forced mute/move (invasive, `Mute
   Members`/`Move Members`). The queue communicates **order**; humans honour it.

### What we explicitly do NOT recommend for MVP

- Anything depending on **speaking detection** / voice-receive (privacy, DAVE
  breakage, reliability).
- Anything depending on **forced server-mute or moving members** (invasive,
  powerful permissions, crash-cleanup risk).
- **Reaction-driven** queueing (no reaction event in core; unordered; desync).

These remain documented in
[`raise-hand/future-roadmap.md`](../raise-hand/future-roadmap.md) as opt-in
extensions, never as MVP defaults.

---

## 4. Sources (web-verified)

- discord.js voice — receiving audio / `speaking` event & limitations:
  <https://v12.discordjs.guide/voice/receiving-audio.html>,
  <https://discord.js.org/docs/packages/voice/main>
- `@discordjs/voice 0.19.x` DAVE E2EE breaks audio receive (reconnect loops, zero
  capture; `speaking` never fires):
  <https://github.com/discordjs/discord.js/issues/11419>
- Discord enforcing DAVE E2EE on all voice channels (timeline):
  <https://github.com/discord/dave-protocol>,
  <https://www.bleepingcomputer.com/news/security/discord-rolls-out-end-to-end-encryption-on-voice-video-calls/>
- Privileged intents list (`GuildVoiceStates` is NOT privileged):
  <https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents>,
  <https://discordjs.guide/legacy/popular-topics/intents>
- `GuildVoiceStates` intent required for `VoiceStateUpdate`:
  <https://github.com/discord/discord-api-docs/issues/1724>
- `default_member_permissions` hides commands from members lacking the permission
  (and known flakiness):
  <https://discordjs.guide/slash-commands/permissions>,
  <https://support-apps.discord.com/hc/en-us/articles/26501869403159-Command-Permissions>,
  <https://github.com/discord/discord-api-docs/issues/4959>
- No per-permission gating for message components (buttons):
  <https://github.com/discord/discord-api-docs/issues/3115>,
  <https://github.com/discord/discord-api-docs/discussions/4490>
- Action-row limits (5 buttons/row, 5 rows, 1 select/row):
  <https://discordjs.guide/interactive-components/action-rows.html>,
  <https://discord.com/developers/docs/components/reference>
- `Mute Members` / `Move Members` permission semantics:
  <https://discord.com/community/permissions-on-discord-discord>,
  <https://support.discord.com/hc/en-us/articles/206029707-Setting-Up-Permissions-FAQ>

---

## Checkpoint

Status: PASS

### Validat
- All nine candidate UX methods compared on how-it-works / pros / cons /
  complexity / risks / Discord-compatibility / testability / non-technical ease.
- Capability matrix web-verified for: voice-state read, `VoiceStateUpdate` +
  `GuildVoiceStates` (non-privileged), speaking-detection (exists but unusable on
  `@discordjs/voice ^0.19` under DAVE), slash `default_member_permissions`
  (hides commands), buttons NOT permission-gateable, component limits
  (5×5 = 25, 1 select/row), `Mute Members`/`Move Members` semantics. Sources cited.
- Adversarial check completed: no source contradicts the locked design; the only
  nuance (speaking event *exists* but is non-viable) is documented and the
  conclusion stands (reinforced by the DAVE breakage on the repo's pinned voice
  version).
- Recommendation = the locked hybrid (slash + button panel + self-managed queue +
  moderator controls + persistent state + `voice.state.update`), justified against
  role-menus/component pattern, the already-enabled `GuildVoiceStates` intent, the
  repo's persistence + permission conventions, and its test harness.
- User-facing overview written to
  [`docs/raise-hand/raise-hand-overview.md`](../raise-hand/raise-hand-overview.md).

### Nevalidat
- No code run (read-only research agent; host has no Node; Docker validation is
  Agents 6–7's job).
- Live behaviour of `default_member_permissions` and real `VoiceStateUpdate`
  delivery not observed against a live guild this session (token risk per
  `00-orchestrator-plan.md` §6.2) — relied on official docs + adapter source.
- Exact `@discordjs/voice ^0.19` resolved version in this repo's lockfile not
  re-read line-by-line; DAVE-breakage conclusion is from the upstream issue
  matching the `0.19.x` pin and is used only to *exclude* a feature we already
  reject.

### Probleme
- `default_member_permissions` has a documented history of edge-case bugs →
  mitigated by the mandatory server-side re-check on buttons and the in-VC scoping
  of moderator commands.
- Buttons cannot be Discord-gated → server-side `memberHasPermission` re-check is
  load-bearing; a missing check would expose Next/Clear to everyone. Flagged for
  Agents 4 and 6 to enforce.

### Următorul agent poate continua?
Da. The UX trade-space and the platform-capability boundaries are settled and
cited; the locked hybrid is justified against this codebase. Agent 3 (feature
design) and Agent 4 (permissions/capabilities) can build directly on §1–§3 without
re-deriving the Discord facts. Agent 6 must implement the server-side button
re-check exactly as specified (it is the one place the platform offers no safety
net).
