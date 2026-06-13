# Moderation

The moderation module gives server staff a set of permission-gated slash
commands for handling members and channels — warnings, timeouts, kicks, bans,
message purges, slowmode and channel locks — and records every consequential
action as a numbered **case** so there is a durable, reviewable history. Cases
and warnings are visible in the admin panel.

> **Supersedes `docs/MODERATION_ROADMAP.md`.** The roadmap describes a v1
> *foundation* in which the module shipped services and persistence but **no
> slash commands** (`module.commands` was `[]`). That is no longer accurate:
> the 12 commands documented below are implemented in
> `packages/moderation-module/src/commands.ts` and registered on the module.
> The roadmap's RBAC design (`permission_mappings` / `PermissionService`) was
> **not** the mechanism that shipped — gating is done with Discord's native
> `default_member_permissions` (see [Permissions](#required-permissions-and-intents)).
> Treat the roadmap as historical context only.

Source files:

- Commands: `packages/moderation-module/src/commands.ts`
- Case storage: `packages/moderation-module/src/cases-repo.ts`
- Module wiring: `packages/moderation-module/src/index.ts`
- Discord enforcement: `packages/discord-adapter/src/guild-service.ts`,
  `packages/discord-adapter/src/command-mapper.ts`
- Admin page: route in `apps/admin/src/server.ts`, view `apps/admin/views/moderation.ejs`
- Schema: `packages/database/src/schema.ts` (`moderation_cases`, `moderation_settings`)

---

## What the module does

- Registers 12 guild-only slash commands acting through the platform's
  `GuildService` abstraction, so the module itself contains no Discord-specific
  code.
- Assigns a **per-guild sequential case number** to every member action and
  persists it in `moderation_cases`.
- Optionally **DMs the affected user** and **posts to a mod-log channel** after
  each action (controlled by `moderation_settings`).
- Writes an `audit_logs` entry for each action.
- Surfaces cases, warnings, action history and rules on the admin
  **Moderation** page.

The module loads with database persistence and a `GuildServiceProvider`; with
either missing, `commands` is empty and the module logs
`persistence: 'unavailable'` (see `createModerationModule` in
`packages/moderation-module/src/index.ts`). In the running bot both are
present.

---

## Required permissions and intents

### Discord intents

The module declares `requiredIntents: ['Guilds', 'GuildModeration']`
(`packages/moderation-module/src/index.ts`). `GuildModeration` is **not** a
privileged intent, so no Discord developer-portal toggle is needed for
moderation itself. (`GuildMembers`, used by other modules, is unrelated here —
the commands fetch members on demand.)

### Bot permissions

The bot's own role must hold the Discord permissions for the actions you want
to use (declared as `requiredPermissions` on the module):
`ModerateMembers`, `KickMembers`, `BanMembers`, `ManageMessages`,
`ManageChannels`. Grant these when inviting the bot and ensure the bot's
highest role sits **above** the members it must action.

### Who can run each command (`default_member_permissions` gating)

Every command sets `defaultMemberPermissions`. The Discord adapter converts
this list into Discord's `default_member_permissions` bitfield at registration
time (`permissionsToBitfield` in
`packages/discord-adapter/src/command-mapper.ts`), so **Discord itself hides
and blocks the command** from members who lack the permission. This is the
gate — there is no separate in-app role check for these commands.

| Command(s) | Required member permission |
| --- | --- |
| `warn`, `warnings`, `clearwarnings`, `timeout`, `untimeout` | **Moderate Members** |
| `kick` | **Kick Members** |
| `ban`, `unban` | **Ban Members** |
| `purge` | **Manage Messages** |
| `slowmode`, `lock`, `unlock` | **Manage Channels** |

All commands are `guildOnly` (registered with `contexts: [0]`), so they cannot
be invoked in DMs.

> A server administrator can override these defaults in
> **Server Settings → Integrations → (the bot)** to restrict commands further
> by role or channel.

### Bot-side safety checks (enforced in the adapter)

Beyond Discord's permission gate, `GuildService` applies its own guards before
acting (`packages/discord-adapter/src/guild-service.ts`):

- **Role hierarchy / kickability** — `kick` requires `member.kickable`;
  otherwise the user gets `I cannot kick that member.` Bans and timeouts
  surface a safe failure message when Discord rejects the action (e.g. the
  target outranks the bot).
- **Member presence** — actions on a member not in the server return
  `That member is not in this server.` (`unban` and `ban` work by ID and do not
  require the user to be present.)
- **Owner protection** — `timeout`, `kick` and `ban` set `protectOwner: true`.
  Before acting, the command calls `service.isGuildOwner(target)`
  (`guild.ownerId === target`); if the target is the server owner the action is
  refused with `That action cannot target the server owner.` `untimeout` and
  `unban` do not carry this guard (they are corrective, not punitive).
- **Safe error messages** — adapter failures are wrapped and returned via
  `toSafeUserMessage`; raw internal errors are never shown to users.

---

## Slash commands

All replies for failures and listings are **ephemeral** (visible only to the
invoking moderator). Successful actions reply with the case number.

### `/warn`
Warn a member. Records a warning and a `warn` case.

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `user` | user | yes | Member to warn |
| `reason` | string | yes | Truncated to 480 chars |

### `/warnings`
List a member's warnings (most recent first, up to 10 shown), ephemeral. Reads
`warn`-type cases for the user.

| Option | Type | Required |
| --- | --- | --- |
| `user` | user | yes |

### `/clearwarnings`
Records a warnings-clear for the member. **Note:** this writes an `other` case
noting "cleared warnings" — existing warnings remain in history (the case
ledger is append-only); it does not delete prior `warn` rows.

| Option | Type | Required |
| --- | --- | --- |
| `user` | user | yes |

### `/timeout`
Time out (mute) a member using Discord's native timeout. Records a `mute` case
with `expiresAt`.

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `user` | user | yes | |
| `minutes` | integer | yes | Clamped to **1–40320** (28 days, Discord's max) |
| `reason` | string | no | |

Owner-protected. Timeouts self-expire on Discord — no background job needed.

### `/untimeout`
Remove a member's timeout. Records an `unmute` case.

| Option | Type | Required |
| --- | --- | --- |
| `user` | user | yes |
| `reason` | string | no |

### `/kick`
Kick a member. Records a `kick` case. Owner-protected; requires the member to
be kickable by the bot.

| Option | Type | Required |
| --- | --- | --- |
| `user` | user | yes |
| `reason` | string | no |

### `/ban`
Ban a member. Records a `ban` case. Owner-protected.

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `user` | user | yes | |
| `reason` | string | no | |
| `delete_days` | integer | no | Delete that user's messages from the last N days; clamped to **0–7** |

### `/unban`
Unban a user by their ID. Records an `unban` case. Takes a raw ID because the
user is no longer in the server.

| Option | Type | Required |
| --- | --- | --- |
| `user_id` | string | yes |
| `reason` | string | no |

### `/purge`
Bulk-delete recent messages in the current channel. Replies ephemerally with
the count deleted; audits the purge but does **not** create a `moderation_cases`
row.

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `amount` | integer | yes | Clamped to **1–100** |

Discord's bulk-delete cannot remove messages older than 14 days (skipped by
the adapter), so the deleted count may be lower than requested.

### `/slowmode`
Set the current channel's slowmode. Does not create a case.

| Option | Type | Required | Notes |
| --- | --- | --- | --- |
| `seconds` | integer | yes | `0` disables; clamped to **0–21600** (6 hours) |

### `/lock` and `/unlock`
Lock or unlock the current channel by editing the `@everyone` Send Messages
override. Do not create a case.

| Option | Type | Required |
| --- | --- | --- |
| `reason` | string | no |

---

## Cases, mod-log and DM behaviour

The member actions (`timeout`, `untimeout`, `kick`, `ban`, `unban`) share one
pipeline (`runAction` in `commands.ts`):

1. Resolve the guild's `GuildService`; if the bot is disconnected, reply
   `The bot is not connected right now.`
2. Owner check (for the punitive actions above).
3. Perform the Discord action; on failure reply with a safe message and stop —
   **no case is recorded for a failed action**.
4. Create a `moderation_cases` row with the next per-guild case number.
5. **Optional DM** — if `dmOnAction` is set, DM the target a short notice with
   the action type and reason (best-effort; failures are swallowed).
6. **Optional mod-log** — if `logChannelId` is set, post
   `**Case #N** · <action> · <@target> by <@moderator>` with the reason
   (best-effort).
7. Write an audit entry and reply `Case #N: <action> applied.`

`/warn` follows a similar path through `WarningService` plus a `warn` case but
does not run the owner check, DM or mod-log steps.

### Per-guild case numbers

`moderation_cases.case_number` is **sequential per guild**, computed as
`max(case_number) + 1` for that guild (`nextCaseNumber` /
`create` in `cases-repo.ts`). A unique index
`moderation_cases_guild_number_idx` on `(guild_id, case_number)` enforces
uniqueness; on the rare concurrent collision the insert retries (up to 3
attempts).

---

## Configuration in the admin panel

Open **`/moderation`** in the admin panel (route registered in
`apps/admin/src/server.ts`, view `apps/admin/views/moderation.ejs`). The page
is login-protected (`requireAuth`).

The page shows, for the selected guild (chosen via the `?guild=<id>` query
parameter; defaults to the first guild):

- **Module status** — name, enabled/disabled badge, description.
- **Moderation cases** — the latest 50 cases for the guild: number, time,
  action type, target ID, moderator ID, reason
  (`moderationCases.listByGuild(guildId, 50)`).
- **Warnings** — recent warnings with active/revoked status.
- **Moderation actions** — the legacy action ledger.
- **Rules** — moderation/automod rule rows with an enable/disable toggle
  (`POST /moderation/rules/:id/toggle`, CSRF-protected, requires a mutating
  admin role).

### Mod-log channel and DM-on-action

These live in the **`moderation_settings`** table (one row per guild,
`packages/database/src/schema.ts`):

| Column | Default | Effect |
| --- | --- | --- |
| `log_channel_id` | `null` | Channel ID where case summaries are posted. Unset = no mod-log. |
| `dm_on_action` | `true` | Whether the affected user is DMed on each member action. |
| `mute_strategy` | `'timeout'` | `'timeout'` (native, used by `/timeout`) or `'role'`. |
| `mute_role_id` | `null` | Mute role for the `'role'` strategy. |
| `command_config` | `{}` | Reserved JSON for per-command enablement / permission overrides. |

The repo exposes `getSettings` / `upsertSettings`
(`cases-repo.ts`). If no dedicated settings form is present in your build, set
these directly:

```bash
docker compose exec app pnpm db:studio   # browse/edit moderation_settings
```

---

## Database tables

| Table | Purpose |
| --- | --- |
| `moderation_cases` | One row per recorded case. Columns: `case_number` (per-guild), `action_type` enum, `target_user_external_id`, `moderator_external_id`, `reason`, `status` (`open`/`resolved`/`expired`/`revoked`, default `open`), `expires_at` (set for timeouts), `metadata` jsonb, timestamps. Indexed by guild+number (unique), guild+target, and creation time. Deleted on guild removal (cascade). |
| `moderation_settings` | Per-guild config (mod-log channel, DM toggle, mute strategy/role, command config). Primary key `guild_id`. |

`action_type` enum values: `warn`, `mute`, `unmute`, `kick`, `ban`, `unban`,
`purge`, `role_assign`, `other` (`moderationActionType` in `schema.ts`). The
commands use `warn`, `mute`, `unmute`, `kick`, `ban`, `unban` and `other`
(for `clearwarnings`).

The legacy `warnings`, `moderation_actions`, `moderation_rules` and
`permission_mappings` tables from the foundation still exist and feed the
warnings/actions/rules sections of the admin page, but the shipped commands
write to `moderation_cases` (plus `warnings` for `/warn`).

---

## Audit events

Every action records to `audit_logs`. Member actions and purges use
`actorType: 'platform_user'`, `actorId: <moderator's external id>`,
`moduleKey: 'moderation'`, `severity: 'notice'`:

| Source | `action` | Notes |
| --- | --- | --- |
| `/timeout` | `moderation.mute` | `metadata.case = <caseNumber>` |
| `/untimeout` | `moderation.unmute` | `metadata.case` |
| `/kick` | `moderation.kick` | `metadata.case` |
| `/ban` | `moderation.ban` | `metadata.case` |
| `/unban` | `moderation.unban` | `metadata.case` |
| `/purge` | `moderation.purge` | `metadata.deleted = <count>`; no case row |
| `/warn` | `moderation.warning.created` | from `WarningService`; `metadata.warningId`, truncated reason |
| Admin rule toggle | `moderation.rule.toggled` | `actorType: 'admin'`, `metadata.enabled` |

The module advertises
`auditEvents: ['moderation.warn', 'moderation.mute', 'moderation.kick',
'moderation.ban', 'moderation.purge']` in its metadata; the action string for
member commands is `moderation.<actionType>` (so `/timeout` → `moderation.mute`,
matching the enum, not the command name). `/warn` records as
`moderation.warning.created` via the warning service.

---

## Privacy and security notes

- **No raw message content** is stored or audited. Reasons are truncated
  (480 chars in cases, 300 chars in audit metadata) before persistence.
- **Owner protection** prevents `/timeout`, `/kick` and `/ban` from targeting
  the server owner.
- **DM and mod-log are best-effort** — a user with DMs closed, or a missing
  log channel, will not block or fail the action.
- **Failed actions are not recorded** — a case is only created after the Discord
  action succeeds, so the ledger reflects what actually happened.
- **DM mentions are neutralised** — the DM and log messages disable
  `everyone`/role/user pings (`allowMentions` all-empty) so they cannot be used
  to mass-mention.
- Admin mutations (the rule toggle) require a mutating admin role, pass CSRF
  protection and are themselves audited with `actorType: 'admin'`.

---

## Known limitations

- **`/clearwarnings` does not delete warnings** — it appends an `other` case
  noting the clear. History is intentionally append-only.
- **Temporary bans do not auto-expire** — `/ban` has no duration option; only
  timeouts (which Discord expires natively) self-lift. A ban must be reversed
  with `/unban`.
- **`/purge` is limited to 1–100 messages** and cannot remove messages older
  than ~14 days (Discord bulk-delete limit).
- **No in-app role/RBAC gate** — access is entirely Discord's
  `default_member_permissions` (plus optional per-guild Integration overrides).
  The `permission_mappings` RBAC layer from the roadmap is not wired into these
  commands.
- **Cases are not editable from the panel** — the Moderation page is read-only
  for cases (rules can be toggled).

---

## Docker commands

```bash
# Apply migrations (creates moderation_cases / moderation_settings)
docker compose exec app pnpm db:migrate

# Seed/register modules if the Moderation page shows "not registered yet"
docker compose exec app pnpm db:seed

# Inspect cases and settings
docker compose exec app pnpm db:studio

# Tail bot logs to confirm "moderation module ready"
docker compose logs -f app
```
