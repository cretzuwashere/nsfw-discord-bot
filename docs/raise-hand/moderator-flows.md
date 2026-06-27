# Speaker Queue — Moderator Flows

Step-by-step flows for **moderators** managing a Speaker Queue (module
`raise-hand`). Each flow states the permission requirement and the
"must be in the VC you manage" rule, and shows the exact bot response.

See [`user-flows.md`](user-flows.md) for normal-member flows,
[`queue-and-priority-rules.md`](queue-and-priority-rules.md) for ordering and
lifecycle, and [`permissions.md`](permissions.md) for the full permission model.

---

## Permission requirement (applies to every flow here)

Every moderator command and every moderator button requires **one** of:

- the **Mute Members** Discord permission (`MuteMembers`), **or**
- being the **guild owner** (always allowed).

How it is enforced:

- **Slash commands** carry `defaultMemberPermissions: ['MuteMembers']`, so
  Discord hides/blocks them for members without the permission. The bot does not
  actually mute anyone — `Mute Members` is used purely as the "manage who speaks"
  gate.
- **Panel buttons** (**Next Speaker**, **Clear Queue**) cannot be gated by
  Discord per-permission, so they are **re-checked server-side** before acting:
  `memberHasPermission(userExternalId, 'MuteMembers')` **OR** `isGuildOwner`. A
  member without permission who clicks a moderator button is refused:
  > "You need the Mute Members permission to do that."

## "Must be in the VC you manage" (applies to every flow here)

Every moderator action operates on the **voice channel the moderator is currently
in**, read via `ctx.voice.getUserVoiceChannel()`. If the moderator is **not** in
any voice channel, the action is refused:
> "Join the voice channel you want to manage."

This guarantees a moderator can only manage a room they are present in. (The
guild owner must also be in the VC to manage it.)

---

## 1. View / manage the queue

**Slash command:** `/speaker-queue` (read-only, available to everyone including
moderators)

1. Join the voice channel you want to manage.
2. Run `/speaker-queue` to see the current speaker and the ordered waiting list
   for that VC (ephemeral). This is the same read-only view members get.
3. From here you decide whether to advance, remove, promote, or clear (below).
   For an always-visible, button-driven view, post the control panel (flow 6).

---

## 2. Advance to the next speaker

**Slash command:** `/next-speaker`
**Panel button:** **Next Speaker** (`rh:next:<vcId>`)

- **Permission:** Mute Members or guild owner.
- **Location:** must be in the VC you manage.

1. Be connected to the voice channel whose queue you're running.
2. Run `/next-speaker`, or click **Next Speaker** on that VC's panel.
3. The bot:
   - marks the current `active` speaker (if any) as `done`, and
   - promotes the **top `waiting`** entry (`priority DESC, raised at ASC`) to
     `active`.
4. The bot **announces** in the panel/announce channel (a normal message
   mentioning only the new speaker):
   > "🎤 @NextPerson is next to speak."
5. The panel refreshes: new speaker under **Now speaking**, everyone else shifts
   up.
6. Edge cases:
   - If no one is waiting, the bot replies: *"No one is waiting in the queue."*
     (the previous speaker is still marked `done`, leaving the floor open).
   - If you are not in a VC: *"Join the voice channel you want to manage."*

---

## 3. Remove a specific speaker

**Slash command:** `/remove-speaker user:@u`

- **Permission:** Mute Members or guild owner.
- **Location:** must be in the VC you manage.

1. Be connected to the voice channel you're managing.
2. Run `/remove-speaker` and pick the member with the `user` option.
3. The bot removes that member's entry (`waiting` or `active`) from **this VC's**
   queue.
4. The bot replies:
   > "Removed @u from the queue."
5. The panel refreshes; positions shift up.
6. If the member was not in this VC's queue:
   > "@u isn't in this queue."

(There is no panel button for removing a *specific* member — removal is done by
slash command so a moderator can pick the exact user.)

---

## 4. Clear the queue

**Slash command:** `/clear-speaker-queue`
**Panel button:** **Clear Queue** (`rh:clear:<vcId>`)

- **Permission:** Mute Members or guild owner.
- **Location:** must be in the VC you manage.

1. Be connected to the voice channel you're managing.
2. Run `/clear-speaker-queue`, or click **Clear Queue** on the panel.
3. The bot removes **all** entries for this VC — waiting, active, and any retained
   `done` rows — leaving an empty queue.
4. The bot replies:
   > "🧹 Cleared the queue for this voice channel."
5. The panel (and its binding) remain so the panel keeps working; it refreshes to
   the empty state.

Use this between sessions or to reset after a disorganized round.

---

## 5. Promote a user to the front

**Slash command:** `/promote-speaker user:@u`

- **Permission:** Mute Members or guild owner.
- **Location:** must be in the VC you manage.

1. Be connected to the voice channel you're managing.
2. Run `/promote-speaker` and pick the member with the `user` option.
3. The bot raises that member's `priority` to **above the current maximum** in
   this VC's queue, so they jump to the **front of the `waiting`** group (the one
   `active` speaker is not displaced).
4. The bot replies:
   > "⏫ Promoted @u to the front of the queue."
5. The panel refreshes with the member now at the top of the waiting list.
6. If the member isn't in this VC's queue:
   > "@u isn't in this queue."

Promotion only reorders `waiting` entries; it does not make the member speak
immediately — advance with `/next-speaker` when ready. Promoting a second member
afterward puts **them** ahead of the first (priority above the new maximum). See
[`queue-and-priority-rules.md`](queue-and-priority-rules.md).

---

## 6. Post the control panel

**Slash command:** `/speaker-panel`

- **Permission:** Mute Members or guild owner.
- **Location:** must be in the VC you manage (the panel is **bound** to that VC).

1. Join the voice channel you want the panel to control.
2. Go to the **text channel** where you want the panel to live.
3. Run `/speaker-panel`.
4. The bot posts a persistent embed in the current text channel, bound to your
   current voice channel, and stores `panel_channel_id` + `panel_message_id` (and
   uses that channel as the announce channel). The panel shows:
   - the **current speaker**, and
   - the **live ordered waiting list**.
   With buttons:
   - **Raise Hand** / **Lower Hand** / **Show Queue** — everyone,
   - **Next Speaker** / **Clear Queue** — moderators (re-checked server-side).
5. The panel **auto-refreshes** in place (`event.update()`) after each button
   press and after queue changes (including voice-leave auto-removals).
6. The bot confirms (ephemerally):
   > "Speaker panel posted for this voice channel."

Re-running `/speaker-panel` for the same VC re-binds the panel to the new message
(post it once per VC and leave it pinned).

---

## Quick reference

| Action | Command | Button | Permission |
| --- | --- | --- | --- |
| View queue | `/speaker-queue` | **Show Queue** | everyone |
| Advance speaker | `/next-speaker` | **Next Speaker** | Mute Members / owner |
| Remove a member | `/remove-speaker user:@u` | — | Mute Members / owner |
| Clear queue | `/clear-speaker-queue` | **Clear Queue** | Mute Members / owner |
| Promote to front | `/promote-speaker user:@u` | — | Mute Members / owner |
| Post panel | `/speaker-panel` | — | Mute Members / owner |

All moderator actions additionally require the moderator to be **in the voice
channel they are managing**.
