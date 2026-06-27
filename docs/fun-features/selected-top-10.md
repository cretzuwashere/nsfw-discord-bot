# Selected TOP 10 Fun Features

This is the authoritative list of the 10 fun/engagement features chosen for
implementation, in implementation order. Selection is driven by the research +
14-criteria scoring matrix in `docs/agent-memory/fun-features/03-candidate-feature-ranking.md`
(39 candidates analyzed), refined by the orchestrator for build-order safety.

## Selection principles (recap)

- **Zero privileged intents, zero modals, zero emoji-reaction listeners** — every
  feature uses slash commands + buttons + select menus + the scheduler only.
- **No fragile external APIs** — all content (trivia, prompts) ships as a bundled
  in-repo bank.
- **Reinforcing loops** — economy (currency → daily → shop) and progression (XP →
  leaderboard) compound engagement instead of being one-off novelty.
- **Anti-abuse built in** — per-user cooldowns, output caps, farming guards.
- **No duplication** of the 11 existing modules.

## The TOP 10 (locked implementation order)

| # | Feature | Module key | Wave | Persist | Cooldown | Depends on |
|---:|---|---|---|:-:|:-:|---|
| 1 | **Random Fun Commands** (8ball, roll, dice, flip, choose, rps-vs-bot) | `fun-commands` | 1 Quick win | No | Yes | — |
| 2 | **Engagement Prompts** (QOTD, Would-You-Rather, Truth/Dare, Never-Have-I-Ever, Most-Likely-To) | `engagement-prompts` | 1 Quick win | Yes | Yes | — |
| 3 | **Giveaways** (button entry + scheduled draw, reroll) | `giveaways` | 1 Quick win | Yes | Yes | — |
| 4 | **Server Stats & Weekly Highlights** (activity counts + weekly recap) | `server-stats` | 1 Quick win | No | No | — |
| 5 | **Trivia / Quiz** (button answers, bundled bank, on-demand + scheduled) | `trivia` | 2 Games | Yes | Yes | — |
| 6 | **Mini-games (PvP)** (Tic-Tac-Toe, Connect Four — button boards) | `minigames` | 2 Games | Yes* | No | — |
| 7 | **Economy core** (virtual currency: balance, give, baltop) | `economy` | 3 Economy | Yes | Yes | — |
| 8 | **Daily / Streak claim** (`/daily`, streak bonus) | `economy` (same module) | 3 Economy | Yes | No | Economy core |
| 9 | **Shop** (buy roles/perks with currency) | `economy` (same module) | 3 Economy | Yes | No | Economy core |
| 10 | **Levels: XP + Leaderboards** (count-based XP, level roles, leaderboard) | `levels` | 4 Progression | Yes | Yes | — |

\* Mini-games persist only minimal in-flight board state so games survive a bot
restart; designs accept ephemeral fallback if a game's message is gone.

> **Note on modules vs features:** features 7–9 (currency core, daily/streak,
> shop) are three *features* delivered by **one** `economy` module built
> incrementally (core ledger first, then the daily and shop commands on top). This
> keeps the currency ledger single-sourced and matches the "currency-core-first"
> dependency. They are still validated and checkpointed as three separate steps.

## Why these, and why this order

1. **Random Fun Commands** — highest fit, trivial, no DB. Built first to validate
   the full new-module pipeline (package → command → wiring → register → seed →
   tests) at the lowest possible risk before anything with migrations.
2. **Engagement Prompts** — first feature with persistence + a daily scheduler +
   an "Ask another" button; a proven daily-activity driver (QOTD/WYR are staples
   of large community bots) and a clean template for later scheduled features.
3. **Giveaways** — high-impact community event; exercises button entry collection +
   a scheduled draw + anti-multi-entry guards. Self-contained.
4. **Server Stats & Weekly Highlights** — uses `message.create` *activity counts*
   (no message content) + a weekly recap; gives the server a heartbeat and builds
   the activity-counting approach that Levels reuses.
5. **Trivia / Quiz** — classic engagement game, button answers, bundled question
   bank (no external API), on-demand and schedulable.
6. **Mini-games (PvP)** — head-to-head Tic-Tac-Toe / Connect Four via button
   boards; pure, highly unit-testable win-detection logic.
7. **Economy core** — the currency ledger that daily and shop depend on; built and
   validated alone first.
8. **Daily / Streak** — the cheapest recurring economy hook (depends on the ledger).
9. **Shop** — currency sink that buys roles/perks (depends on the ledger +
   `ManageRoles`, with the same role-hierarchy guard role-menus uses).
10. **Levels (XP + Leaderboards)** — the richest progression feature; count-based
    XP from message activity, optional level-reward roles, and a button-paginated
    leaderboard. Built last because it is the largest and benefits from the
    activity-counting approach proven in Server Stats.

## Deferred to the roadmap (not in this TOP 10)

Profile cards, achievements/badges, reputation/+rep, polls (Discord ships native
`/poll`), suggestions board, confessions (high abuse surface), starboard &
clip-board (need reaction/context-menu support the bot lacks), counting game (needs
privileged MessageContent), voice-activity XP (needs voice-state events), virtual
pet, tournament brackets, event RSVP (dominated by Apollo/Sesh), meme/image
commands (fragile external APIs), soundboard (conflicts with single audio queue),
gambling-lite/slots (high abuse + reputational risk), lottery/raffle, ship/marriage,
quotes/inside-jokes (overlaps custom-commands), team generator. Reasons are in
`docs/agent-memory/fun-features/03-candidate-feature-ranking.md` and
`future-roadmap.md`.

## Live status

Per-feature status is tracked in `features/feature-01.md` … `feature-10.md` and in
the per-feature validation files under `docs/agent-memory/fun-features/`.
