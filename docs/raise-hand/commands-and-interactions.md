# Speaker Queue — Commands & Interactions

The exact commands, options, permissions and button interactions as shipped.
Module key: `raise-hand` (name "Speaker Queue"). All commands are **guild-only**
and reply **ephemerally** (only you see the response).

## Slash commands

| Command | Who | Options | What it does |
|---|---|---|---|
| `/raise-hand` | Everyone | — | Adds you to the speaking queue **for the voice channel you are in**. Idempotent — running it again tells you your current position. |
| `/lower-hand` | Everyone | — | Removes you from the queue for your current voice channel. |
| `/speaker-queue` | Everyone | — | Shows the current speaker and the ordered waiting list for your voice channel. |
| `/next-speaker` | Moderator¹ | — | Marks the current speaker done, promotes the front of the queue to **active**, and posts a "🎤 next to speak" announcement. |
| `/remove-speaker` | Moderator¹ | `user` (required) | Removes the chosen member from the queue. |
| `/clear-speaker-queue` | Moderator¹ | — | Clears the entire queue for your voice channel. |
| `/promote-speaker` | Moderator¹ | `user` (required) | Moves the chosen member to the **front** of the waiting list (priority bump). |
| `/speaker-panel` | Moderator¹ | — | Posts the persistent button control panel in the current text channel, bound to your voice channel. |

¹ **Moderator** = a member with the Discord **Mute Members** permission, or the
guild owner. Moderator slash commands are gated by Discord
`default_member_permissions: ['MuteMembers']`, so they are hidden from members who
lack it.

**"Your voice channel"**: every command resolves the voice channel from the
caller's *current* voice state (`CommandContext.voice.getUserVoiceChannel()`).
If you are not in a voice channel:
- `/raise-hand` → "Join a voice channel first, then raise your hand."
- moderator commands → "Join the voice channel you want to manage, then run this
  command."

## Control panel buttons

`/speaker-panel` posts an embed listing the live queue plus five buttons. Each
button's `customId` is `rh:<action>:<voiceChannelId>`, so the panel keeps working
after a bot restart (the handler re-reads state from the database).

| Button | `customId` | Who | Action |
|---|---|---|---|
| 🙋 Raise Hand | `rh:raise:<vc>` | Everyone | Same as `/raise-hand` for the panel's voice channel. |
| ✋ Lower Hand | `rh:lower:<vc>` | Everyone | Same as `/lower-hand`. |
| 📋 Show Queue | `rh:show:<vc>` | Everyone | Ephemeral queue snapshot. |
| ⏭️ Next Speaker | `rh:next:<vc>` | Moderator | Same as `/next-speaker`. **Re-checked server-side.** |
| 🧹 Clear | `rh:clear:<vc>` | Moderator | Same as `/clear-speaker-queue`. **Re-checked server-side.** |

**Why the server-side re-check matters:** Discord can hide *commands* by
permission but cannot gate *buttons* — anyone who can see the panel can click any
button. So Next/Clear re-verify the clicker with
`GuildService.memberHasPermission('MuteMembers')` (or guild owner); a member
without permission gets "Only moderators (Mute Members) can use that control."

After any change, the panel embed is edited in place to show the new order, and
advancing posts a separate "🎤 @user is next to speak" message in the panel
channel (pinging only that user).

> **Known limitation:** the panel **Raise Hand** button does not verify the
> clicker is physically inside the bound voice channel (the slash `/raise-hand`
> does). Someone viewing the panel could queue without being in the VC; a
> moderator can `/remove-speaker` them, and they are auto-removed if they were in
> the VC and later leave. Verifying VC presence on the button is on the roadmap.

## Interaction flow (under the hood)

1. **Slash command** → Discord `InteractionCreate` → adapter `buildCommandContext`
   → kernel dispatcher → the module's `execute(ctx)` → `SpeakerQueueService`.
2. **Button click** → Discord `InteractionCreate` (component) → adapter emits a
   `component.interaction` `PlatformEvent` (carrying `customId`, `userRoleIds`,
   `reply`, `update`) → the module's `handleInteraction` parses `rh:<action>:<vc>`
   and dispatches.
3. **Leaving a voice channel** → Discord `VoiceStateUpdate` → adapter emits the
   new `voice.state.update` `PlatformEvent` → the module's `handleVoiceState`
   removes the user from the queue of the channel they left and refreshes the
   panel.

All persistence is in Postgres (`speaker_queues`, `speaker_queue_entries`), so the
queue and panel survive a bot restart. See
[`queue-and-priority-rules.md`](queue-and-priority-rules.md) for ordering and
status rules and [`permissions.md`](permissions.md) for the permission model.
