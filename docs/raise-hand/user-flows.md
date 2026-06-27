# Speaker Queue — User Flows

Step-by-step flows for **normal members** (no special permissions) using the
Speaker Queue feature (module `raise-hand`). Every flow shows the exact bot
response. Where a flow has both a slash command and a control-panel button, both
are listed.

The queue is **per voice channel**: every action below targets the queue of the
voice channel **you are currently in**. See
[`queue-and-priority-rules.md`](queue-and-priority-rules.md) for the ordering
rules and [`moderator-flows.md`](moderator-flows.md) for moderator actions.

All replies to members are **ephemeral** (only you see them) unless stated
otherwise.

---

## 1. Raise your hand (you are in a voice channel)

**Slash command:** `/raise-hand`
**Panel button:** **Raise Hand** (`rh:raise:<vcId>`)

1. Join the voice channel where the discussion is happening.
2. Run `/raise-hand`, or click **Raise Hand** on the control panel for that VC.
3. The bot reads your current voice channel (`getUserVoiceChannel()`), finds (or
   creates) that VC's queue, and adds you as a `waiting` entry.
4. The bot replies with your position:
   > "✋ Hand raised — you're position 4 of 6."
5. If a panel exists for that VC, it refreshes to show you in the ordered
   waiting list.

You are now waiting your turn. You keep your place until you are advanced to
speaker, you lower your hand, a moderator removes you, or you leave the VC.

---

## 2. Raise your hand (you are NOT in a voice channel) — error

**Slash command:** `/raise-hand`
**Panel button:** **Raise Hand**

1. You are not connected to any voice channel.
2. You run `/raise-hand` (or click **Raise Hand**).
3. The bot finds no current voice channel for you.
4. The bot replies:
   > "Join a voice channel first."
5. **No** queue entry is created.

To fix: join the voice channel, then raise your hand again.

---

## 3. Raise your hand twice (idempotent — reports your position)

**Slash command:** `/raise-hand` (run again)
**Panel button:** **Raise Hand** (clicked again)

1. You already have a hand raised in this VC (a `waiting` entry).
2. You run `/raise-hand` again (or click **Raise Hand** again).
3. The bot does **not** add a second entry — a member can only be in a queue
   once (enforced by a partial unique index).
4. The bot replies with your **current** position:
   > "You're already in the queue — position 2 of 5."

Re-raising is therefore a safe way to check your place without a separate
command. (If you are currently the **active speaker**, see flow 6.)

---

## 4. View the queue

**Slash command:** `/speaker-queue`
**Panel button:** **Show Queue** (`rh:show:<vcId>`)

1. You are in (or were last in) the relevant voice channel.
2. Run `/speaker-queue`, or click **Show Queue** on the panel.
3. The bot loads the queue for that voice channel and replies (ephemerally) with:
   - the **current speaker** (the one `active` entry), if any, and
   - the **ordered waiting list** (`priority DESC, raised at ASC`), with each
     member's position.
   Example:
   > 🎤 **Now speaking:** Dana
   > **Waiting:**
   > 1. Alex
   > 2. Sam
   > 3. You
4. If the queue is empty, the bot replies:
   > "The queue for this voice channel is empty."

`/speaker-queue` is read-only — it never changes your place.

---

## 5. Lower your hand (leave the queue)

**Slash command:** `/lower-hand`
**Panel button:** **Lower Hand** (`rh:lower:<vcId>`)

1. You currently have a hand raised (or are the active speaker) in this VC.
2. Run `/lower-hand`, or click **Lower Hand** on the panel.
3. The bot removes your entry from that VC's queue.
4. The bot replies:
   > "✅ Hand lowered — you've left the queue."
5. The panel (if any) refreshes; everyone behind you moves up one position.
6. If you were **not** in the queue, the bot replies:
   > "You're not in the queue."

---

## 6. Become the active speaker

You do **not** promote yourself — a moderator advances the queue. This flow shows
what *you* experience when your turn comes.

1. You are at (or near) the front of the `waiting` list.
2. A moderator runs `/next-speaker` or clicks **Next Speaker**.
3. The bot marks the previous speaker `done` and marks the **top waiting entry**
   (you, if you're first) as `active`.
4. The bot **announces** in the panel channel (a normal, non-ephemeral message,
   mentioning only you):
   > "🎤 @You is next to speak."
5. The panel refreshes to show you as **Now speaking**.
6. While you hold the floor:
   - Running `/raise-hand` replies: *"You're the current speaker."*
   - When you're finished, the moderator advances again, or you can step down
     with `/lower-hand` / **Lower Hand**.

---

## 7. Leave the voice channel while queued (auto-removed)

This is automatic — there is no command.

1. You have a raised hand (or are the active speaker) in a voice channel.
2. You **disconnect** from that voice channel, or **move** to a different one.
3. Discord sends a voice-state update; the bot receives it as a
   `voice.state.update` event (your `oldChannelId` is the VC you left).
4. The bot removes your entry from the **queue of the channel you left** and
   refreshes that channel's panel.
5. No message is sent to you (you left the room) — but anyone viewing the panel
   or running `/speaker-queue` will see you are gone and the list has shifted up.

Notes:
- Leaving a VC is treated as **lowering your hand** for that VC.
- If you **moved** to another voice channel, you are removed from the old VC's
  queue only; to be queued in the new VC, raise your hand again there.
- If you left while you were the **active speaker**, your slot is cleared; a
  moderator advances to the next speaker when ready.
- If the bot was **offline** at the moment you left, that one state change is not
  delivered; you may still appear queued until you trigger another voice change
  or a moderator removes you.
