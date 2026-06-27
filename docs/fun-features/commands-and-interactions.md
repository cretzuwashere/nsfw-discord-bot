# Fun Features — Commands & Interactions

The exact slash commands and component interactions shipped by the fun features
(reconciled against the implemented code, not the initial design). All commands are
`guildOnly`. Admin commands set Discord `default_member_permissions`; everything
else is visible to all members and gated by the bot at runtime where needed.

**33 new top-level slash commands across 8 modules.**

## Slash commands

| Module | Command | Who can use |
|---|---|---|
| fun-commands | `/8ball question` | everyone |
| fun-commands | `/roll [dice]` | everyone |
| fun-commands | `/flip` | everyone |
| fun-commands | `/choose options` | everyone |
| fun-commands | `/rps move` | everyone |
| engagement-prompts | `/qotd` | everyone |
| engagement-prompts | `/wyr` | everyone |
| engagement-prompts | `/neverhaveiever` | everyone |
| engagement-prompts | `/mostlikelyto` | everyone |
| engagement-prompts | `/truthordare [kind]` | everyone |
| engagement-prompts | `/promptconfig channel hour enabled` | ManageGuild |
| giveaways | `/giveaway start\|end\|reroll\|cancel\|list` | ManageGuild |
| server-stats | `/serverstats` | everyone |
| server-stats | `/myactivity [user]` | everyone |
| server-stats | `/statsconfig channel day hour enabled` | ManageGuild |
| trivia | `/trivia` | everyone |
| trivia | `/trivia-leaderboard` | everyone |
| trivia | `/triviaconfig channel interval enabled` | ManageGuild |
| minigames | `/tictactoe opponent` | everyone |
| minigames | `/connect4 opponent` | everyone |
| economy | `/balance [user]` | everyone |
| economy | `/give user amount` | everyone |
| economy | `/daily` | everyone |
| economy | `/baltop` | everyone |
| economy | `/shop` | everyone |
| economy | `/buy item` | everyone |
| economy | `/economy grant\|take\|config` | ManageGuild |
| economy | `/shopadmin add\|remove` | ManageGuild |
| levels | `/rank [user]` | everyone |
| levels | `/levels` | everyone |
| levels | `/levelconfig …` | ManageGuild |
| levels | `/levelnoxp channel add` | ManageGuild |
| levels | `/levelrewards add\|remove\|list` | ManageGuild |

> Note: `/giveaway` is one top-level command whose **whole** tree is gated by
> ManageGuild (subcommands inherit it); members join giveaways via the Enter
> **button**, not a command.

## Component interactions (customId prefixes)

| Module | customId pattern | Component | Behaviour |
|---|---|---|---|
| engagement-prompts | `prompt:another:<category>` | button | replace the embed with another prompt of that category (cooldown-guarded) |
| giveaways | `giveaway:enter:<id>` | button | one entry per user (unique index), ephemeral confirm |
| trivia | `trivia:ans:<roundId>:<index>` | buttons (A–D) | one answer per user; first correct claims the round (atomic) |
| minigames | `mg:accept:<id>` / `mg:decline:<id>` | buttons | challenged player accepts/declines |
| minigames | `mg:ttt:<id>:<cell>` (0–8) | buttons | place a Tic-Tac-Toe mark |
| minigames | `mg:c4:<id>:<col>` (0–6) | buttons | drop a Connect Four disc |
| economy | `eco:baltop:<page>` / `eco:shop:<page>` | buttons | leaderboard / shop pagination |
| levels | `lvl:lb:<page>` | buttons | XP leaderboard pagination |

All routing is by `customId` prefix through the single `component.interaction`
platform event; each module ignores prefixes it doesn't own. No emoji reactions and
no modals are used (the adapter supports neither).

## Registering the commands with Discord

```bash
docker compose exec app pnpm discord:register-commands
```

This publishes all module slash commands (existing + the 33 new fun-feature
commands) for the configured guild (instant) or globally. Requires a valid
`DISCORD_TOKEN` + `DISCORD_CLIENT_ID`.
