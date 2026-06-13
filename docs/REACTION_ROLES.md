# Reaction Roles (Role Menus)

The **role-menus** module lets members self-assign roles by clicking buttons or
choosing from a select menu that the bot posts in a channel. Internally the
module is registered as `Reaction Roles` (module key `role-menus`) and is
described as *"Self-assignable roles via buttons and select menus."*

> **Naming note:** the admin UI and the module name say "Reaction Roles" for
> familiarity, but in v1 menus are published as **buttons** or a **select
> menu** — not classic emoji reactions. A menu saved with type `reaction` is
> still published as buttons (see [Interaction type](#interaction-type) below).

Source files:

- Module: `packages/role-menus-module/src/index.ts`
- Slash commands: `packages/role-menus-module/src/commands.ts`
- Interaction + publishing service: `packages/role-menus-module/src/service.ts`
- Pure role-change logic: `packages/role-menus-module/src/logic.ts`
- Data access: `packages/role-menus-module/src/repo.ts`
- Admin routes: `apps/admin/src/routes/role-menus.ts`
- Admin views: `apps/admin/views/role-menus.ejs`, `apps/admin/views/role-menu-edit.ejs`
- Schema: `packages/database/src/schema.ts` (tables `role_menus`, `role_menu_options`, `role_assignment_logs`)
- Registration: `apps/bot/src/main.ts`

---

## What it does

1. You create a **role menu** in the admin panel: a name, the target server, an
   interaction type (button / select), an assignment mode, an embed title +
   description, a list of role options, and optional constraints.
2. You **publish** the menu into a Discord channel with `/roles menu <id>`. The
   bot posts an embed with the buttons or select menu attached.
3. When a member clicks a button or makes a selection, the bot computes which
   roles to add/remove based on the menu's **mode** and **constraints**, applies
   them, and logs each change to `role_assignment_logs`.

The admin panel is the **primary editor** — publishing and refreshing happen in
Discord via slash commands.

---

## Required Discord permissions & intents

Declared in `packages/role-menus-module/src/index.ts` (`module.metadata`):

| Requirement | Value | Why |
| --- | --- | --- |
| Permissions | `Manage Roles`, `Send Messages` | Add/remove member roles and post the menu message |
| Intents | `Guilds` | Receive component (button/select) interactions |

This module does **not** require any privileged intents. It does not read
message content and does not need `GuildMembers`. Role changes are driven
entirely by component interactions.

### Role hierarchy requirement (important)

Discord enforces role hierarchy. Before changing any role, the adapter checks
`canManageRole` (`packages/discord-adapter/src/guild-service.ts`), which requires
**all** of:

- the role exists,
- the role is **not** a managed/integration role (`role.managed === false`),
- the bot has the `Manage Roles` permission, and
- the bot's **highest role is positioned above** the target role.

If any check fails, the interaction reply is:

> "I could not update those roles — I may lack permission or role hierarchy."

**Action for self-hosters:** in Discord **Server Settings → Roles**, drag the
bot's role **above** every role you want it to assign. Managed roles (e.g. roles
created by other bots/integrations, Nitro Booster) cannot be assigned.

---

## Configuring a menu in the admin panel

Page path: **`/role-menus`** (list) and **`/role-menus/new`** /
**`/role-menus/:id`** (editor). Routes live in
`apps/admin/src/routes/role-menus.ts`; all routes require authentication, and
mutating routes additionally require the mutating role and a valid CSRF token.

The list page (`apps/admin/views/role-menus.ejs`) shows each menu's name, the
short ID (first 8 characters), type, mode, and enabled status, with an
**Enable/Disable** toggle.

The editor (`apps/admin/views/role-menu-edit.ejs`) exposes these fields:

| Field | Form name | Notes |
| --- | --- | --- |
| Server | `guildId` | Required; selected from servers the bot has connected to |
| Menu name | `name` | Required; internal label shown in the admin list and `/roles list` |
| Interaction type | `type` | `button`, `select`, or `reaction` (reaction publishes as buttons) |
| Assignment mode | `mode` | See [Modes](#assignment-modes) |
| Embed title | `title` | Defaults to `Select your roles` |
| Embed description | `description` | Optional |
| Role options | `options` | One per line, `roleId \| label \| description \| emoji` |
| Max selections | `maxSelections` | Optional constraint (positive integer) |
| Required role ID | `requiredRoleId` | Optional constraint |
| Blocked role ID | `blockedRoleId` | Optional constraint |
| Enabled | `enabled` | A menu is enabled unless the value is `off` |

The `style` field is always stored as `embed` in this version.

### Role option format

Options are entered as plain text, **one option per line**, with `|`-separated
fields (parsed by `parseOptions` in `apps/admin/src/routes/role-menus.ts`):

```
roleId | label | description | emoji
```

- **roleId** — the Discord role ID (Developer Mode → right-click role → Copy
  ID). **Required.** Lines whose first field is not all digits (`/^\d+$/`) are
  silently dropped.
- **label** — button label or select option label. If omitted, the role ID is
  used as the label.
- **description** — shown on select-menu options (ignored by buttons).
- **emoji** — optional emoji for the button/option. If omitted, stored as null.

Example:

```
123456789012345678 | Red | The red team role | 🔴
987654321098765432 | Blue | The blue team role | 🔵
234567890123456789 | Announcements | Ping for announcements
```

Notes and limits:

- A menu must have **at least one** valid role option to save and to publish.
- A maximum of **25** options are kept per menu (`.slice(0, 25)` in both
  `parseOptions` and the button builder), matching Discord's component limits.
- Options are stored with a `position` index reflecting line order; the
  published menu preserves that order.
- Saving **replaces** all options for the menu (`replaceOptions` deletes and
  re-inserts), so always submit the full list.

To get role IDs you must enable **Developer Mode** in Discord
(User Settings → Advanced).

---

## Assignment modes

Set per menu via the `mode` field. The role-change algorithm lives in
`computeRoleChanges` (`packages/role-menus-module/src/logic.ts`). The valid
values come from the `role_menu_mode` enum in `packages/database/src/schema.ts`.

| Mode | Behavior |
| --- | --- |
| `multiple` (default) | Toggle each role independently. Clicking a button adds the role if absent, removes it if present. A select submission sets the user's menu roles to exactly the chosen set. |
| `toggle` | Same handling as `multiple` (independent toggling). |
| `single` | At most one role from the menu at a time. Selecting a role replaces any other menu role the user holds. Re-selecting the held role removes it (toggle off). |
| `unique` | Same as `single` — one role from the group, replacing others. |
| `add_only` | Selected roles are added; menu roles already held are never removed by this menu. |
| `remove_only` | Selected roles are removed; nothing is added. |

The mode only governs roles **within this menu**. Roles the user holds that are
not part of the menu are never touched.

---

## Constraints

Stored in the menu's `constraints` JSON column and enforced by
`computeRoleChanges`:

| Constraint | Form field | Effect on interaction |
| --- | --- | --- |
| `maxSelections` | Max selections | If applying the change would leave the user with more than N menu roles, the change is rejected: *"You can have at most N role(s) from this menu."* For select menus it also caps the select's `maxValues`. |
| `requiredRoleId` | Required role ID | The user must already hold this role, otherwise: *"You need another role before using this menu."* |
| `blockedRoleId` | Blocked role ID | If the user holds this role, the menu is refused: *"You are not allowed to use this menu."* |

Additional guard rails enforced in code regardless of constraints:

- Requested roles not in the menu are ignored; if nothing valid remains the user
  sees *"That role is no longer available."*
- A disabled menu replies *"This role menu is no longer active."*

> The schema documents a `tempDurationSeconds` constraint (temporary roles), but
> it is **not wired up** in v1 — the admin form does not set it and the logic
> does not act on it.

---

## Slash commands

Defined in `packages/role-menus-module/src/commands.ts`. The parent command is
`/roles` (guild-only) with four subcommands. The `id` accepts the **first 8
characters** of a menu ID (prefix match) as shown in the admin list and in
`/roles list`. Replies are ephemeral.

| Command | Options | Description |
| --- | --- | --- |
| `/roles list` | — | Lists this server's menus: short ID, name, `[type/mode]`, and `(disabled)` where applicable. |
| `/roles menu` | `id` (string, required) | Publishes the menu to the **current channel**. Posts the embed with buttons/select and records the channel + message IDs. |
| `/roles refresh` | `id` (string, required) | Re-publishes the menu. Deletes the previously published message (if any) and posts a fresh one. Uses the menu's stored channel if set, else the current channel. |
| `/roles remove` | `id` (string, required) | Disables the menu (`enabled = false`). It does not delete the existing message; clicks on a disabled menu are refused. |

### Publishing details (`/roles menu` and `/roles refresh`)

`publishMenu` in `packages/role-menus-module/src/service.ts`:

- Refuses if the menu has **no options** (*"Add at least one role option
  first."*).
- On **refresh/re-publish**, deletes the old message first (best-effort) so you
  don't end up with duplicates, then posts a new message and stores the new
  channel + message IDs.
- On success, records the `rolemenu.published` audit event.
- If posting fails, replies *"I could not post the menu — check my channel
  permissions."* (the bot needs **Send Messages** / embed + component send
  permission in that channel).

---

## Button vs select

Built by `buildMenuMessage` in `packages/role-menus-module/src/logic.ts`:

- **Buttons** (type `button`, and `reaction` which falls back to buttons):
  one secondary-style button per option, each carrying the option's label and
  emoji. Limited to the first **25** options. Component `customId` is
  `rolemenu:<menuId>:<roleId>`.
- **Select menu** (type `select`): a single string select with placeholder
  *"Choose roles…"*. `minValues` is 0 (a member can deselect everything) and
  `maxValues` is `maxSelections` if set, otherwise the number of options. Each
  option carries label, value (role ID), description, and emoji. Component
  `customId` is `rolemenu:<menuId>`.

Both types post an embed titled with the menu's `title` (default *"Select your
roles"*) and the menu's `description`, with a fixed accent color and mentions
suppressed (`@everyone`, role, and user pings are disabled on the menu message).

> Because Discord limits a single action row to 5 buttons and a message to 5
> rows, very large button menus may exceed component limits — prefer the
> **select** type for menus with many roles.

---

## How interactions are handled

`handleInteraction` in `packages/role-menus-module/src/service.ts`, wired to the
`component.interaction` platform event in `index.ts`:

1. The `customId` is parsed (`parseCustomId`). IDs not starting with `rolemenu:`
   are ignored, so other modules' components are unaffected.
2. The menu (with options) is loaded; if missing or disabled, the user is told
   it's no longer active.
3. The **requested** roles are: the single clicked button's role (button), or
   the chosen values (select submission).
4. `computeRoleChanges` produces the `add` / `remove` role lists (or a rejection
   message) from the user's current roles, the menu's mode, and its constraints.
5. Each add/remove is applied via the guild service's `addRole` / `removeRole`
   with reason `"role menu"`. Successful changes are written to
   `role_assignment_logs`; failures are counted and logged at debug level.
6. The user gets a single ephemeral reply: *"Your roles have been updated."*,
   *"No changes were made."*, or — when every change failed — the
   permission/hierarchy message above.

---

## Database tables

Defined in `packages/database/src/schema.ts`; migrations live under
`packages/database/migrations`.

### `role_menus`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid (PK) | Random default |
| `guild_id` | uuid → `guilds.id` | `ON DELETE CASCADE` |
| `name` | text | Internal admin name |
| `type` | enum `role_menu_type` | `reaction` \| `button` \| `select` (default `button`) |
| `mode` | enum `role_menu_mode` | `multiple` \| `single` \| `toggle` \| `add_only` \| `remove_only` \| `unique` (default `multiple`) |
| `channel_id` | text (nullable) | Set when published |
| `message_id` | text (nullable) | Set when published (indexed) |
| `style` | text | Always `embed` in v1 (default `embed`) |
| `title` | text | Embed title (default `Select your roles`) |
| `description` | text | Embed description (default empty) |
| `constraints` | jsonb | `maxSelections`, `requiredRoleId`, `blockedRoleId` (+ reserved `tempDurationSeconds`) |
| `enabled` | boolean | Default `true` |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `role_menus_guild_idx` (guild), `role_menus_message_idx` (message ID,
for looking a menu up from its posted message).

### `role_menu_options`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid (PK) | |
| `menu_id` | uuid → `role_menus.id` | `ON DELETE CASCADE` |
| `role_id` | text | Discord role ID |
| `label` | text | Button/option label |
| `description` | text | Select-option description |
| `emoji` | text (nullable) | Option emoji |
| `position` | integer | Display order (default 0) |

Index: `role_menu_options_menu_idx`. Options are fully replaced on each save.

### `role_assignment_logs`

Audit trail of self-service role changes (one row per role added/removed).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigserial (PK) | |
| `guild_id` | uuid → `guilds.id` | `ON DELETE CASCADE` |
| `menu_id` | uuid → `role_menus.id` | `ON DELETE SET NULL` (logs survive menu deletion) |
| `user_external_id` | text | The Discord user ID |
| `role_id` | text | The role added/removed |
| `action` | text | `added` or `removed` |
| `created_at` | timestamptz | |

Index: `role_assignment_logs_guild_idx`. The repo exposes `recentLogs(guildId,
limit)` (capped at 200) for inspection.

---

## Audit events

| Event | Source | Actor |
| --- | --- | --- |
| `rolemenu.created` | Admin save (new menu) — `apps/admin/src/routes/role-menus.ts` | `admin` |
| `rolemenu.updated` | Admin save (existing menu) — same route | `admin` |
| `rolemenu.published` | `/roles menu` / `/roles refresh` — `service.ts` | `platform_user` |

Only `rolemenu.published` is declared in the module's `metadata.auditEvents`;
the create/update events are emitted by the admin panel route. Per-interaction
role changes are recorded in `role_assignment_logs` (not the central audit log).

---

## Privacy & security notes

- The module never reads message content and requires no privileged intents.
- Admin pages are login-protected; saving/toggling a menu requires the mutating
  role and a valid CSRF token, and is audited.
- Self-service role changes are recorded in `role_assignment_logs` with the
  user's Discord ID, role, and action — useful for accountability, but be aware
  this is personal-ish data and is retained until the row is deleted.
- The menu message suppresses all mentions, so publishing cannot accidentally
  ping `@everyone` or roles.
- `requiredRoleId` / `blockedRoleId` let you gate menus, but they are **not** a
  security boundary against a determined user crafting interactions — they are
  enforced server-side here, but treat assignable roles as roles any member can
  grant themselves.

---

## Known limitations

- Type `reaction` exists in the schema/UI but publishes as **buttons**; classic
  emoji-reaction menus are not implemented in v1.
- `style` is always `embed` (no `plain` or `card` rendering yet).
- The `tempDurationSeconds` constraint (temporary/expiring roles) is reserved in
  the schema but not implemented.
- Buttons are capped at 25 options and subject to Discord's 5-buttons-per-row /
  5-rows-per-message limits; use `select` for large menus.
- `/roles remove` disables a menu but does not delete the already-posted Discord
  message; the message stays until you delete it manually or `refresh` replaces
  it.
- Role assignment fails silently per-role (counted, debug-logged) when hierarchy
  or permissions block it; if **all** roles fail the user is told, but partial
  failures only surface as "Your roles have been updated."

---

## Docker commands

Everything runs in Docker; run commands through the `app` service.

```bash
# Apply migrations (creates role_menus / role_menu_options / role_assignment_logs)
docker compose exec app pnpm db:migrate

# Tail bot/admin logs while testing a menu
docker compose logs -f app

# Run the module's unit tests (logic.test.ts, service.test.ts)
docker compose exec app pnpm --filter @botplatform/role-menus-module test
```

After editing a menu in the admin panel at `/role-menus`, publish it in Discord
with `/roles menu <id>` in the target channel, then click a button or use the
select to verify roles are assigned. If nothing happens, check the bot's role
position (hierarchy) and `Manage Roles` permission first.
