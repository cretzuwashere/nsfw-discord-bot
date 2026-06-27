# 03 — Candidate Feature Ranking

> Agent: **AGENT 3 — CANDIDATE FEATURE RANKING**
> Date: 2026-06-27
> Input: the 39 candidates from doc 02. Output: a 14-criteria scoring matrix and
> the **TOP 10** to implement now, with implementation order and waves.

## Scoring criteria (all normalized so higher = better)

`impact, fun, feasibility, compatibility, lowSpamRisk, testability, effort
(inverted: higher=less effort), extensibility, clarity, lowMaintenance,
lowExternalDep, largeCommunityUtility, repeatability, reasonablePermissions`.
Weights: impact/fun/feasibility/compatibility ×~2.0/1.8; the other 10 ×1.0.

## Scoring matrix (sorted by weighted total)

| Rank | Feature | Imp | Fun | Feas | Compat | LowSpam | Test | Effort | Ext | Clarity | LowMaint | LowDep | LargeUtil | Repeat | Perms | **Total** |
|---:|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---:|
| 3 | Conversation Starters / Would-You-Rather / Question of the Day | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | **91.4** |
| 2 | Giveaways (button entry + scheduled draw) | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | **91.0** |
| 1 | Daily / streak claim | 5 | 3 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | **89.4** |
| 9 | Server XP Leaderboards | 5 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | **89.0** |
| 4 | Party Games pack (Truth or Dare / Never Have I Ever / Most Likely To) | 4 | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 5 | 4 | 5 | 4 | 5 | 5 | **87.0** |
| 5 | Trivia / Quiz (button answers, scheduled or on-demand) | 5 | 5 | 4 | 5 | 4 | 5 | 3 | 5 | 4 | 4 | 4 | 5 | 5 | 5 | **86.6** |
| 6 | Leveling / XP from Message Activity (count-based) | 5 | 4 | 5 | 5 | 2 | 4 | 4 | 5 | 4 | 4 | 5 | 5 | 5 | 4 | **85.6** |
| 8 | Server Stats & Weekly Highlights Recap (scheduler) | 5 | 4 | 5 | 5 | 5 | 4 | 3 | 5 | 4 | 4 | 5 | 5 | 5 | 5 | **85.6** |
| 7 | Virtual currency / economy core (no real money) | 5 | 3 | 5 | 5 | 2 | 4 | 4 | 5 | 4 | 4 | 5 | 5 | 5 | 5 | **85.0** |
| 17 | Predictions / 'Call It' event predictions (ADDED) | 4 | 5 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 5 | 5 | **85.0** |
| 19 | Fun Profile Cards (/profile rendered image) | 4 | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 5 | 4 | 4 | 4 | 5 | 5 | **83.2** |
| 11 | Tabletop minigames (Rock-Paper-Scissors, Tic-Tac-Toe, Blackjack, Connect Four) | 4 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | **81.0** |
| 12 | Button Polls / Quick Votes (ADDED) | 4 | 4 | 5 | 5 | 4 | 4 | 4 | 4 | 5 | 4 | 5 | 4 | 5 | 5 | **80.6** |
| 13 | Polls (button voting with live tallies) | 4 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 5 | 4 | 5 | 5 | **80.6** |
| 20 | Server lottery / raffle (scheduled jackpot draw) | 4 | 4 | 5 | 5 | 4 | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 5 | **80.6** |
| 16 | Reputation / Thanks (+rep, member-to-member kudos) | 4 | 4 | 5 | 5 | 3 | 5 | 4 | 4 | 4 | 5 | 5 | 4 | 4 | 4 | **79.6** |
| 14 | Role / perk shop (buy roles with points) | 5 | 3 | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 4 | 5 | 5 | 4 | 3 | **78.6** |
| 10 | Random Fun Commands (8ball / dice / roll / choose / coinflip / rps) | 3 | 3 | 5 | 5 | 3 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 4 | 5 | **78.6** |
| 15 | Reputation / Thanks (+rep) | 4 | 3 | 5 | 5 | 3 | 5 | 4 | 4 | 5 | 5 | 5 | 4 | 4 | 4 | **78.6** |
| 18 | Trivia / Quiz Game (ADDED) | 4 | 5 | 4 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 5 | 4 | **77.2** |
| 21 | Suggestions / feedback board with voting | 4 | 3 | 5 | 4 | 3 | 5 | 4 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | **74.8** |
| 25 | Gambling-lite minigames (coinflip / slots) using points | 4 | 4 | 4 | 4 | 1 | 4 | 3 | 4 | 4 | 4 | 5 | 4 | 5 | 5 | **73.6** |
| 27 | Daily Word Puzzle with streaks (added candidate, Wordle-style streak engine) | 4 | 4 | 3 | 4 | 5 | 5 | 2 | 4 | 4 | 4 | 5 | 4 | 5 | 4 | **73.4** |
| 22 | Achievements / Badges | 4 | 4 | 3 | 4 | 3 | 4 | 2 | 5 | 4 | 3 | 5 | 4 | 5 | 4 | **72.6** |
| 23 | Quotes & inside-jokes database | 3 | 3 | 5 | 4 | 4 | 5 | 4 | 4 | 5 | 4 | 5 | 3 | 3 | 5 | **72.2** |
| 24 | Word / guess games (Hangman + Wordle-style) | 4 | 4 | 3 | 4 | 4 | 5 | 2 | 4 | 4 | 4 | 5 | 4 | 4 | 4 | **72.0** |
| 34 | Confessions (anonymous, moderated) | 4 | 4 | 4 | 4 | 2 | 4 | 3 | 3 | 3 | 3 | 5 | 4 | 4 | 4 | **71.6** |
| 29 | Voice-activity XP | 5 | 4 | 3 | 3 | 2 | 3 | 2 | 4 | 3 | 3 | 5 | 5 | 5 | 4 | **71.0** |
| 26 | Event / game-night scheduler with RSVP | 4 | 4 | 3 | 3 | 4 | 4 | 3 | 4 | 4 | 3 | 5 | 4 | 4 | 4 | **70.4** |
| 38 | Starboard (highlight popular messages) | 5 | 5 | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 3 | 5 | 5 | 5 | 3 | **68.6** |
| 28 | Ship / Marriage social fun | 2 | 4 | 5 | 4 | 3 | 4 | 4 | 3 | 4 | 4 | 5 | 2 | 3 | 5 | **68.4** |
| 30 | Virtual pet / collectible (Tatsugotchi-style) | 4 | 5 | 2 | 3 | 3 | 3 | 1 | 4 | 3 | 2 | 4 | 4 | 4 | 5 | **67.2** |
| 35 | Random team / group generator | 2 | 3 | 4 | 3 | 5 | 5 | 4 | 3 | 4 | 5 | 5 | 2 | 4 | 4 | **67.0** |
| 31 | Meme / Image Commands (external API) | 3 | 4 | 4 | 4 | 2 | 3 | 4 | 3 | 4 | 2 | 1 | 3 | 4 | 4 | **65.2** |
| 32 | Soundboard (extends audio module) | 3 | 4 | 3 | 4 | 1 | 3 | 3 | 3 | 3 | 3 | 5 | 3 | 4 | 4 | **64.2** |
| 33 | Tournament brackets | 3 | 4 | 2 | 3 | 4 | 4 | 1 | 4 | 3 | 2 | 5 | 3 | 3 | 4 | **62.6** |
| 37 | Highlight / Clip Submission Board (button-based starboard) | 4 | 4 | 2 | 2 | 2 | 3 | 2 | 3 | 3 | 3 | 5 | 4 | 4 | 4 | **62.4** |
| 36 | Counting game (collaborative counting channel) | 3 | 4 | 2 | 2 | 3 | 4 | 3 | 3 | 3 | 3 | 5 | 3 | 5 | 3 | **61.0** |
| 39 | Button reaction-race / fastest-click games | 2 | 2 | 4 | 3 | 2 | 3 | 4 | 2 | 3 | 4 | 5 | 2 | 2 | 5 | **53.4** |

## TOP 10 selected (synthesis-agent order)

> The orchestrator adopts this set with two ordering refinements (see
> `selected-top-10.md`): lead with the zero-persistence RNG commands to de-risk the
> module pipeline, and keep the economy trio (currency→daily→shop) contiguous.

| Order | Feature | Wave | Persist | Cooldown | Depends on | Permissions |
|---:|---|---|:-:|:-:|---|---|
| 1 | Conversation Starters / WYR / QOTD + Party Games pack (one engagement-prompts module) | Wave 1 - Quick wins (no dependencies) | Y | Y | none | SendMessages; Create Public Threads only if the auto-thread option is enabled |
| 2 | Giveaways (button entry + scheduled draw) | Wave 1 - Quick wins (no dependencies) | Y | Y | none | SendMessages, EmbedLinks; ManageRoles only if a 'winner gets role' option is added |
| 3 | Server Stats & Weekly Highlights Recap | Wave 1 - Quick wins (no dependencies) | Y | N | none | SendMessages, EmbedLinks, ViewChannel in counted channels |
| 4 | Random Fun Commands (8ball / dice / roll / choose / coinflip / rps) | Wave 1 - Quick wins (no dependencies) | N | Y | none | None beyond default SendMessages / UseApplicationCommands |
| 5 | Trivia / Quiz (button answers, scheduled or on-demand) | Wave 2 - Games (parallelizable, no cross-deps) | Y | Y | none (shares leaderboard/round/scheduler scaffolding conceptually with stats) | SendMessages, EmbedLinks; ManageRoles only if a winner role is awarded |
| 6 | Tabletop minigames (RPS / Tic-Tac-Toe / Connect Four / point-less Blackjack) | Wave 2 - Games (parallelizable, no cross-deps) | N | N | none | SendMessages, EmbedLinks only |
| 7 | Virtual currency / economy core (no real money) | Wave 3 - Economy (currency core first, then dependents) | Y | Y | none (foundation for Daily/streak and Shop) | None beyond default SendMessages |
| 8 | Daily / streak claim | Wave 3 - Economy (currency core first, then dependents) | Y | N | Virtual currency / economy core (payout currency) | None |
| 9 | Server XP Leaderboards (with count-based XP/leveling) | Wave 4 - Progression (depends on activity-count plumbing from stats) | Y | Y | Count-based XP store (built alongside; reuses message.create activity-counting plumbing from Server Stats) | SendMessages for level-up/recap; ManageRoles only if level-reward roles are enabled |
| 10 | Role / perk shop (buy roles with points) | Wave 3 - Economy (currency core first, then dependents) | Y | N | Virtual currency / economy core (debits balance to purchase) | ManageRoles required; the bot's top role must sit above any purchasable role (hierarchy footgun, same as role-menus) |

- **1. Conversation Starters / WYR / QOTD + Party Games pack (one engagement-prompts module)** — Top community-impact engagement driver for large servers that lowers the participation barrier for lurkers (QOTD/WYR/Truth-or-Dare bots are built entirely on this). Perfect architectural fit: existing scheduler, buttons with update(), Postgres decks, admin config. No privileged intent, no modals, no reactions. Party Games (ToD/NHIE/MLTo) shares the same deck table and button-draw engine, so bundling them maximizes engagement per build-hour.
- **2. Giveaways (button entry + scheduled draw)** — Highest-ROI standalone feature: most-cited engagement/growth driver for large servers, and the modern GiveawayBot UX (single Enter button + scheduled draw) maps 1:1 onto this bot. It is a near-clone of two existing modules (role-menus interaction handling + announcements scheduler tick). Unique entry constraint makes one-per-user inherent; role/account-age gating curbs alts; crypto RNG + ledger gives fair, auditable draws.
- **3. Server Stats & Weekly Highlights Recap** — Highest community-impact in its group and an exceptional fit: counts message.create metadata (author/channel) with NO privileged intent, aggregates via the existing scheduler, posts a weekly recap embed. Recognizing top contributors and a recurring weekly beat are proven retention drivers (Statbot/Arcane/Insights). It also builds the activity-counting plumbing that XP reuses, so sequencing it early de-risks the progression wave.
- **4. Random Fun Commands (8ball / dice / roll / choose / coinflip / rps)** — Best cost-to-value in the whole set: pure-RNG slash commands (plus button RPS), zero external deps, zero new intents, trivially unit-testable pure functions. Universal baseline staple (Tatsu/MEE6/Carl-bot) that settles the 'does this server have fun commands' expectation. Ships in days and needs only a per-user cooldown for the spam-prone /8ball.
- **5. Trivia / Quiz (button answers, scheduled or on-demand)** — Highest fun-to-fit ratio: multiple-choice questions as button answers (no MessageContent intent), scheduled daily drops via the scheduler, Postgres leaderboard, optional champ role via existing addRole. Pure-logic scoring is highly testable. Ship a bundled question bank as default to remove external fragility, with OpenTDB as optional enrichment. Net-new value since the bot has no leveling/game module.
- **6. Tabletop minigames (RPS / Tic-Tac-Toe / Connect Four / point-less Blackjack)** — Best pure technical fit and lowest tech risk: 100% buttons-and-edit, no external deps, no privileged intents, deterministic and trivially testable. Classics members expect (Proto/Play Pal/Mini) that reliably generate 1v1 banter. Shares no infra with trivia so the two games proceed in parallel. Ship Blackjack point-less (or with a tiny self-contained casual score) to avoid economy scope creep.
- **7. Virtual currency / economy core (no real money)** — Load-bearing spine of the economy wave: balances, ledger, /work, /daily faucet, /pay, /balance. Passive earning uses message.create occurrence only (no MessageContent intent). Every major engagement bot treats the economy core as the daily-return spine. It is the prerequisite for the shop and the daily/streak payout, so it must land before them. Append-only ledger + per-user cooldown + earning caps are mandatory anti-farm controls from day one.
- **8. Daily / streak claim** — Highest engagement-per-line-of-code feature: one slash command, one small table, a deterministic daily scheduler tick that expires broken streaks. Escalating streaks with a miss penalty are a proven retention loop (Tatsu/MEE6/Dank Memer). Abuse risk is inherently low because the 24h cooldown self-throttles. Must ship with the currency core because the payout is currency and the loop is meaningless without something to earn/spend.
- **9. Server XP Leaderboards (with count-based XP/leveling)** — XP/leveling is the flagship progression primitive and count-based XP needs NO privileged intent (reuses the same message.create metadata as stats). Leaderboards are nearly free once XP exists (query + button-paginated embed + select-menu scope) and are the competitive/recognition payoff that makes leveling drive engagement, plus a scheduled weekly Top-10 recap. Ship leveling + leaderboard together; level-reward roles reuse the existing addRole.
- **10. Role / perk shop (buy roles with points)** — The essential currency SINK that gives the economy a point; without it earned currency decays into meaninglessness. Heavy lifting (addRole/removeRole + role-hierarchy handling) already exists and is proven in role-menus; this is mostly an atomic debit-then-grant transaction plus a select-menu catalog. Temporary perks reclaimed by a scheduler job double as inflation control. Must follow the currency core.

## Implementation-order rationale (synthesis agent)

Ordered into four waves that respect hard dependencies and front-load the cheapest, highest-fit wins. Wave 1 (orders 1-4) is dependency-free, no privileged intents, and immediately user-visible: the engagement-prompts module (QOTD/WYR + party games), giveaways, the message-count stats/recap, and the RNG fun-command bundle. Stats is sequenced in Wave 1 deliberately because it builds the message.create activity-counting plumbing that XP reuses, de-risking the later progression wave. Wave 2 (orders 5-6) is the two button-only games (trivia, tabletop classics) which share no infra and can be built in parallel by separate contributors. Wave 3 (orders 7, 8, 10) is the economy, strictly ordered currency-core-first because both Daily/streak (payout) and the Shop (debit) depend on the ledger existing; the core is order 7, its two dependents follow. Wave 4 (order 9) is progression: count-based XP + leaderboards, placed after stats so it reuses the proven activity-counting layer rather than building it twice; level-reward roles reuse the existing addRole. Profile cards, achievements, voice XP, and the economy's gambling/lottery/pets extensions are explicitly deferred to later waves on top of these foundations.

## Rejected / deferred

| Decision | Feature | Reason |
|---|---|---|
| defer | Starboard (highlight popular messages) | Worst architectural fit despite 5/5 engagement merit. A faithful starboard needs TWO things the platform deliberately lacks: the GuildMessageReactions intent + a brand-new reaction event/adapter pipeline (none exists today), AND the privileged MessageContent intent to mirror the starred message text. Cannot be approximated with buttons because the bot can't attach components to arbitrary user messages. Revisit only if a reaction pipeline + MessageContent are adopted for other reasons. |
| defer | Counting game (collaborative counting channel) | Hard-blocked on the privileged MessageContent intent: reading the typed number IS the game, and content is empty without it. Also wants a reactions intent (absent) for the genre-standard checkmark feedback. No button redesign preserves the feel. Defer until MessageContent is enabled for another reason, at which point incremental cost is near zero. |
| defer | Highlight / Clip Submission Board (button-based starboard) | Same reaction/context-menu gap as starboard. The natural emoji-reaction mechanic is impossible without new intent+adapter work, and the ergonomic right-click 'Apps' nominate is a command type the current CommandDefinition contract doesn't model. The button redesign is viable but the most complex build here (vote dedupe, anti-brigading, link resolution) with high large-server abuse risk. Defer behind cheaper, better-fitting wins. |
| reject | Button reaction-race / fastest-click games | Lowest fun ceiling and known-unfair on Discord: button interaction latency means it measures connection speed, not reflexes (acknowledged even by purpose-built click modules). High abuse surface (autoclickers, multi-account sniping) with no clean mitigation, and it adds little over a button-claim giveaway already being built. Fold a fair randomized button-claim into giveaways instead. |
| defer | Tournament brackets | By far the most complex and highest-risk candidate: correct seeding/byes, double-elimination losers-bracket routing, dispute handling, and a large stateful surface make it a multi-week build versus the days-long button modules. Audience is narrow (competitive servers) and entrenched specialists (Tourney Bot, Challonge) cover it. Defer; if built later, scope V1 to single-elimination with mod-reported results. |
| defer | Virtual pet / collectible (Tatsugotchi-style) | Highest fun but heaviest build (techComplexity 5/risk 4): a stats/decay engine that must scale to a large server (needs lazy decay-on-read), a sizeable art/content asset set, and gacha balancing. Depends on the currency core and is a phase-2 'wow' feature. Defer until the core/daily/shop loop is live and proven. |
| defer | Voice-activity XP | Highest engagement multiplier in research, but gated by missing infrastructure: no voice-state events are surfaced to modules (VoiceCapability is playback-only), so it requires new voiceStateUpdate->PlatformEvent adapter plumbing plus the GuildVoiceStates intent before any module logic can run. AFK/mute/solo farming filters add edge-case risk. High-priority 'later' after message-count progression ships. |
| defer | Gambling-lite minigames (coinflip / slots) | Most fun in the economy group but highest spam/abuse risk in the entire set (lowSpamRisk 1) plus real reputational sensitivity for a large, possibly-underage community. Must be built on a mature, well-moderated economy with max-bet caps, configurable house edge, robust cooldowns, and OFF-by-default opt-in. Defer to after the economy core/shop/daily wave is proven. |
| defer | Confessions (anonymous, moderated) | Popular but carries the highest abuse/safety surface for a large server (harassment, doxxing, NSFW, heavy mod burden of anonymous content). Must ship with review mode, word filtering, rate limits, report button, and a private author audit log. The missing modal also degrades the single-line authoring UX. Defer until lower-risk social features land and the button-queue + automod reuse is proven. |
| defer | Achievements / Badges | Strong retention layer but the highest internal-dependency surface in progression: needs an admin authoring UI, definitions/unlocks data model, both inline and scheduled evaluation, and ideally the profile card to display badges (chain: leveling -> cards -> achievements). Edge cases around retroactive unlocks/double-grants add risk. Defer until leveling/leaderboards/cards exist. |
| defer | Fun Profile Cards (/profile rendered image) | Highest fun in progression and the resvg pipeline already exists, but it is strictly a presentation layer on top of XP. Ship leveling + leaderboards with a text/embed /rank first, then add the card as a fast follow once XP data is proven. Near-certain second-wave win, not a Wave-1 blocker. |
| defer | Server lottery / raffle (scheduled jackpot draw) | Clean communal currency sink that reuses the birthdays scheduler-announce pattern, but strictly depends on the currency core existing first and is a nice-to-have rather than foundational. Easy high-value follow-up after the economy wave; build before gambling/pets on cost/benefit. |
| defer | Predictions / 'Call It' event predictions (ADDED) | Very strong, cheap, bragging-rights (no real currency) hype loop that fits buttons+scheduler+Postgres perfectly, but it is net-new (no template to copy) and pays off most once recurring events exist to predict on. Natural to bundle with an event scheduler in a later wave; ranked just below the proven giveaway/poll items. |
| defer | Polls (button voting with live tallies) | Excellent fit but Discord's native /poll (2024) covers ~80% of casual polling for free, eroding the case. Value now lives only in the native gaps (anonymous, >7-day, scheduled/recurring, role-gated, 11-25 options). Worth building scoped strictly to those differentiators, but giveaways deliver more incremental engagement per build-hour, so defer to a later wave. |
| defer | Button Polls / Quick Votes (ADDED) | Cleanest fit for the bot's update()-in-place + Postgres-vote model and low risk, but functionally overlaps both the other Polls candidate and Discord native polls. Merge with the Polls candidate into one differentiated (anonymous/scheduled/role-gated) module in a later wave rather than shipping two poll features. |
| defer | Reputation / Thanks (+rep, member-to-member kudos) | Proven low-cost identity feature (Tatsu) using only slash options + buttons (no modal/intent/reaction), but additive rather than core to the launch waves. Good early follow-on that can reuse profile-card and leaderboard scaffolding. Two near-duplicate +rep candidates were submitted; keep one. Defer. |
| defer | Reputation / Thanks (+rep) | Duplicate of the other +rep candidate (peer recognition via /rep, cooldowns, optional role rewards). Cheap and low-risk but additive, not part of the core launch waves. Consolidate the two +rep entries into a single module and build as a second-wave social feature. |
| defer | Suggestions / feedback board with voting | Proven governance/retention tool (Carl-bot), solid fit and low risk, but moderate fun (a governance tool, not a hype tool) that pays off only once a server generates idea volume, and the missing modal makes submission a slightly clunky slash-text option. Build after the higher-fun items, ideally bundled with a future modal adapter. |
| defer | Event / game-night scheduler with RSVP | Good retention driver but dominated by deep specialists (Apollo 300k+ servers, Sesh, Raid-Helper), and Discord native Scheduled Events cover the basic case for free (the bot cannot create native events without new adapter work). Correct timezone + recurrence handling is the real cost/risk. Defer; scope to single-server embed RSVP + reminders + <t:unix> rendering, not out-featuring Apollo. |
| defer | Word / guess games (Hangman + Wordle-style) | Solid fun and intent-free with a button keyboard, but the 26-letter component-cap juggling makes it the most UI-intensive build in its group, and the daily-Wordle niche is partly occupied by Discord's official NYT Wordle Activity. Build after trivia (which shares leaderboard/round/scheduler scaffolding); Hangman could lead. |
| defer | Daily Word Puzzle with streaks (added) | Essentially the 'daily + streaks' productization of the Word/guess-games candidate and would be a mode of that module, not a separate one. Depends on first building the word-game rendering engine and overlaps Discord's first-party Wordle Activity. Sequence as a streak mode after the word-games base ships. |
| defer | Meme / Image Commands (external API) | Higher fun than the RNG bundle but violates the 'no fragile external APIs' constraint (dead/rate-limited meme APIs, Reddit's 2023 clampdown) and carries real NSFW/offensive content-safety risk for a large server. Needs a hardened multi-source + NSFW-filter + caching + per-channel gating design first. Defer; mandatory reroll cooldowns. |
| defer | Soundboard (extends audio module) | Fun and leverages the existing voice stack, but collides with the single-queue-per-guild audio engine (one-shot SFX while music plays needs real concurrency/ducking work, not a thin wrapper) and has the highest disruption/abuse risk (earrape/mic-blasting) needing strict voice cooldowns and a kill switch. Discord native Soundboard also cannibalizes demand. Defer. |
| defer | Ship / Marriage social fun | Fun and cheap classic icebreaker, but shallow community value (novelty, not a retention loop) and can become low-grade spam or unwanted social pressure if not opt-in/rate-limited. Good filler for a future fun/social pack, not a priority build. |
| defer | Quotes & inside-jokes database | Beloved in mature communities and cheap on this stack, but value compounds only in servers with existing culture, and without context-menu capture or modals the save UX (paste text into a slash option) is meaningfully clunkier than Quoter/QuoteBot. Solid second-wave social feature, ideally after application-command context menus exist. |
| defer | Random team / group generator | Pleasant low-risk utility but niche (only game-night servers) and a thin broad-impact driver. Its most magical variant (auto-move players into team voice channels) is blocked by the lack of any voice-member-move/voice-channel adapter surface. Bundle as a small add-on with the event scheduler, not a standalone priority. |
| defer | Trivia / Quiz Game (ADDED) | Duplicate of the primary Trivia candidate already selected at order 5. This variant leans harder on OpenTDB; the selected version ships a bundled bank as default (lower external fragility) with OpenTDB optional. Consolidate into the single trivia module already in the Top 10. |

## Cross-check notes (verified against codebase)

Verified against the actual codebase (not just the candidate JSON): packages/core/src/contracts/events.ts confirms message.create carries author/channel/mentionCount/hasAttachments with content='' when MessageContent is ungranted, and that ComponentInteractionEvent supports reply() + optional update() with NO modal or reaction event type. packages/core/src/contracts/guild-service.ts confirms addRole/removeRole/canManageRole (role-hierarchy aware) plus full moderation primitives, sendMessage/editMessage/sendDirectMessage, and select-menu/button OutgoingMessage support. packages/core/src/contracts/voice.ts confirms VoiceCapability is playback-only with NO member voice-state events surfaced, validating the voice-XP deferral. Scheduler exists (packages/core/src/scheduler.ts) and the resvg cards pipeline exists (packages/cards-module). Module shape (key/commands/metadata.requiredIntents/configSchema/events) in module.ts supports per-module admin config and intent declaration. Scoring weights: impact/fun/feasibility/compatibility weighted 2.0/2.0/1.8/1.8, the other 10 criteria weighted 1.0; effort and spam are pre-inverted to lowSpamRisk/effort so higher is always better. De-duplication decisions: two +rep candidates and two trivia candidates were submitted; I selected one trivia for the Top 10 (bundled-bank-first to minimize external fragility) and deferred the OpenTDB-heavy duplicate, and deferred both +rep entries with a note to consolidate. Polls and Button-Polls overlap each other and Discord native /poll, so both are deferred to be merged into one differentiated module. The Top 10 contains zero features needing privileged intents, modals, or reaction listeners, satisfying the cost-avoidance constraint, and balances progression+economy (XP/leaderboard/currency/daily/shop that reinforce each other), quick wins (RNG bundle, prompts), games (trivia, tabletop), and a community event (giveaways).

---

## Checkpoint

Status: PASS

### Validat
- Full 14-criteria scoring matrix for all 39 candidates.
- TOP 10 selected, justified, dependency-ordered into waves; none need privileged
  intents, modals, or reaction listeners (verified against contracts).
- Deferred/rejected items each have a reason.
- TOP 10 do not duplicate existing modules (checked vs inventory doc 01).

### Nevalidat
- Weighted totals are model-assigned (consistent, but not empirically measured).

### Probleme
- Polls overlap Discord native /poll (deferred); +rep & trivia duplicates consolidated.

### Următorul agent poate continua?
Da. Design (04) elaborates each of the TOP 10 against the codebase.
