# Community Modules

This is the index for the platform's **community management modules** — the
self-contained features that run on top of the bot core (audio, announcements,
welcome, moderation, and so on). It explains the module system that ties them
together, then summarizes each of the eleven built-in modules with its admin
page, slash commands, default enabled/disabled status, and a link to its
dedicated documentation.

If you are setting the platform up for the first time, read
[`DISCORD_SETUP.md`](./DISCORD_SETUP.md) (token, intents, invite) and
[`ADMIN_PANEL.md`](./ADMIN_PANEL.md) (login, navigation) first — this document
assumes the bot is already connected and you can reach the admin panel.

---

## The module system

### The `BotModule` contract

Every module implements the `BotModule` interface defined in
[`packages/core/src/contracts/module.ts`](../packages/core/src/contracts/module.ts).
A module is **adapter-agnostic** — it speaks only in core contracts and never
imports Discord types directly. The shape is:

```ts
interface BotModule {
  readonly key: string;          // stable DB row key (see MODULE_KEYS)
  readonly name: string;
  readonly description: string;
  readonly commands: CommandDefinition[];
  readonly metadata?: ModuleMetadata;       // permissions/intents/audit/config
  readonly events?: ModuleEventHandler[];    // member.join/leave, message.create, …
  onLoad?(ctx: ModuleContext): Promise<void> | void;
  onShutdown?(): Promise<void> | void;
}
```

- **`commands`** are slash commands (`CommandDefinition`, with subcommands and
  typed options) the adapter registers with Discord.
- **`events`** are subscriptions to adapter-neutral platform events
  (`member.join`, `member.leave`, `message.create`, `component.interaction`).
  The Discord adapter emits these; the module reacts without knowing it is
  Discord.
- **`metadata`** (`ModuleMetadata`) is **declarative documentation the admin
  panel reads**:
  - `requiredPermissions` — Discord permission names the module needs.
  - `requiredIntents` — gateway intents (e.g. `GuildMembers`, `MessageContent`).
  - `configSchema` — admin-panel configuration field descriptors.
  - `auditEvents` — audit action keys the module can emit.
- **`onLoad` / `onShutdown`** are lifecycle hooks (open resources, log readiness,
  tear down voice connections, etc.).

Modules are constructed in
[`apps/bot/src/main.ts`](../apps/bot/src/main.ts) (`create<Name>Module(...)`)
and registered with the `BotKernel`. Each module receives only the ports it
needs — a logger, config, the `GuildServiceProvider` (the adapter, used to send
messages and manage roles/moderation), a Drizzle `Db`, and an `AuditLogPort`.
Modules with timed work (announcements, scheduled messages, reminders,
birthdays) also contribute a `ScheduledJob` to the kernel scheduler.

The well-known module keys live in `MODULE_KEYS` in
[`packages/shared/src/types.ts`](../packages/shared/src/types.ts).

### Enabling and disabling modules

Module enablement is **persisted in the `modules` table** (schema in
[`packages/database/src/schema.ts`](../packages/database/src/schema.ts)):

```
modules(key PK, name, description, enabled, version, updated_at)
```

On startup the database is seeded (idempotently) by
[`packages/database/src/seed.ts`](../packages/database/src/seed.ts), which
inserts a row for each built-in module with its **default enabled state**.
Existing rows are never overwritten, so toggles you make in the panel survive
restarts and re-seeds.

You control modules from the **Modules** admin page:

- **Page path:** `/modules` (view
  [`apps/admin/views/modules.ejs`](../apps/admin/views/modules.ejs); route in
  [`apps/admin/src/server.ts`](../apps/admin/src/server.ts)).
- Toggling a module posts to `/modules/:key/toggle`, flips `modules.enabled`,
  and writes an audit entry with action **`module.enabled`** or
  **`module.disabled`** (target type `module`, target id = the module key).
- Toggling requires a mutating role and a valid CSRF token (see
  [`SECURITY.md`](./SECURITY.md)).

Module state is cached in the running bot (`CachedModuleState`), so a disabled
module stops handling commands/events without a redeploy.

### Permissions and intents at a glance

The bot always needs the **Guilds** and **GuildVoiceStates** (audio) intents.
Some modules need additional, **privileged** intents that must also be enabled
in the Discord developer portal:

| Intent | Privileged? | Needed by | Notes |
| --- | --- | --- | --- |
| `Guilds` | no | all | base intent |
| `GuildVoiceStates` | no | audio-player | voice connections |
| `GuildMembers` | **yes** | welcome, birthdays (roles) | join/leave + auto-roles; gated by `DISCORD_ENABLE_GUILD_MEMBERS`; without it the bot receives no join events so welcome + auto-roles never fire |
| `GuildMessages` | no | automod | message events |
| `GuildModeration` | no | moderation | ban/audit events |
| `MessageContent` | **yes** | automod (content rules) | gated by `DISCORD_ENABLE_MESSAGE_CONTENT`; without it, content rules run **DEGRADED** |

See [`DISCORD_SETUP.md`](./DISCORD_SETUP.md) for how to enable privileged
intents and which OAuth permissions to grant when inviting the bot.

### Placeholders

Message and card templates (welcome, birthday, scheduled messages, custom
commands, dynamic cards) support safe `{{placeholder}}` substitution from
[`@botplatform/shared`](../packages/shared/src/placeholders.ts). Unknown
placeholders render as empty strings and nothing is ever evaluated as code.
Supported keys: `{{user.username}}`, `{{user.displayName}}`, `{{user.mention}}`,
`{{user.avatarUrl}}`, `{{user.id}}`, `{{server.name}}`,
`{{server.memberCount}}`, `{{date.today}}`, `{{birthday.age}}`, `{{role.name}}`.

### Docker note

Everything runs in Docker. Admin/maintenance commands are run against the `app`
service, for example:

```bash
docker compose exec app pnpm db:seed     # re-run the idempotent seed
docker compose exec app pnpm db:migrate   # apply pending migrations
```

See [`DOCKER_DEPLOYMENT.md`](./DOCKER_DEPLOYMENT.md) and
[`DOCKER_DEVELOPMENT.md`](./DOCKER_DEVELOPMENT.md).

---

## Module index

Default status comes from
[`packages/database/src/seed.ts`](../packages/database/src/seed.ts): **audio
player and announcements are enabled by default; every other module is disabled
by default** and must be turned on from the `/modules` page.

| Module | Key | Admin page | Slash commands | Default |
| --- | --- | --- | --- | --- |
| Audio Player | `audio-player` | `/audio` | `/join` `/leave` `/play` `/queue` `/skip` `/pause` `/resume` `/stop` `/nowplaying` | **Enabled** |
| Announcements | `announcements` | `/announcements` | `/announcement preview\|send\|list\|cancel` | **Enabled** |
| Dynamic Cards | `dynamic-cards` | `/cards` | _(none)_ | Disabled |
| Welcome / Leave | `welcome` | `/welcome` | _(none — event-driven)_ | Disabled |
| Reaction Roles | `role-menus` | `/role-menus` | `/roles menu\|list\|refresh\|remove` | Disabled |
| Birthdays | `birthdays` | `/birthdays` | `/birthday set\|view\|remove\|upcoming` | Disabled |
| Reminders | `reminders` | `/reminders` | `/reminder create\|list\|remove` | Disabled |
| Scheduled Messages | `scheduled-messages` | `/scheduled-messages` | _(none — admin CRUD)_ | Disabled |
| Moderation | `moderation` | `/moderation` | warn, timeout, kick, ban, purge, … | Disabled |
| Auto-Moderation | `automod` | `/automod` | _(none — event-driven)_ | Disabled |
| Custom Commands | `custom-commands` | `/custom-commands` | `/custom name:<n>` | Disabled |

---

### Audio Player — `audio-player` — **enabled by default**

Voice-channel audio playback with a queue. Resolves tracks from YouTube,
SoundCloud and Spotify (via `yt-dlp`) plus direct media links; streaming
sources are optional and gated by config. Live queue, now-playing and recent
errors are visible in the admin panel.

- **Admin page:** `/audio` ([`apps/admin/views/audio.ejs`](../apps/admin/views/audio.ejs))
- **Slash commands:** `/join`, `/leave`, `/play` (option `url`), `/queue`,
  `/skip`, `/pause`, `/resume`, `/stop`, `/nowplaying`
  ([`packages/audio-module/src/commands.ts`](../packages/audio-module/src/commands.ts))
- **Intents/permissions:** `Guilds` + `GuildVoiceStates`; needs **Connect** and
  **Speak** in voice channels
- **Tables:** `playback_history`, `queue_items`
- **Key env:** `AUDIO_ENABLE_STREAMING_SOURCES`, `AUDIO_YTDLP_PATH`,
  `AUDIO_MAX_QUEUE_SIZE`, `AUDIO_MAX_TRACK_DURATION_SECONDS`,
  `AUDIO_ALLOWED_DOMAINS`
- **Note:** if streaming sources are enabled but `yt-dlp` is missing, only
  direct links work and the module logs a warning.
- **Docs:** [`AUDIO_SOURCES.md`](./AUDIO_SOURCES.md)

### Announcements — `announcements` — **enabled by default**

Create, schedule, preview and send server announcements from the admin panel;
a scheduler job delivers due scheduled announcements (~30 s tick).

- **Admin page:** `/announcements` ([`apps/admin/views/announcements.ejs`](../apps/admin/views/announcements.ejs),
  edit view `announcement-edit.ejs`; route
  [`apps/admin/src/routes/announcements.ts`](../apps/admin/src/routes/announcements.ts))
- **Slash commands:** `/announcement preview`, `/announcement send`,
  `/announcement list`, `/announcement cancel` (each takes an announcement `id`)
- **Permissions/intents:** `SendMessages`, `EmbedLinks`; `Guilds`
- **Config (metadata):** `defaultChannelId`
- **Tables:** `announcements`
- **Audit events:** `announcement.created`, `announcement.sent`,
  `announcement.failed`
- **Docs:** [`ANNOUNCEMENTS.md`](./ANNOUNCEMENTS.md)

### Dynamic Cards — `dynamic-cards` — disabled by default

Generates personalized images (welcome cards, birthday cards, banners) by
rendering sanitized SVG templates to PNG with `@resvg/resvg-js`. It has **no
slash commands** — it is a rendering service used by the Welcome and Birthday
modules and the admin preview. Supports template management and asset uploads.

- **Admin page:** `/cards` ([`apps/admin/views/cards.ejs`](../apps/admin/views/cards.ejs),
  edit view `card-edit.ejs`; route
  [`apps/admin/src/routes/cards.ts`](../apps/admin/src/routes/cards.ts))
- **Permissions:** `AttachFiles`
- **Tables:** `card_templates`, `card_assets`
- **Audit events:** `card.template.created`, `card.template.updated`,
  `card.template.archived`
- **Security:** templates are sanitized; placeholder substitution never
  evaluates code. Uploads are stored under the configured uploads directory.
- **Docs:** [`DYNAMIC_CARDS.md`](./DYNAMIC_CARDS.md)

### Welcome / Leave — `welcome` — disabled by default

Sends welcome and leave messages, can post a rendered welcome card, send a DM,
assign auto-roles, and apply a delay. Driven entirely by the `member.join` and
`member.leave` platform events — **no slash commands**.

**Auto-roles** are independent of the welcome message: set one or more role IDs
in the `/welcome` admin page and every new member receives them on join — even
with welcome messages disabled, and immediately (the *Delay before welcome*
setting only delays the message, not the role). The bot must have **Manage
Roles** and its own role must sit **above** each auto-role.

- **Admin page:** `/welcome` ([`apps/admin/views/welcome.ejs`](../apps/admin/views/welcome.ejs);
  route [`apps/admin/src/routes/welcome.ts`](../apps/admin/src/routes/welcome.ts))
- **Permissions/intents:** `SendMessages`, `ManageRoles`, `AttachFiles`;
  **`GuildMembers`** (privileged)
- **Tables:** `welcome_settings`
- **Audit events:** `welcome.sent`, `welcome.leave`, `welcome.autorole`
- **Note:** auto-roles require the bot's role to be **above** the granted roles
  in the role hierarchy. Cards require the Dynamic Cards module.
- **Docs:** privileged intents + invite permissions in [`DISCORD_SETUP.md`](./DISCORD_SETUP.md)

### Reaction Roles — `role-menus` — disabled by default

Self-assignable roles via buttons and select menus. Supports modes
`multiple`, `single`, `toggle`, `add_only`, `remove_only` and `unique`, plus
`max`, `required` and `blocked` constraints. Reacts to `component.interaction`
events to grant/remove roles.

- **Admin page:** `/role-menus` (labeled "Reaction Roles";
  [`apps/admin/views/role-menus.ejs`](../apps/admin/views/role-menus.ejs), edit
  view `role-menu-edit.ejs`; route
  [`apps/admin/src/routes/role-menus.ts`](../apps/admin/src/routes/role-menus.ts))
- **Slash commands:** `/roles menu` (post a menu by `id`), `/roles list`,
  `/roles refresh`, `/roles remove`
- **Permissions/intents:** `ManageRoles`, `SendMessages`; `Guilds`
- **Tables:** `role_menus`, `role_menu_options`, `role_assignment_logs`
- **Audit events:** `rolemenu.published`
- **Docs:** [`REACTION_ROLES.md`](./REACTION_ROLES.md)

### Birthdays — `birthdays` — disabled by default

Opt-in birthday tracking with daily announcements, an optional birthday role,
and an optional card. Members set their own birthday; a scheduler job announces
at each guild's configured hour (dedup-gated).

- **Admin page:** `/birthdays` ([`apps/admin/views/birthdays.ejs`](../apps/admin/views/birthdays.ejs);
  route [`apps/admin/src/routes/birthdays.ts`](../apps/admin/src/routes/birthdays.ts)) —
  configure the announcement channel/hour/message, optional role, and delete a
  member's entry
- **Slash commands:** `/birthday set` (`month`, `day`, optional `year`,
  `timezone`), `/birthday view`, `/birthday remove`, `/birthday upcoming`
- **Permissions/intents:** `SendMessages`, `ManageRoles`; `Guilds` (the
  birthday **role** feature additionally relies on `GuildMembers`)
- **Tables:** `birthdays`, `birthday_settings`, `birthday_announcements`
- **Audit events:** `birthday.announced`
- **Privacy:** birthdays are **opt-in**, the stored `year` is optional and only
  used to compute age, members can remove their entry at any time with
  `/birthday remove`, and private entries are excluded from `/birthday upcoming`.
- **Docs:** [`BIRTHDAYS.md`](./BIRTHDAYS.md)

### Reminders — `reminders` — disabled by default

Personal reminders delivered by DM or in a channel, with recurring support. A
duration parser understands inputs like `30m`, `2h`, `1d 6h`. A scheduler job
delivers due reminders (~30 s tick). Limited to 25 active reminders per user.

- **Admin page:** `/reminders` ([`apps/admin/views/reminders.ejs`](../apps/admin/views/reminders.ejs))
- **Slash commands:** `/reminder create` (`message`, `when`, optional `here`,
  optional `repeat`), `/reminder list`, `/reminder remove` (`id`)
- **Permissions/intents:** `SendMessages`; `Guilds`
- **Tables:** `reminders`
- **Audit events:** `reminder.delivered`
- **Docs:** [`REMINDERS.md`](./REMINDERS.md)

### Scheduled Messages — `scheduled-messages` — disabled by default

Schedule one-off and recurring messages to a channel. Schedule types: `once`,
`interval`, `daily`, `weekly`, `monthly` and `cron` (computed with Luxon +
`cron-parser`). Managed entirely from the admin panel (CRUD) — **no slash
commands**. A scheduler job delivers due messages (~30 s tick).

- **Admin page:** `/scheduled-messages` ([`apps/admin/views/scheduled-messages.ejs`](../apps/admin/views/scheduled-messages.ejs),
  edit view `scheduled-message-edit.ejs`; route
  [`apps/admin/src/routes/scheduled-messages.ts`](../apps/admin/src/routes/scheduled-messages.ts))
- **Permissions/intents:** `SendMessages`; `Guilds`
- **Tables:** `scheduled_messages`, `scheduled_message_runs`
- **Audit events:** `scheduled-message.sent`
- **Docs:** [`SCHEDULED_MESSAGES.md`](./SCHEDULED_MESSAGES.md)

### Moderation — `moderation` — disabled by default

Moderator commands with case logging and a mod-log. Each command is gated by
`default_member_permissions`, protects the server owner, records a
`moderation_cases` entry, and can optionally DM the affected member.

- **Admin page:** `/moderation` ([`apps/admin/views/moderation.ejs`](../apps/admin/views/moderation.ejs);
  route in [`apps/admin/src/server.ts`](../apps/admin/src/server.ts)) — review
  cases and toggle moderation rules
- **Slash commands:** `warn`, `warnings`, `clearwarnings`, `timeout`,
  `untimeout`, `kick`, `ban`, `unban`, `purge`, `slowmode`, `lock`, `unlock`
  ([`packages/moderation-module/src/commands.ts`](../packages/moderation-module/src/commands.ts))
- **Permissions/intents:** `ModerateMembers`, `KickMembers`, `BanMembers`,
  `ManageMessages`, `ManageChannels`; `Guilds` + `GuildModeration`
- **Tables:** `moderation_cases`, `moderation_settings`, `warnings`,
  `moderation_actions`, `moderation_rules`, `permission_mappings`
- **Audit events:** `moderation.warn`, `moderation.mute`, `moderation.kick`,
  `moderation.ban`, `moderation.purge`
- **Note:** the bot's role must sit above target members for timeout/kick/ban to
  succeed. See also the moderation design notes in
  [`MODERATION_ROADMAP.md`](./MODERATION_ROADMAP.md).
- **Docs:** [`MODERATION.md`](./MODERATION.md)

### Auto-Moderation — `automod` — disabled by default

Automatic message filtering on `message.create`. Rule types:
`banned_words`, `spam`, `mention_spam`, `caps`, `invite_links`,
`suspicious_links`, `attachments`, `new_account`. Actions: `log_only`,
`delete`, `warn`, `timeout`, `kick`, `ban`, with **escalation** and
ignored-channel / ignored-role lists. **No slash commands** — configured in the
panel.

- **Admin page:** `/automod` ([`apps/admin/views/automod.ejs`](../apps/admin/views/automod.ejs);
  route [`apps/admin/src/routes/automod.ts`](../apps/admin/src/routes/automod.ts))
- **Permissions/intents:** `ManageMessages`, `ModerateMembers`; `Guilds` +
  `GuildMessages` + **`MessageContent`** (privileged)
- **Tables:** `automod_rules`, `automod_violations`
- **Audit events:** `automod.violation`
- **Limitation / DEGRADED mode:** content-based rules (banned words, links,
  caps, invites) require the **`MessageContent`** privileged intent. If
  `DISCORD_ENABLE_MESSAGE_CONTENT` is not enabled, those rules cannot read
  message text and the module starts **DEGRADED** (it logs a warning;
  non-content rules such as spam, mention spam and attachments still work).
- **Docs:** [`AUTOMOD.md`](./AUTOMOD.md)

### Custom Commands — `custom-commands` — disabled by default

Admin-defined commands invoked through a single dispatcher: `/custom name:<n>`.
Response types: `text`, `embed`, `random` and `link`, with `{{placeholder}}`
support, a per-command channel allowlist, and a per-user cooldown. Using a
single dispatcher avoids dynamic slash-command registration; the catalog is
managed in the panel.

- **Admin page:** `/custom-commands` ([`apps/admin/views/custom-commands.ejs`](../apps/admin/views/custom-commands.ejs),
  edit view `custom-command-edit.ejs`; route
  [`apps/admin/src/routes/custom-commands.ts`](../apps/admin/src/routes/custom-commands.ts))
- **Slash command:** `/custom` (required option `name`)
- **Permissions/intents:** `SendMessages`; `Guilds`
- **Tables:** `custom_commands`
- **Audit events:** `custom-command.created`
- **Docs:** [`CUSTOM_COMMANDS.md`](./CUSTOM_COMMANDS.md)

---

## See also

- [`ADMIN_PANEL.md`](./ADMIN_PANEL.md) — navigation, login, audit logs
- [`DISCORD_SETUP.md`](./DISCORD_SETUP.md) — token, intents, invite permissions
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — core, adapter and module design
- [`SECURITY.md`](./SECURITY.md) — auth, CSRF, rate limiting, auditing
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) — common issues (degraded intents,
  role hierarchy, missing `yt-dlp`)
</content>
</invoke>
