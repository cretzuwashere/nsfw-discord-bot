# Fun Features — Future Roadmap

Deferred ideas from the research (39 candidates), in rough priority order for a
future round, with the blocker/condition that must be cleared first. Full reasons
are in `docs/agent-memory/fun-features/03-candidate-feature-ranking.md`.

## Build on the foundations just shipped

| Idea | Builds on | Notes |
|---|---|---|
| **Profile cards** (`/rank` rendered image) | Levels + `cards-module` (resvg) | Presentation layer over XP; pipeline already exists. High fun. |
| **Achievements / Badges** | Levels + Economy | Definitions/unlocks data model + admin authoring UI. |
| **Reputation / +rep** | standalone | Cheap peer-recognition (`/rep`, cooldowns, optional role rewards). Consolidate the two researched variants. |
| **Lottery / Raffle** | Economy core | Communal currency sink; reuses the birthdays scheduler-announce pattern. |
| **Work / jobs mini-economy** | Economy core | `/work` etc. with strong anti-abuse; sink/source balance. |
| **Weekly/monthly XP windows** | Levels | Rolling leaderboards to keep newcomers in the race. |
| **Point wagers in games** | Economy + Trivia/Mini-games | Optional stakes; needs careful anti-abuse. |

## Needs new platform capability first

| Idea | Blocked on |
|---|---|
| **Starboard** / **Clip-highlight board** | An emoji-reaction listener (`GuildMessageReactions` intent) or message context-menu commands — neither exists in the adapter yet. |
| **Counting game** | The privileged **MessageContent** intent (reading the typed number is the game). |
| **Voice-activity XP** | A `voice.state.update` platform event surfaced to modules (adapter work; the `GuildVoiceStates` intent is already on). |
| **Word/guess games (Wordle/Hangman)** with typed guesses | MessageContent intent (or a 26-button keyboard workaround — UI-heavy). |

## Deferred on fit / overlap / risk

| Idea | Why deferred |
|---|---|
| **Polls / quick votes** | Discord native `/poll` (2024) covers most casual polling; only differentiated (anonymous/role-weighted) polls add value. |
| **Suggestions / feedback board** | Solid governance tool but lower "fun"; good for a utility round. |
| **Event / game-night RSVP** | Dominated by Apollo/Sesh + Discord Scheduled Events. |
| **Confessions (anonymous)** | Highest abuse/safety surface for a large server; needs a robust moderation queue + audit before shipping. |
| **Meme / image commands** | Fragile/rate-limited external APIs (violates the no-fragile-deps rule). |
| **Soundboard** | Conflicts with the single-queue-per-guild audio engine (needs concurrent SFX playback). |
| **Virtual pet / collectibles** | Heaviest build (decay engine, art assets); high fun but high cost. |
| **Tournament brackets** | Highest complexity/risk (seeding, byes, double-elim, disputes). |
| **Gambling-lite / slots** | Highest spam/abuse + reputational risk; gate behind economy + strict limits. |
| **Ship / marriage** | Shallow retention; mild spam/social-pressure risk. |
| **Quotes / inside-jokes** | Overlaps the existing custom-commands module; best as a context-menu capture (not available). |
| **Random team generator** | Niche (game-night servers); thin broad impact. |

## Suggested next round

1. Profile cards (immediate visual payoff on Levels).
2. Reputation / +rep (cheap, standalone, high fit).
3. Achievements (ties Levels + Economy together).
4. Lottery + Work jobs (deepen the economy loop).
5. Platform work to unlock Starboard + Voice XP (reaction listener / voice-state event).
