# Speaker Queue — Permissions & Setup

The **Speaker Queue** module (module key `raise-hand`) gives a voice channel an
orderly, explicit **raise-hand queue**: members run `/raise-hand` (or press a
button on a control panel) to ask to speak, moderators advance the queue with
`/next-speaker`, and the bot announces who's next.

This page is for **server admins**: which permissions to grant the bot when you
invite it, and how to set up which members count as "moderators". For how the
commands behave, see the other pages under `docs/raise-hand/`.

> **Good news up front:** this module needs **no privileged intents** and **no
> invasive voice permissions**. The bot never joins your voice channel, never
> mutes anyone, and never moves anyone. It only *reads* who is in a voice channel
> and *posts* messages.

---

## 1. Bot permissions to grant (invite time)

When you generate the bot's invite link (Discord Developer Portal → your app →
**OAuth2 → URL Generator**, scopes `bot` + `applications.commands`), tick exactly
these four permissions:

| Permission | Why the bot needs it |
| --- | --- |
| **View Channel** | To see the voice channel (read who's in it) and the text channel where the panel/announcements go |
| **Send Messages** | To post the control panel and the "🎤 next to speak" announcement |
| **Embed Links** | To render the panel embed (the live, ordered queue + current speaker) |
| **Read Message History** | To find and update (refresh) its own panel message after each change |

That is the **entire** required set. You do **not** need to grant the bot
Connect, Speak, Mute Members, Move Members, or Deafen Members (see §4).

### Per-channel check

OAuth permissions are server-wide defaults; Discord still applies **channel
overrides**. After inviting the bot:

1. In the **text channel** where you'll post the panel, make sure the bot's role
   has **View Channel**, **Send Messages**, **Embed Links**, and **Read Message
   History** (not denied by a category/channel override).
2. In each **voice channel** you want to manage, make sure the bot's role has
   **View Channel** — otherwise it can't read who is in that VC, and auto-removal
   of people who leave won't work.

If the panel doesn't appear after `/speaker-panel`, the bot is almost always
missing **Send Messages** or **Embed Links** in that text channel.

---

## 2. Who can run what (user permissions)

There are two tiers of commands.

### Everyone

Open to all members. No special role needed.

| Command / button | Notes |
| --- | --- |
| `/raise-hand` | You must be **in a voice channel** first, otherwise you'll see *"Join a voice channel first."* |
| `/lower-hand` | Removes you from the queue |
| `/speaker-queue` | Shows the current order (only you see it) |
| Panel buttons **Raise Hand / Lower Hand / Show Queue** | Same as the commands above |

### Moderators

These manage the queue and are restricted:

| Command / button | What it does |
| --- | --- |
| `/next-speaker` | Marks the current speaker done and promotes the next person |
| `/remove-speaker @user` | Removes someone from the queue |
| `/clear-speaker-queue` | Empties the queue |
| `/promote-speaker @user` | Jumps someone to the front |
| `/speaker-panel` | Posts the button control panel in the current channel |
| Panel buttons **Next Speaker / Clear Queue** | Moderator-only buttons on the panel |

A member counts as a **moderator** for this module if they have Discord's
**Mute Members** permission — **or** they are the **server owner** (the owner can
always use everything).

> **Why "Mute Members"?** It's Discord's natural "manages who may speak in voice"
> permission, so it's a sensible signal for "may manage the speaking queue".
> Granting it does **not** make the bot mute anyone — the bot never mutes. It is
> purely the flag that marks a member as a queue moderator.

Moderators must also be **in the voice channel they're managing** when they run a
moderator command, otherwise they'll see *"Join the voice channel you want to
manage."*

---

## 3. Setting up moderators

You have two easy options.

**Option A — use an existing mod role.** If your staff/mod role already has
**Mute Members**, you're done; those members can already manage the queue.

**Option B — grant Mute Members to a role.** Server Settings → **Roles** → pick
the role → **Permissions** → enable **Mute Members** → Save. Anyone with that role
is now a queue moderator.

### Fine-tuning per command (optional)

Because the moderator commands ship with Discord's "default member permissions"
set to **Mute Members**, Discord automatically **hides** them from members who
lack that permission. If you want a *different* rule for a specific command, an
admin can override it in **Server Settings → Integrations → [the bot] →
Command Permissions**, where you can allow/deny a command per role or per channel.

---

## 4. What the bot deliberately does NOT do

By design, this module avoids invasive voice permissions. The following are
**out of scope** and the bot will never ask for or use them:

| Permission | Would be for | Why it's excluded |
| --- | --- | --- |
| **Connect / Speak** | Joining the voice channel | The bot never joins — it only *reads* voice state |
| **Mute Members** *(as a bot action)* | Force-muting non-speakers | Too invasive; the queue is cooperative, not enforced. *(It's still used as the **user** flag for who counts as a moderator — that needs nothing from the bot.)* |
| **Move Members** | Moving people between channels | Too invasive / surprising |
| **Deafen Members** | Server-deafening people | Not part of the feature |

The bot also can't (and won't try to) automatically detect *who is talking* —
that would require it to join and listen to the call, which is unreliable and a
privacy concern. The queue is always an **explicit** raise-hand list.

---

## 5. Quick setup checklist

1. Invite the bot with **View Channel + Send Messages + Embed Links + Read
   Message History**.
2. Confirm those four permissions aren't denied by an override in your panel
   **text channel**, and that the bot has **View Channel** on the **voice
   channels** you'll manage.
3. Make sure your moderator role has **Mute Members** (or rely on the server
   owner).
4. In the text channel of your choice, a moderator runs **`/speaker-panel`**
   while sitting in the voice channel to manage.
5. Members run **`/raise-hand`** (or press **Raise Hand**) while in that voice
   channel. Moderators advance with **`/next-speaker`** (or **Next Speaker**).

If something doesn't work, check (in order): bot **Send Messages/Embed Links** in
the text channel → bot **View Channel** on the voice channel → moderator has
**Mute Members** and is **in the voice channel** they're trying to manage.
