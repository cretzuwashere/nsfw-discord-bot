# 04 — Permissions & Discord Capabilities (Raise Hand / Speaker Queue)

> Agent: **AGENT 4 — PERMISSIONS & DISCORD CAPABILITIES**
> Date: 2026-06-27
> Repo root: `C:/Projects/Mods/Fable - Mod` (paths below are relative to repo root)
> Feature/module: **Speaker Queue**, key `raise-hand`, package
> `packages/raise-hand-module` (locked design — see
> [`00-orchestrator-plan.md`](00-orchestrator-plan.md) §3).

This is the working-memory + checkpoint file for the permission/capability layer
of the raise-hand feature. The user-facing companion (bot invite + moderator role
setup) is [`docs/raise-hand/permissions.md`](../raise-hand/permissions.md).

Everything below is grounded in source already read this session (citations
inline). Discord-platform limits are noted where they constrain the design.

---

## 1. Two distinct permission planes

The feature has **two unrelated** permission concerns that must not be conflated:

1. **Bot permissions** — what the *bot account* is allowed to do in the guild
   (post the panel, read voice state). Granted at invite time via the OAuth2
   permissions bitfield and adjustable per-channel afterwards.
2. **User authorization** — which *member* may run a given command or press a
   given button. Normal actions are open to everyone; moderator actions are gated
   two ways (Discord `default_member_permissions` for slash visibility +
   server-side re-check for buttons).

These are independent: a member with `MuteMembers` can invoke `/next-speaker`,
but the *bot* still needs `Send Messages` + `Embed Links` to render the result.

---

## 2. Required gateway INTENTS

Intents are connection-level subscriptions requested by the adapter in
`packages/discord-adapter/src/adapter.ts` (lines 71-82). The raise-hand feature
needs **only intents the adapter already requests unconditionally**:

| Intent | Status | Why this feature needs it |
|---|---|---|
| `Guilds` | **Always on** (`adapter.ts:72`) | Receive slash-command invocations and `component.interaction` (button) events; know guild/channel/role topology |
| `GuildVoiceStates` | **Always on** (`adapter.ts:73`) | Read who is in which voice channel (the caller's VC at raise time) and detect leave/move for the new `voice.state.update` event |

Both are **non-privileged** and are in the default intent array
(`adapter.ts:71-76`: `Guilds`, `GuildVoiceStates`, `GuildMessages`,
`GuildModeration`). **No portal toggle, no privileged intent, and no new intent
of any kind is required.**

### Contrast — the two privileged intents this feature does NOT use

`adapter.ts:62-82` documents that the only privileged intents are opt-in and
must be enabled BOTH in code (`config.discord.enableGuildMembers` /
`enableMessageContent`) AND in the Discord developer portal, else the gateway
rejects the connection with close code **4014 "Disallowed intents"**:

- `GuildMembers` — member join/leave + member-based modules. **Not needed:**
  raise-hand identifies users from the interaction itself
  (`ComponentInteractionEvent.user` / `CommandContext.user`), never by listing
  the member set.
- `MessageContent` — content-based automod. **Not needed:** the queue is driven
  by slash commands and buttons, never by reading message text.

> **Ground-truth note:** voice-state reading is commonly assumed to need a
> privileged intent. It does **not** — `GuildVoiceStates` is a standard intent
> and is already enabled. This is the single most important capability fact for
> the feature: the leave/move detection that powers auto-removal from the queue
> is free.

---

## 3. Required BOT permissions

The bot needs a small, non-invasive permission set. These map to entries in the
new module's `metadata.requiredPermissions` (same shape as role-menus'
`['ManageRoles', 'SendMessages']` in `packages/role-menus-module/src/index.ts:45`).
Permission names are the discord.js `PermissionsBitField.Flags` keys — the same
strings `botHasPermission` resolves (`guild-service.ts:257`) and that
`command-mapper.ts:63-70` converts to a bitfield.

### MANDATORY (MVP cannot function without these)

| Permission | Needed for | Consequence if missing |
|---|---|---|
| `ViewChannel` | See the text channel where the panel/announcements post **and** see the voice channel to read its state | Bot can't post or read the VC; panel commands silently no-op |
| `SendMessages` | Post the control panel, the ephemeral-fallback content, and the "🎤 next to speak" announcement | Panel/announce fail; `service.ts`-equivalent reports a post failure |
| `EmbedLinks` | Render the panel embed (live ordered queue + current speaker) and queue listings | Embeds are stripped by Discord; panel shows blank |
| `ReadMessageHistory` | Edit/refresh the existing panel message after each queue change (`editMessage`) | Bot cannot reliably fetch+edit its own panel message to refresh it |

> The panel lives in a **text** channel (posted by `/speaker-panel` in the
> moderator's current text channel). The bot needs the four permissions above
> **in that text channel**. It additionally needs `ViewChannel` on the **voice**
> channel so `GuildVoiceStates` data for that VC is visible to it.

### Voice: read-only, no Connect

Reading voice state (which member is in which VC, join/leave/move) comes from the
`GuildVoiceStates` **intent**, not from a voice **permission**. The bot does
**NOT** join the voice channel and therefore does **NOT** need `Connect` or
`Speak`. It only needs to be able to *see* the voice channel (`ViewChannel`) for
that channel's state to be delivered. This is the deliberate consequence of the
"explicit managed queue, never voice-activity-driven" decision — no voice-receive
connection, so no voice connection permissions.

### OPTIONAL / OUT OF SCOPE (must NOT be requested for MVP)

These would only be needed if a future, explicitly-out-of-scope "forced" mode is
added. They are **invasive** (they change the social contract of the call) and
are excluded by the locked design:

| Permission | Would enable | Why excluded from MVP |
|---|---|---|
| `MuteMembers` (as a **bot** permission) | Server-mute the non-active speakers | Forced server-mute rejected for MVP — too invasive. *(Note: `MuteMembers` is still used as a **user**-side gate; see §4 — that does NOT require the bot to hold it.)* |
| `MoveMembers` | Move/disconnect members between VCs (e.g. a "stage" VC) | Auto-move rejected — invasive, surprising |
| `DeafenMembers` | Server-deafen members | Never part of the design |

**Do not add any of these to `metadata.requiredPermissions`.** The MVP invite
needs only the four mandatory permissions above.

---

## 4. USER-side authorization model

### 4.1 Everyone (no gate)

Open to all members; the only runtime requirement is enforced in the command
logic, not by permissions:

- `/raise-hand` — must be in a VC (`ctx.voice.getUserVoiceChannel()`); else
  "Join a voice channel first."
- `/lower-hand`, `/speaker-queue`
- Panel buttons `rh:raise:<vcId>`, `rh:lower:<vcId>`, `rh:show:<vcId>`

These commands carry **no** `defaultMemberPermissions`, so Discord shows them to
everyone.

### 4.2 Moderator commands — Discord `default_member_permissions`

Gated commands: `/next-speaker`, `/remove-speaker`, `/clear-speaker-queue`,
`/promote-speaker`, `/speaker-panel`. Each declares
`defaultMemberPermissions: ['MuteMembers']` on its `CommandDefinition`
(`packages/core/src/contracts/commands.ts:66-70`).

How it is enforced: `command-mapper.ts:55-56` converts that array via
`permissionsToBitfield` (`command-mapper.ts:63-70`) into Discord's
`default_member_permissions` string at registration time. **Discord then hides
the command from, and rejects invocation by, members lacking `Mute Members`** (a
guild admin can override per-command in Server Settings → Integrations).

`MuteMembers` is chosen as the natural "manages who may speak" capability. It is a
**user gate only** — it does **NOT** require the bot to hold `Mute Members`, and
the bot never actually mutes anyone (§3).

Additionally, moderator commands require the moderator to be **in the voice
channel they are managing** (checked via `ctx.voice.getUserVoiceChannel()`); else
"Join the voice channel you want to manage." The **guild owner is always
allowed** (`isGuildOwner`, `guild-service.ts:273`), independent of roles.

### 4.3 Why `default_member_permissions` does NOT secure buttons

`default_member_permissions` gates **only the slash-command surface**. Discord
applies it when deciding who can *see and invoke a slash command*. It has **no
effect on message components** — a button posted in a channel is clickable by
**anyone who can see the message**. There is no per-permission gate on buttons in
the Discord API.

So the moderator buttons on the panel (`rh:next:<vcId>`, `rh:clear:<vcId>`) would,
without extra work, be pressable by any member who can view the panel. That is
the gap.

### 4.4 How the server-side re-check closes the gap

When a `component.interaction` arrives, the handler **re-derives** authorization
server-side instead of trusting Discord's (absent) gate:

> The presser is authorized for a moderator button iff
> `memberHasPermission(userExternalId, 'MuteMembers') === true`
> **OR** `isGuildOwner(userExternalId) === true`.

- `isGuildOwner` already exists (`guild-service.ts:273-276`).
- `memberHasPermission(userExternalId, permission)` is the **one additive
  `GuildService` method** this feature adds. It mirrors the existing
  `botHasPermission` (`guild-service.ts:254-265`) but resolves the *invoking
  member* instead of the bot:
  fetch the member, look up
  `PermissionsBitField.Flags[permission]`, return
  `member.permissions.has(flag)` (false if the flag name or member is unknown —
  fail-closed). It is added to the `GuildService` interface
  (`packages/core/src/contracts/guild-service.ts`) and implemented in
  `packages/discord-adapter/src/guild-service.ts`.

If the check fails, the button reply is an ephemeral refusal (e.g. "You need the
Mute Members permission to manage the speaker queue.") and no state changes.
Everyone-buttons (`raise`/`lower`/`show`) skip this check.

> **Why a re-check and not `userRoleIds`:** `ComponentInteractionEvent` does carry
> `userRoleIds`, but role IDs alone don't tell you whether those roles grant
> `Mute Members` (and ignore admin/owner). `memberHasPermission` asks Discord the
> permission question directly, matching how `botHasPermission` already works for
> the bot — single source of truth, fail-closed.

### 4.5 Authorization summary table

| Surface | Audience | Enforcement |
|---|---|---|
| `/raise-hand`, `/lower-hand`, `/speaker-queue` | Everyone | None (in-VC check for raise only) |
| Buttons `rh:raise/lower/show` | Everyone | None |
| `/next-speaker`, `/remove-speaker`, `/clear-speaker-queue`, `/promote-speaker`, `/speaker-panel` | Moderators | Discord `default_member_permissions ['MuteMembers']` + must be in the managed VC |
| Buttons `rh:next`, `rh:clear` | Moderators | **Server-side** `memberHasPermission('MuteMembers') OR isGuildOwner` |
| Any moderator surface | Guild owner | Always allowed (`isGuildOwner`) |

---

## 5. Discord capability constraints that shaped these decisions

(Cross-reference: [`02-discord-raise-hand-research.md`](02-discord-raise-hand-research.md).)

- **CAN** read voice state (join/leave/move/which VC) with `GuildVoiceStates` —
  no privileged intent. Powers the `voice.state.update` auto-removal.
- **CAN** post slash commands, buttons, select menus, embeds, ephemeral replies —
  all already used by the codebase (role-menus, audio).
- **CANNOT** reliably detect who is *speaking* — that needs a voice-RECEIVE
  connection (bot joins VC + `@discordjs/voice` receiver), which is unreliable,
  discouraged, and privacy-invasive. → queue is **explicit raise-hand**, never
  voice-activity-driven. (No permission would fix this; it's an architectural
  constraint.)
- **Buttons cannot be permission-gated by Discord** — hence §4.3/§4.4.

---

## 6. MANDATORY vs OPTIONAL vs MUST-NOT (one-glance)

**MANDATORY (MVP):**
- Intents: `Guilds`, `GuildVoiceStates` (already enabled — no change).
- Bot perms: `ViewChannel`, `SendMessages`, `EmbedLinks`, `ReadMessageHistory`
  (text channel for the panel; `ViewChannel` also on the voice channel).
- User gate: `default_member_permissions ['MuteMembers']` on mod commands.
- Server-side: new `memberHasPermission` + `isGuildOwner` re-check on mod buttons.

**OPTIONAL (roadmap only, NOT MVP):**
- Bot perms `MuteMembers` / `MoveMembers` / `DeafenMembers` — only if a forced
  mute/move mode is ever built. Documented as out-of-scope.

**MUST NOT implement (needs invasive perms / infeasible API):**
- Forced server-mute of non-speakers (needs bot `Mute Members`; invasive).
- Auto-move members between VCs (needs `Move Members`; invasive).
- Speaking-activity auto-detection (needs voice-receive; unreliable + privacy).

**MUST NOT add to the invite:** any voice `Connect`/`Speak` (bot never joins),
or `Mute/Move/Deafen Members`.

---

## 7. Files this layer touches (for Agent 6)

- `packages/core/src/contracts/guild-service.ts` — **add** `memberHasPermission`
  to the `GuildService` interface (additive; do not alter existing signatures).
- `packages/discord-adapter/src/guild-service.ts` — **implement**
  `memberHasPermission` (mirror `botHasPermission` at lines 254-265 but fetch the
  invoking member).
- `packages/raise-hand-module/src/commands.ts` — set
  `defaultMemberPermissions: ['MuteMembers']` on the five moderator commands; the
  three everyone-commands omit it.
- `packages/raise-hand-module/src/service.ts` (panel handler) — re-check
  `memberHasPermission('MuteMembers') || isGuildOwner` before mutating on
  `rh:next` / `rh:clear`.
- `packages/raise-hand-module/src/index.ts` — `metadata.requiredPermissions =
  ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory']`,
  `metadata.requiredIntents = ['Guilds', 'GuildVoiceStates']`.

No adapter intent changes are required (both intents already requested).

---

## Checkpoint

Status: PASS

### Validat
- Intents `Guilds` + `GuildVoiceStates` already in the unconditional default
  array — verified `packages/discord-adapter/src/adapter.ts:71-76`. Privileged
  `GuildMembers`/`MessageContent` are opt-in (lines 62-82); neither is needed.
- `defaultMemberPermissions` is a real `CommandDefinition` field
  (`packages/core/src/contracts/commands.ts:66-70`) and is mapped to Discord
  `default_member_permissions` via `permissionsToBitfield`
  (`packages/discord-adapter/src/command-mapper.ts:55-56, 63-70`).
- `botHasPermission` (`guild-service.ts:254-265`), `getMemberRoleIds`
  (267-271), and `isGuildOwner` (273-276) exist; `memberHasPermission` does
  **not** yet exist — confirming it is additive and can mirror `botHasPermission`.
- Permission names are discord.js `PermissionsBitField.Flags` keys
  (`guild-service.ts:257`, `command-mapper.ts:63-70`).
- Bot-permission metadata shape confirmed against role-menus'
  `metadata.requiredPermissions` (`packages/role-menus-module/src/index.ts:44-48`).
- The bot does not join voice (no voice-receive in the locked design), so no
  `Connect`/`Speak` — consistent with §2/§3 and the orchestrator plan §2.

### Nevalidat
- Live behaviour of `default_member_permissions` hiding commands and the
  server-side button re-check is not runtime-verified (no code exists yet; Agent
  6 implements, Agent 7 validates). The 4014 "Disallowed intents" close-code is
  quoted from the adapter's own inline documentation, not reproduced live.
- Exact wording of the ephemeral refusal messages is suggested, not yet in code.

### Probleme
- `memberHasPermission` is an additive change to the shared `GuildService`
  contract/adapter — must be regression-checked so existing modules are
  unaffected (interface addition only; no existing signature changes).
- `register-commands.ts` is a manual mirror; if the new module's
  `defaultMemberPermissions` are to register, the module must be added there
  (out of this doc's scope — Agent 6 wiring).

### Următorul agent poate continua?
Da. The intent requirement (none new), the mandatory/optional/forbidden bot
permission set, the user-side gate (`default_member_permissions ['MuteMembers']`),
the button-security gap and its server-side `memberHasPermission || isGuildOwner`
fix, and the exact files to touch are all specified and grounded in source. Agent
5 (implementation plan) and Agent 6 (implementation) can proceed without
re-deriving the permission model.
