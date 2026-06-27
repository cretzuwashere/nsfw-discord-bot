# Fun Feature Research — Summary

Condensed summary of the research behind the TOP 10. Full per-candidate analysis
(all dimensions, Discord mechanics, rationale) is in
`docs/agent-memory/fun-features/02-community-fun-feature-research.md`; the full
scoring matrix is in `…/03-candidate-feature-ranking.md`.

## Method

A 6-way parallel research pass analyzed **39 candidate fun features** across six
categories (Progression & Identity, Economy & Rewards, Games & Play, Social &
Conversation, Community Events & Decisions, Quick Fun & Server Stats). Each
candidate was scored 1–5 on fun, community impact, complexity, tech risk,
spam/abuse risk, testability, moderability, fit with the existing bot, and
repeatability, plus flags for persistence, privileged intents, external deps and
overlap with existing modules. Researchers grounded fun/engagement judgements in
how real community bots behave (MEE6, Arcane, Tatsu, Carl-bot, Dank Memer, Apollo,
ProBot, Dyno). A synthesis pass then built a 14-criteria weighted scoring matrix
and selected the TOP 10.

Outcome: **14 "implement now"**, **24 "later"**, **1 "reject"** (avg fun 3.95,
avg impact 3.97 across candidates).

## Key engagement insights (what drives a large server)

1. **Recurring loops beat novelty.** Features people return to *daily* (daily/streak
   claims, QOTD, leaderboards) sustain activity far better than one-off gimmicks.
   This is why progression + economy + daily prompts dominate the TOP 10.
2. **Compounding systems.** XP→leaderboard→(later) profile cards and
   currency→daily→shop reinforce each other; each addition makes the others more
   valuable. We sequence them so the foundations land first.
3. **Friendly competition + recognition.** Leaderboards and giveaways create
   "winnable" moments and visible status; rolling weekly windows keep newcomers in
   the race instead of letting all-time boards calcify.
4. **Low-friction fun.** Instant slash commands (8ball/roll/choose) and one-tap
   buttons ("Ask another", trivia answers, giveaway enter) get used constantly
   because they cost the user nothing.
5. **Anti-spam is a feature, not an afterthought.** Every interactive item needs
   per-user cooldowns and farming guards; XP/economy specifically need
   no-XP channels, spaced rewards, and per-message caps or they get gamed.

## Strongest candidates (research "implement now")

QOTD/Would-You-Rather/party-game prompts, Giveaways, Daily/streak claim, Server
Stats & weekly recap, Trivia, Count-based Leveling, Leaderboards, Economy core,
Random fun commands, Tabletop mini-games — these form the TOP 10 (see
`selected-top-10.md`).

## Notable deferrals (and why)

| Idea | Why deferred (not chosen now) |
|---|---|
| Starboard / clip board | Need emoji-reaction or context-menu support the bot deliberately lacks (new intent + adapter work). |
| Counting game | Hard-blocked on the **privileged MessageContent** intent (reading the typed number *is* the game). |
| Polls | Discord's native `/poll` (2024) covers ~80% of casual polling for free. |
| Voice-activity XP | No voice-state events are surfaced to modules yet (adapter work needed). |
| Profile cards, Achievements | Presentation/retention layers best built **on top of** XP/economy once those exist. |
| Confessions | Highest abuse/safety surface for a large server (anonymous content moderation). |
| Meme/image commands | Violate the "no fragile external APIs" rule (dead/rate-limited meme APIs). |
| Gambling/slots, lottery | High spam/abuse + reputational sensitivity; depend on economy core. |
| Tournament brackets, Virtual pet | Highest complexity/risk; deferred until foundations are stable. |

Only **2 of 39** candidates needed a privileged intent (counting game, starboard)
— both deferred — so the entire TOP 10 runs on the bot's existing, non-privileged
permissions.
