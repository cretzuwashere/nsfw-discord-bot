# Custom Commands

The custom-commands module lets server admins create their own slash-driven
responses without writing or deploying any code. An admin defines a named
command in the admin panel (text, embed, random, or link response), and members
run it from Discord with a single dispatcher command: `/custom name:<name>`.

Because every response is data — stored text and placeholder tokens — there is
**no arbitrary code execution**. Placeholders are resolved against a fixed,
allow-listed data map and nothing in a response is ever evaluated.

- Module package: `packages/custom-commands-module/src/`
  - `index.ts` — module definition, `/custom` dispatcher, cooldown state
  - `render.ts` — response rendering + name validation
  - `repo.ts` — Drizzle data access for the `custom_commands` table
- Admin routes: `apps/admin/src/routes/custom-commands.ts`
- Admin views: `apps/admin/views/custom-commands.ejs`,
  `apps/admin/views/custom-command-edit.ejs`
- Registered in: `apps/bot/src/main.ts`
  (`createCustomCommandsModule({ config, logger, db, audit })`)
- DB schema: `packages/database/src/schema.ts` (`customCommands` /
  `custom_commands`)

---

## What it does

- Provides a catalog of admin-authored commands, scoped per server (guild).
- A single registered slash command, `/custom`, dispatches to the right entry by
  name. The bot does **not** dynamically register one Discord slash command per
  custom command — the admin panel manages the whole catalog and Discord only
  ever sees `/custom`.
- Each command produces one of four response types: `text`, `embed`, `random`,
  or `link`.
- Responses support safe `{{placeholder}}` substitution.
- Optional per-command channel allowlist and per-user cooldown.

Module metadata (`packages/custom-commands-module/src/index.ts`):

- `key`: `custom-commands`
- Required permissions: `SendMessages`
- Required intents: `Guilds`
- Declared audit events: `custom-command.created`

---

## Required Discord permissions and intents

| Requirement | Value | Notes |
| --- | --- | --- |
| Bot permission | `SendMessages` | Needed to reply in the channel where `/custom` is run. |
| Gateway intent | `Guilds` | Always enabled platform-wide. |

This module needs **no privileged intents**. It reacts only to the `/custom`
slash command interaction, never to message content, so `MessageContent`,
`GuildMembers`, etc. are not required.

---

## The `/custom` dispatcher

Defined in `packages/custom-commands-module/src/index.ts`.

| Property | Value |
| --- | --- |
| Command | `/custom` |
| Description | "Run a custom command" |
| Guild-only | Yes (`guildOnly: true`) |

### Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | The custom command name to run. |

### Dispatch behavior

When a member runs `/custom name:<name>`:

1. The guild is resolved/created from the Discord guild ID.
2. `name` is trimmed and lowercased, then looked up by `(guildId, name)`.
3. If no command matches **or** the matched command is disabled, the bot replies
   ephemerally: `No such custom command.`
4. **Channel allowlist:** if the command has any allowed channel IDs and the
   current channel is not in the list, it replies ephemerally:
   `That command cannot be used in this channel.`
5. **Cooldown:** if a per-user cooldown is set and the user is still within it,
   it replies ephemerally: `Please wait before using that command again.`
   Otherwise the cooldown window is started.
6. The stored response is rendered (placeholders applied) and sent.
7. The command's `use_count` is incremented.

> Note: the slash reply contract is text-only, so rendered messages are
> flattened to text before sending. An embed becomes a bold title line plus its
> description; a link response appends the URL on its own line after the text.
> The embed color and a true button component are stored but not shown in the
> flattened slash reply.

---

## Response types

Configured in the admin panel and rendered by
`packages/custom-commands-module/src/render.ts`. The stored `response` is a JSON
blob whose shape depends on `responseType`.

| Type | Stored fields | Rendered as |
| --- | --- | --- |
| `text` | `text` | A plain text message (placeholders applied). Empty text renders `(empty)`. |
| `embed` | `title`, `description`, `color` | An embed with title/description (placeholders applied). Default color `0x4f8cff` if unset. |
| `random` | `choices` (string array) | One choice picked from the list (placeholders applied). |
| `link` | `text`, `url`, `label` | Text plus a link button (label defaults to `Open`). |

All responses are sent with mentions disabled (`everyone`, roles, and users are
all suppressed), so a custom command can never be used to mass-ping.

For `random`, the runtime selects a choice using the current second
(`Math.floor(Date.now() / 1000) % choices.length`), giving a rotating/varying
pick.

---

## Placeholders

Custom command responses use the same safe substitution engine as the rest of
the platform (`@botplatform/shared`, `packages/shared/src/placeholders.ts`).
Tokens are written as `{{key}}`. Unknown tokens render as an empty string, and
nothing in a template is ever executed as code.

The dispatcher builds placeholder data from the invoking user and server, so the
practically useful tokens in a custom command are:

| Placeholder | Resolves to |
| --- | --- |
| `{{user.username}}` | The invoking member's display name. |
| `{{user.displayName}}` | The invoking member's display name. |
| `{{user.mention}}` | A mention of the invoking member (`<@id>`). |
| `{{server.name}}` | The server identifier. |

> Implementation detail: the dispatcher passes the user's display name for both
> `username` and `displayName`, and passes the guild ID as `server.name`. Other
> platform placeholders (for example `{{user.avatarUrl}}`,
> `{{server.memberCount}}`, `{{date.today}}`) exist in the shared engine but are
> not populated for custom commands, so they render empty here. Mentions in the
> output never actually ping, because all responses suppress mentions.

The admin edit form shows the most relevant tokens inline:
`{{user.username}}`, `{{user.mention}}`, `{{server.name}}`.

---

## Configuring in the admin panel

All pages live under the login-protected admin panel and require an
authenticated session. Mutating actions additionally require the mutating role
and a valid CSRF token.

| Action | Method + path | Source |
| --- | --- | --- |
| List commands (per server) | `GET /custom-commands?guild=<guildId>` | `apps/admin/src/routes/custom-commands.ts` |
| New command form | `GET /custom-commands/new` | same |
| Edit command form | `GET /custom-commands/:id` | same |
| Create/update | `POST /custom-commands/:id/save` (`:id` = `new` to create) | same |
| Delete | `POST /custom-commands/:id/delete` | same |

### List page (`/custom-commands`)

Shows a table of commands for the selected server: name, response type, use
count, and enabled/disabled status, with edit links and a delete button. If no
`guild` query parameter is supplied, the first server is selected by default.

### Create / edit form

`apps/admin/views/custom-command-edit.ejs`. Fields:

| Field | Form name | Notes |
| --- | --- | --- |
| Server | `guildId` | Required; must be an existing server. |
| Command name | `name` | Lowercased on save; see name rules below. Must be unique within the server. |
| Description | `description` | Free text, stored for reference. |
| Response type | `responseType` | One of `text`, `embed`, `random`, `link` (anything else falls back to `text`). |
| Text / link text | `text` | Used by `text` and `link` types. Required for `text`. |
| Embed title | `title` | `embed` type. |
| Embed description | `description_body` | `embed` type. |
| Random choices | `choices` | One per line; blank lines ignored. At least one required for `random`. |
| Link URL | `url` | `link` type. |
| Link button label | `label` | `link` type; defaults to `Open`. |
| Allowed channel IDs | `allowedChannelIds` | Optional, comma/newline separated; only numeric IDs are kept. |
| Per-user cooldown (seconds) | `cooldownSeconds` | Integer, clamped to `0`–`86400` (24h). `0` disables. |

`enabled` defaults to on; a command is treated as disabled only if the form
submits `enabled=off`.

### Validation

Handled server-side in `apps/admin/src/routes/custom-commands.ts`:

- A server must be selected.
- The name must pass `isValidCommandName` (see below).
- The name must be unique within the server (case-insensitive).
- `text` responses require non-empty text.
- `random` responses require at least one choice.

On any validation error the form is re-rendered with a `400` status and the
error messages; nothing is written to the database.

---

## Name rules

Validated by `isValidCommandName` in
`packages/custom-commands-module/src/render.ts`:

```
/^[a-z0-9_-]{1,32}$/
```

- 1–32 characters.
- Lowercase letters `a–z`, digits `0–9`, underscore `_`, and hyphen `-` only.
- Names are stored and matched lowercased, and are unique per server (enforced
  by validation and by the `custom_commands_guild_name_idx` unique index).

---

## Channel allowlist

Each command may restrict where it can be run via `allowedChannelIds`.

- Empty list (the default): the command works in any channel.
- Non-empty list: `/custom` only responds if the current channel ID is in the
  list; otherwise the user gets `That command cannot be used in this channel.`
- IDs are entered in the admin form comma/newline separated; only numeric Discord
  channel IDs are stored.

> Note: the schema and admin save handler also persist an `allowed_role_ids`
> field, but the edit form does not currently expose it and the `/custom`
> dispatcher does not enforce a role allowlist. Treat role gating as not yet
> active; use the channel allowlist for scoping.

---

## Per-user cooldown

- `cooldownSeconds` sets a minimum gap (in seconds) between uses **per user, per
  command**. `0` disables it.
- The cooldown is enforced in memory using a map keyed by
  `<commandId>:<userId>` (`packages/custom-commands-module/src/index.ts`).
- Because the state is in-memory, cooldowns reset when the bot process restarts
  and are not shared across multiple bot instances.
- The admin form clamps the value to `0`–`86400` seconds (up to 24 hours).

---

## No arbitrary code execution (safety)

This module is intentionally data-only:

- The single registered Discord command is `/custom`. Custom commands are **not**
  dynamically registered as individual slash commands, so adding a command never
  changes the bot's registered command surface.
- Responses are static stored strings. The only dynamic transformation is
  `{{placeholder}}` substitution, which looks up keys in a fixed data map and
  renders unknown keys as empty strings — see the engine docstring in
  `packages/shared/src/placeholders.ts`: "nothing is ever evaluated as code."
- All responses suppress `@everyone`, role, and user mentions, so custom commands
  cannot be weaponized for mass pings.
- The response type from the admin form is constrained to the known set; any
  unexpected value falls back to `text`.

---

## Database

Table: `custom_commands` (`packages/database/src/schema.ts`, created by
migration `packages/database/migrations/0001_sturdy_timeslip.sql`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid (PK) | Random default. |
| `guild_id` | uuid | FK → `guilds.id`, `ON DELETE CASCADE`. |
| `name` | text | Invocation name (no prefix), unique per guild. |
| `description` | text | Defaults to empty string. |
| `response_type` | enum `custom_command_response_type` | One of `text`, `embed`, `random`, `link`; default `text`. |
| `response` | jsonb | Response config (text/embed/link) or `{ choices: [...] }` for random; default `{}`. |
| `allowed_role_ids` | jsonb (string[]) | Stored but not yet enforced (see above); default `[]`. |
| `allowed_channel_ids` | jsonb (string[]) | Channel allowlist; default `[]`. |
| `enabled` | boolean | Default `true`. |
| `cooldown_seconds` | integer | Per-user cooldown; default `0`. |
| `use_count` | integer | Incremented on each successful run; default `0`. |
| `created_at` | timestamptz | Default now. |
| `updated_at` | timestamptz | Default now; set on update. |

Unique index: `custom_commands_guild_name_idx` on `(guild_id, name)`.

The enum `custom_command_response_type` is defined in the same schema file with
values `text`, `embed`, `random`, `link`.

---

## Audit events

Admin mutations are recorded via the audit log
(`apps/admin/src/routes/custom-commands.ts`):

| Event (`action`) | When |
| --- | --- |
| `custom-command.created` | A new command is saved. |
| `custom-command.updated` | An existing command is saved. |

Each audit entry records `actorType: 'admin'`, the admin's session ID, the
`custom-commands` module key, the guild's external (Discord) ID, and
`targetType: 'custom_command'` with the saved command's ID.

> The delete route does not currently emit an audit event.

The module's declared `auditEvents` metadata lists `custom-command.created`.

---

## Known limitations

- **Role allowlist is not enforced.** `allowed_role_ids` is persisted but neither
  exposed in the edit form nor checked by the dispatcher. Use the channel
  allowlist for scoping.
- **Cooldowns are in-memory.** They reset on restart and are not shared across
  multiple bot processes.
- **Slash replies are text-only.** Embeds are flattened to a bold title plus
  description, and link responses append the URL as a line of text rather than
  rendering an interactive button. Embed color is stored but not visible in the
  reply.
- **Limited placeholder set at runtime.** Only user (display name / mention) and
  the server identifier are populated; other platform placeholders render empty
  in custom commands.
- **`server.name` is the guild ID.** The dispatcher passes the guild ID as the
  server name, so `{{server.name}}` shows an ID, not the friendly server name.
- **Delete is not audited.** Only create/update produce audit entries.

---

## Docker commands

The platform is Docker-first; run tooling inside the `app` service.

```bash
# Apply database migrations (creates/updates custom_commands)
docker compose exec app pnpm db:migrate

# Run the custom-commands module tests
docker compose exec app pnpm --filter @botplatform/custom-commands-module test

# Tail logs (the module logs "custom commands module ready" on load)
docker compose logs -f app
```

After creating or editing commands in the admin panel, members can immediately
run them with `/custom name:<name>` — no redeploy or command re-registration is
needed.
