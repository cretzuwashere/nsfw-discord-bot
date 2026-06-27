# Fun Features — Permissions & Intents

None of the fun features require a **privileged intent** (no MessageContent, no
GuildMembers) or any new gateway intent. They use the bot's existing `Guilds` +
`GuildMessages` intents. Message-activity features (Server Stats, Levels) use the
`message.create` event **metadata only** (author/channel) — never message text.

## Per-feature permissions

| Feature | Discord permissions the bot needs | Admin commands gated by |
|---|---|---|
| Random Fun Commands | SendMessages | — |
| Engagement Prompts | SendMessages | ManageGuild (/promptconfig) |
| Giveaways | SendMessages, EmbedLinks | ManageGuild (start/end/reroll/cancel) |
| Server Stats | SendMessages, EmbedLinks, ViewChannel | ManageGuild (/statsconfig) |
| Trivia | SendMessages, EmbedLinks | ManageGuild (/triviaconfig) |
| Mini-games | SendMessages | — |
| Economy (core/daily/shop) | SendMessages; ManageRoles (shop role grants only) | ManageGuild (grant/take/config, shop add/remove) |
| Levels | SendMessages; ManageRoles (reward roles only) | ManageGuild (levelconfig/levelrewards) |

## Role-hierarchy footgun (Shop & Levels reward roles)

Granting a role requires the bot's highest role to sit **above** the target role
and the role to be non-managed. Both features call `GuildService.canManageRole`
before granting and fail safely (no crash, clear admin-facing message) otherwise —
the same guard the role-menus module uses.

## Moderator control

Every fun module can be enabled/disabled per server from the admin `/modules`
page (each is seeded as a module row, default **disabled** except where noted).
Mutating admin commands are gated by Discord `ManageGuild`/`ManageRoles`, so only
staff can configure them.
