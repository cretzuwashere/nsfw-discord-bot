# Speaker Queue — Queue & Priority Rules

The precise rules that govern a Speaker Queue (module `raise-hand`): how entries
are ordered, how priority works, how duplicates are prevented, the single-active-
speaker rule, the meaning of each status, the lifecycle transitions, what happens
to finished entries, and how queues are scoped.

Companion docs: [`user-flows.md`](user-flows.md),
[`moderator-flows.md`](moderator-flows.md), and the functional spec
[`../agent-memory/03-feature-design.md`](../agent-memory/03-feature-design.md).

---

## Scope: one queue per (guild, voice channel)

- A queue belongs to a **single `(guild, voice channel)` pair**. This is enforced
  by `unique(guild_id, voice_channel_id)` on the `speaker_queues` table — there is
  at most one queue row per voice channel.
- A raised hand is **tied to the voice channel the member was in** when they
  raised it. Two voice channels in the same server are two independent queues; two
  servers are fully isolated.
- A member may have a live entry in **two different** voice-channel queues at the
  same time, but **never two entries in the same** queue.
- Every command and button resolves *which* queue it acts on from the **caller's
  current voice channel** (`ctx.voice.getUserVoiceChannel()`).

---

## Entry statuses

Each row in `speaker_queue_entries` has a `status` of exactly one of:

| Status | Meaning |
| --- | --- |
| `waiting` | The member has raised their hand and is waiting their turn. The default for a new entry. |
| `active` | The member currently **holds the floor** (the current speaker). At most one per queue. |
| `done` | The member has finished speaking (or was advanced past). A historical/terminal record, not part of the live order. |

---

## Ordering algorithm

The **waiting** list is ordered by:

```
priority DESC, raised_at ASC
```

- **Higher `priority` first.** Default `priority` is `0`; a promoted member has a
  higher number (see below).
- **Within the same priority, earliest `raised_at` first** — fair,
  first-come-first-served tie-breaking.

The single `active` entry (the current speaker) is shown **separately at the top**
of every view (panel, `/speaker-queue`); it is not part of the waiting ordering.
`done` entries are **never** shown in the live order.

"Position N" reported to a member is their 1-based index in this ordered `waiting`
list.

---

## Priority and `/promote-speaker`

- New entries always start at `priority = 0`.
- `/promote-speaker user:@u` (moderator) sets the target member's `priority` to
  **one above the current maximum `priority` among that queue's entries**. Because
  ordering is `priority DESC` first, this moves the member to the **front of the
  `waiting` group** immediately.
- Promotion **only reorders waiting entries**. It does **not** displace the one
  `active` speaker, and it does not make the promoted member speak — a moderator
  must still advance with `/next-speaker`.
- **Stacking promotions:** if a moderator promotes member A and then member B,
  B's new priority is computed above the (now raised) maximum, so **B ends up
  ahead of A**. Repeated promotions therefore form a most-recently-promoted-first
  band at the front, with un-promoted members (priority 0) behind them in
  raised-at order. This is intentional and deterministic.
- There is **no automatic / role-based priority** in the MVP; all priority is
  set explicitly via `/promote-speaker`. (Role-based auto-priority is a roadmap
  item.)

---

## Duplicate prevention

- A member can hold **at most one live entry** (`waiting` or `active`) per queue.
- Enforced by a **partial unique index**:

  ```
  unique index on (queue_id, user_external_id) WHERE status <> 'done'
  ```

  This forbids a second non-`done` row for the same member in the same queue,
  while still allowing any number of historical `done` rows to coexist.
- `/raise-hand` (and the **Raise Hand** button) is therefore **idempotent**:
  re-raising does not create a second entry — it reports the member's current
  position (or, if they are `active`, tells them they are the current speaker).

---

## One active speaker at a time

- A queue has **at most one** `active` entry. There is no database-unique
  constraint forcing this (status is free text), so it is maintained by the
  advance logic: promoting a new speaker first moves the existing `active` entry
  to `done`, then sets exactly one `waiting` entry to `active`.
- If there is no current speaker (e.g. right after a clear, or after the active
  speaker left/was removed), the floor is simply **open** until the next advance.

---

## Lifecycle transitions

```
            /raise-hand (in VC)
   (none) ─────────────────────────▶ waiting
                                       │
                  /next-speaker        │   /lower-hand,
                  promotes top         │   /remove-speaker,
                  waiting entry        │   leave VC
                                       ▼
   done ◀──────────── active ◀───── waiting
     ▲   /next-speaker (new     │
     │    speaker promoted)     │  /lower-hand, /remove-speaker,
     │                          │  leave VC  →  entry removed
     └──────────────────────────
```

Concretely:

| From | Trigger | To |
| --- | --- | --- |
| (no entry) | `/raise-hand` / **Raise Hand** while in the VC | `waiting` (priority 0, `raised_at = now`) |
| `waiting` | `/promote-speaker @u` | stays `waiting`, `priority` raised above current max |
| `waiting` (top) | `/next-speaker` / **Next Speaker** | `active` (and any prior `active` → `done`) |
| `active` | `/next-speaker` (a new speaker is promoted) | `done` |
| `waiting` or `active` | `/lower-hand` / **Lower Hand** | **entry removed** |
| `waiting` or `active` | `/remove-speaker @u` (moderator) | **entry removed** |
| `waiting` or `active` | member **leaves / moves away** from the VC (`voice.state.update`) | **entry removed** |
| any | `/clear-speaker-queue` / **Clear Queue** | **all entries removed** |

Notes:
- **Lower hand, remove, clear, and voice-leave delete the row** (they are not
  status changes) — the member fully exits the queue, including the active slot.
- **Advancing** is the only transition that produces a `done` row.
- Leaving the VC is treated identically to lowering your hand for that VC. If the
  member moved to a *different* VC, they are removed from the old queue only.

---

## What happens to `done` entries

- A `done` entry is **terminal** and **excluded from the live order** (it never
  appears in the panel's waiting list, in `/speaker-queue`, or in position
  counts).
- Its purpose is to (a) free the partial unique index so the same member can
  raise their hand again later in the same session, and (b) keep a lightweight
  record that the member already had the floor.
- A member who was `done` may run `/raise-hand` again to rejoin as a **new
  `waiting`** entry (a fresh `raised_at`, priority back to 0) — the partial unique
  index allows this because `done` rows are excluded from it.
- `done` rows are removed when the queue is cleared (`/clear-speaker-queue`) and,
  like all entries, cascade-delete if the parent `speaker_queues` row or the
  guild is deleted (`ON DELETE CASCADE`). The MVP does not auto-prune `done` rows
  beyond that.

---

## Summary of invariants

1. At most **one queue** per `(guild, voice channel)`.
2. At most **one live entry** (`waiting`/`active`) per member per queue.
3. At most **one `active`** entry (current speaker) per queue.
4. Waiting order is exactly **`priority DESC, raised_at ASC`**.
5. `done` entries are historical and never participate in the live order.
6. Leaving the voice channel removes the member from **that** channel's queue.
