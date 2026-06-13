# Permission Model

This document explains how access control works across the platform. There are
**three distinct layers**, and it is important not to confuse them:

1. **Admin panel RBAC** — who can log into the web admin and whether they can
   change settings (owner/admin) or only look (viewer).
2. **Discord command gating** — which Discord members can see and run a slash
   command, enforced by Discord itself via `default_member_permissions`.
3. **Role → permission mappings** — the `permission_mappings` table, a
   foundation for mapping adapter (Discord) roles to platform permission keys.
   This is wired up at the data/service layer today; a full editor UI and
   runtime enforcement in command dispatch are on the roadmap.

A fourth, separate concern is **what the bot itself is allowed to do** in
Discord (the bot's own role permissions). That is covered at the end.

---

## 1. Admin panel RBAC (owner / admin / viewer)

The web admin (`apps/admin`, Fastify 5 + EJS) is login-protected. Each admin
account has exactly one role, stored in the `admin_users` table.

**Roles** are defined as a Postgres enum (`admin_role`) in
`packages/database/src/schema.ts`:

```ts
export const adminRole = pgEnum('admin_role', ['owner', 'admin', 'viewer']);
```

The `admin_users` table (same file) holds `email`, `password_hash`
(argon2), `role` (defaults to `admin`), and `last_login_at`.

| Role     | Can log in | Read pages | Change settings / mutate |
|----------|:----------:|:----------:|:------------------------:|
| `owner`  | yes        | yes        | yes                      |
| `admin`  | yes        | yes        | yes                      |
| `viewer` | yes        | yes        | **no** (read-only)       |

### How it is enforced

Two preHandler guards in `apps/admin/src/server.ts` protect every route:

- **`requireAuth`** — redirects to `/login` if there is no authenticated
  session (`adminId`).
- **`requireMutatingRole`** — returns **403 Forbidden** ("Viewers cannot change
  settings.") unless the session role is `owner` or `admin`:

  ```ts
  const requireMutatingRole = async (request, reply) => {
    const role = request.session.get('adminRole');
    if (role !== 'owner' && role !== 'admin') {
      return reply.code(403).view('error', { /* Forbidden */ });
    }
  };
  ```

Read routes (`GET /dashboard`, `/modules`, `/moderation`, `/audit-logs`, etc.)
use only `requireAuth`, so viewers can browse everything. Mutating routes
(toggling a module, saving settings, scheduling an announcement, uploading a
card, deleting a birthday, …) chain
`[requireAuth, requireMutatingRole, app.csrfProtection]`, so a viewer is blocked
before any change happens.

The same guards are exposed to per-module route plugins through
`AdminRouteContext` (`apps/admin/src/routes/context.ts`), so module routes under
`apps/admin/src/routes/*.ts` get identical RBAC without re-implementing it:

```ts
/** preHandler that 403s viewers (owner/admin may proceed). */
requireMutatingRole: preHandlerHookHandler;
```

> **Note:** `owner` and `admin` are treated identically by the current guard.
> The distinction exists in the schema for future use (e.g. only `owner` being
> able to manage other admin accounts); today both are full read/write admins.

### Other admin security controls

Beyond roles, the admin panel applies (see `apps/admin/src/server.ts` and
`docs/SECURITY.md`): argon2 password hashing, encrypted session cookies, CSRF
protection (`app.csrfProtection` on state-changing routes), and login rate
limiting.

### Audit trail

Admin actions are audited to the `audit_logs` table with `actorType: 'admin'`
and `actorId` = the admin's user id. Examples emitted from the admin routes:

- `admin.login` and `admin.login.failed` (`apps/admin/src/server.ts`)
- `module.enabled` / `module.disabled`
- `announcement.scheduled` / `announcement.canceled` / `announcement.deleted`
- `birthday.settings.updated` / `birthday.deleted`
- `card.asset.uploaded` / `card.template.archived`
- `welcome.settings.updated`

View these under **Audit Logs** (`/audit-logs`) in the admin panel.

---

## 2. Discord command gating (`default_member_permissions`)

Which **Discord members** can use a slash command is controlled by Discord
itself, not by the admin panel. Commands declare the Discord permission names
that gate them; the platform translates those into the bitfield Discord expects
at command-registration time.

### Where it is declared

The adapter-neutral `CommandDefinition`
(`packages/core/src/contracts/commands.ts`) carries:

```ts
/**
 * Discord permission names that gate visibility/use (default_member_permissions).
 * E.g. ['KickMembers']. The platform still re-checks the bot's own
 * permissions before acting.
 */
defaultMemberPermissions?: string[];
```

### How it is enforced

The Discord adapter's command mapper
(`packages/discord-adapter/src/command-mapper.ts`) converts those names into a
stringified permissions bitfield and sets `default_member_permissions` on the
registered command:

```ts
if (command.defaultMemberPermissions && command.defaultMemberPermissions.length > 0) {
  json.default_member_permissions = permissionsToBitfield(command.defaultMemberPermissions);
}
```

`permissionsToBitfield` looks each name up in `PermissionsBitField.Flags` from
discord.js. The result is that:

- Members **without** the required permission do not see the command and cannot
  invoke it (Discord hides/blocks it).
- Server admins can further override per-command visibility in **Server
  Settings → Integrations** in Discord.
- This is a **visibility/use gate**, not a substitute for the bot's own
  permission check — see the inline comment "The platform still re-checks the
  bot's own permissions before acting."

### Moderation command → required Discord permission

The moderation module (`packages/moderation-module/src/commands.ts`) is the main
consumer. Each command's gate:

| Command           | `default_member_permissions` |
|-------------------|------------------------------|
| `/warn`           | `ModerateMembers`            |
| `/warnings`       | `ModerateMembers`            |
| `/clearwarnings`  | `ModerateMembers`            |
| `/timeout`        | `ModerateMembers`            |
| `/untimeout`      | `ModerateMembers`            |
| `/kick`           | `KickMembers`                |
| `/ban`            | `BanMembers`                 |
| `/unban`          | `BanMembers`                 |
| `/purge`          | `ManageMessages`             |
| `/slowmode`       | `ManageChannels`             |
| `/lock`           | `ManageChannels`             |
| `/unlock`         | `ManageChannels`             |

All of these are also `guildOnly: true`, so they are registered with
`contexts: [0]` (guild-only, no DMs).

### Owner protection (additional runtime guard)

Independent of `default_member_permissions`, destructive moderation actions
(`/timeout`, `/kick`, `/ban`) set `protectOwner: true`. At runtime,
`runAction` in `packages/moderation-module/src/commands.ts` calls
`service.isGuildOwner(...)` and refuses the action against the server owner:

```ts
if (opts.protectOwner && (await service.isGuildOwner(opts.targetExternalId)...)) {
  await ctx.reply({ content: 'That action cannot target the server owner.', ephemeral: true });
  return;
}
```

Every successful moderation action is recorded as a `moderation_cases` row and
audited (`action: 'moderation.<actionType>'`, `actorType: 'platform_user'`),
with an optional DM to the target and an optional mod-log message when
configured.

---

## 3. Role → permission mappings (`permission_mappings`)

This is the **foundation** for fine-grained, role-based command permissions that
go beyond Discord's built-in permission flags — for example, "members with the
@DJ role may use audio controls" or "@Helper may warn but not ban."

### The table

Defined in `packages/database/src/schema.ts`:

```ts
/** Maps adapter roles to platform permission keys (foundation for RBAC). */
export const permissionMappings = pgTable('permission_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  guildId: uuid('guild_id').notNull().references(() => guilds.id, { onDelete: 'cascade' }),
  /** External role id on the platform (e.g. Discord role snowflake). */
  externalRoleId: text('external_role_id').notNull(),
  /** Platform permission key, e.g. 'moderation.warn', 'audio.control'. */
  permission: text('permission').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('permission_mappings_unique_idx').on(
    table.guildId, table.externalRoleId, table.permission),
]);
```

A mapping ties **one Discord role** (`external_role_id`, a snowflake) to **one
platform permission key** (a dotted string like `moderation.warn` or
`audio.control`) within **one guild**. The unique index makes each
(guild, role, permission) triple appear at most once. Deleting a guild cascades
to its mappings.

### The service

`packages/moderation-module/src/services/permission-service.ts` provides a
`PermissionService` over this table:

- `hasPermission({ guildExternalId, roleExternalIds, permission, adapterKey? })`
  — returns `true` if **any** of the member's roles grants the permission.
  An empty role list always returns `false`.
- `grant({ guildExternalId, adapterKey, externalRoleId, permission })` —
  idempotent; upserts the guild, inserts the mapping (`onConflictDoNothing`),
  and audits `moderation.permission.granted`.
- `revoke(...)` — removes the mapping and audits
  `moderation.permission.revoked`.
- `listForGuild(guildId)` — lists all mappings for a guild.

The underlying query work lives in
`packages/moderation-module/src/services/permissions-repo.ts`
(`hasAny`, `grant`, `revoke`, `listForGuild`). It lives in the moderation
package deliberately — per the source comment, "role-based permissions are a
moderation concern; it moves down a layer once other modules need it."

> The default adapter for checks is the Discord adapter (`ADAPTER_KEYS.discord`)
> when `adapterKey` is omitted.

### Current status and roadmap

The mapping table and service exist and are unit-tested, but:

- **No editor UI yet.** The **Permissions** page in the admin panel
  (`/permissions`) is currently **informational only**. It is served as a
  placeholder (`apps/admin/src/routes/placeholders.ts`,
  view `apps/admin/views/placeholder.ejs`) with the description:
  *"Map platform roles to module permissions. Role→permission mappings are
  stored in `permission_mappings`; full editor is on the roadmap."*
- **Not yet wired into command dispatch.** Slash-command access today is gated
  by Discord's `default_member_permissions` (section 2), not by
  `permission_mappings`. The `hasPermission` check is not yet called from the
  bot's command pipeline.

A full permissions editor UI (assigning role → permission mappings from the
admin panel) and runtime enforcement in command dispatch are planned. Until
then, treat `permission_mappings` as plumbing, not as the live access-control
mechanism.

---

## 4. Bot permissions required per module (Discord side)

Separate from who may *invoke* a feature is what the **bot's own role** must be
allowed to do for the feature to work. Grant these in the bot's invite scope and
ensure the bot's role is high enough in the role list (Discord role hierarchy:
the bot cannot moderate or assign roles above its own highest role).

| Module                | Bot permissions it needs                                            |
|-----------------------|---------------------------------------------------------------------|
| audio-player          | Connect, Speak (voice); View Channel                                |
| announcements         | View Channel, Send Messages, Embed Links                            |
| dynamic-cards         | Send Messages, Attach Files (PNG attachments)                       |
| welcome               | Send Messages, Embed Links, Attach Files; **Manage Roles** (auto-roles); DMs for DM welcomes |
| role-menus            | **Manage Roles**, Send Messages, Use components                     |
| birthdays             | Send Messages, Embed Links; **Manage Roles** if a birthday role is assigned |
| reminders             | Send Messages; ability to DM the user (channel or DM delivery)      |
| scheduled-messages    | View Channel, Send Messages, Embed Links                            |
| moderation            | Moderate Members (timeout), Kick Members, Ban Members, Manage Messages (purge), Manage Channels (slowmode/lock) |
| automod               | Manage Messages (delete), plus Moderate/Kick/Ban depending on configured actions |
| custom-commands       | Send Messages, Embed Links                                          |

For **Manage Roles** to work (welcome auto-roles, role-menus, birthday roles),
the bot's own role must sit **above** every role it manages in Server Settings →
Roles.

### Required gateway intents (recap)

Bot permissions are not the same as gateway intents. The platform requires:

- **Guilds** and **GuildVoiceStates** — always (voice needs GuildVoiceStates).
- **GuildMembers** (privileged) — member join/leave for welcome, and role
  assignment for welcome/birthday.
- **GuildMessages** and **GuildModeration**.
- **MessageContent** (privileged) — required for automod **content** rules
  (banned words, caps, links, etc.); gated by `DISCORD_ENABLE_MESSAGE_CONTENT`.
  Without it, automod content rules run in a **DEGRADED** state.

Privileged intents (GuildMembers, MessageContent) must be enabled in the
**Discord Developer Portal** for your application. See `docs/DISCORD_SETUP.md`
for the full setup and `docs/SECURITY.md` for the security model.

---

## Quick reference: where things live

| Concern                                   | File |
|-------------------------------------------|------|
| Admin roles enum + `admin_users` table    | `packages/database/src/schema.ts` |
| Admin RBAC guards (`requireMutatingRole`) | `apps/admin/src/server.ts` |
| Guards shared to module routes            | `apps/admin/src/routes/context.ts` |
| Command gating contract                   | `packages/core/src/contracts/commands.ts` |
| `default_member_permissions` mapping      | `packages/discord-adapter/src/command-mapper.ts` |
| Moderation command gates + owner protect  | `packages/moderation-module/src/commands.ts` |
| `permission_mappings` table               | `packages/database/src/schema.ts` |
| `PermissionService`                       | `packages/moderation-module/src/services/permission-service.ts` |
| Permissions repo (SQL)                    | `packages/moderation-module/src/services/permissions-repo.ts` |
| `/permissions` placeholder page           | `apps/admin/src/routes/placeholders.ts` |

## Managing admin accounts (Docker)

Admin accounts live in the `admin_users` table. Operational tasks (creating the
first owner, resetting a password) run through the app container, e.g.:

```bash
docker compose exec app pnpm <admin-user-script>
```

See `docs/ADMIN_PANEL.md` and `docs/DOCKER_DEPLOYMENT.md` for the exact
seeding/management commands and first-run setup. Database migrations that create
these tables are applied from `packages/database/migrations`.
