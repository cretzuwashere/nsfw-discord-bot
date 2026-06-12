# Moderation Roadmap

Status: **v1 = foundation only.** The moderation module
(`packages/moderation-module`) ships services and persistence plumbing but **no
slash commands** (`module.commands` is `[]`). This document is the plan for
turning the foundation into real moderation features, in dependency order.

## 1. What exists today (v1 foundation)

| Piece | Where | Notes |
| --- | --- | --- |
| Module factory | `packages/moderation-module/src/index.ts` | `createModerationModule({ config, logger, db, audit? })` returns `{ module, services }`. `db: null` → `services: null`. Audit defaults to a no-op port; the bot app passes the database audit log (`createDbAuditLog` in `packages/database/src/ports.ts`). |
| WarningService | `packages/moderation-module/src/services/warning-service.ts` | `warnUser` (ensure guild + platform user rows, insert, audit), `listRecent`, `revoke`. |
| ModerationActionService | `packages/moderation-module/src/services/action-service.ts` | `recordAction` for any `moderation_action_type`, audits `moderation.action.<type>`. |
| RuleService | `packages/moderation-module/src/services/rule-service.ts` | Thin wrapper over rule storage; audits `moderation.rule.updated`. |
| PermissionService | `packages/moderation-module/src/services/permission-service.ts` | `hasPermission({ guildExternalId, roleExternalIds, permission })`, `grant`, `revoke`. Backed by `createPermissionsRepo` (`packages/moderation-module/src/services/permissions-repo.ts`). |
| Repositories | `packages/database/src/repositories/moderation.ts`, `packages/database/src/repositories/guilds.ts` | Warnings, actions, rules, platform users; guild upsert by external id. |

Services depend on narrow repo-shaped ports
(`packages/moderation-module/src/services/deps.ts`), so unit tests inject plain
fakes — no database required.

## 2. Existing data model

All tables live in `packages/database/src/schema.ts` and already exist in
migrations. Future features build on them without schema rewrites.

- **`platform_users`** — people seen through adapters (Discord users), keyed by
  `(adapter_key, external_id)`, distinct from `admin_users` (panel logins).
  Every warning/action target is upserted here first, so moderation history
  survives username changes. Future: per-user moderation summaries ("3 warnings
  in 30 days") and automod escalation thresholds.
- **`warnings`** — one row per warning: `guild_id`, `user_id`, `moderator_id`
  (external id), `reason`, `revoked_at` for soft revocation. Future: `/warn`,
  `/warnings`, `/unwarn` commands and the admin warning list; escalation rules
  count non-revoked rows.
- **`moderation_actions`** — the permanent action ledger: `action_type` enum
  (`warn`, `mute`, `unmute`, `kick`, `ban`, `unban`, `purge`, `role_assign`,
  `other`), free-form `metadata` jsonb (e.g. purge message count), `expires_at`
  for temporary mutes/bans. Every slash command and automod trigger records
  here. Future: the job layer scans `expires_at` to lift expired mutes/bans.
- **`moderation_rules`** — automod configuration: `rule_type`
  (`forbidden_words`, `link_filter`, `spam_protection`, `raid_protection`, …),
  jsonb `config`, `enabled` flag, nullable `guild_id` (null = global default).
  The admin rule editor edits these rows; the bot evaluates enabled rules per
  message event.
- **`permission_mappings`** — RBAC foundation: `(guild_id, external_role_id,
  permission)` unique triples mapping adapter roles (Discord role snowflakes)
  to platform permission keys. Read by `PermissionService.hasPermission` before
  any moderation command executes.

Related: `audit_logs` receives an entry for every moderation mutation (actions
`moderation.warning.created`, `moderation.action.<type>`,
`moderation.rule.updated`, `moderation.permission.granted/revoked`), and
`module_settings` / `guild_settings` hold per-guild feature flags.

## 3. Permission model

Permission keys are dotted strings owned by modules:

| Key | Grants |
| --- | --- |
| `moderation.warn` | `/warn`, `/unwarn` |
| `moderation.mute` | `/mute`, `/unmute` |
| `moderation.kick` | `/kick` |
| `moderation.ban` | `/ban`, `/unban` |
| `moderation.purge` | `/purge` |
| `moderation.roles` | `/role assign/remove` |
| `moderation.rules.manage` | automod rule changes from chat (later) |

Check flow for a command invocation:

1. The Discord adapter resolves the invoking member's role ids and passes them
   through the command context (adapter extension — see Phase 1).
2. The command handler calls `PermissionService.hasPermission`; the query joins
   `permission_mappings` to `guilds` on `(adapter_key, external_id)` and
   matches any held role.
3. Denied → reply with a `UserFacingError('PERMISSION_DENIED', …)` safe message
   (`packages/shared/src/errors.ts`); raw errors never reach Discord.

Notes:

- Admin panel roles (`admin_users.role`: `owner` / `admin` / `viewer`) control
  **panel access only** and are unrelated to in-guild RBAC. Mappings are edited
  in the panel (owner/admin) or later via a `/modperms` command.
- Default posture is deny: a guild with no mappings gets no moderation
  commands. A sensible bootstrap is a panel button that maps a chosen Discord
  role to all `moderation.*` keys. (Falling back to native Discord permissions,
  e.g. "Ban Members", is a possible later convenience — decide before Phase 2.)

## 4. Slash command phases

All commands are plain `CommandDefinition`s
(`packages/core/src/contracts/commands.ts`) registered on the module in
`packages/moderation-module/src/index.ts`; the existing kernel/registry
(`packages/core/src/registry.ts`) already handles dispatch, module
enable/disable and the error boundary.

**Phase 0 — adapter prerequisites (blocking).** `CommandContext` currently
carries no member role ids and no way to act on members. Two core/adapter
extensions, mirroring how voice is done (`voice: VoiceCapability | null` in
`packages/core/src/contracts/voice.ts`):

- Add `memberRoleIds: string[]` (or `member: { roleExternalIds: string[] }`) to
  `CommandContext`, filled by the Discord adapter from the interaction member.
- Add a `ModerationCapability` port (new `packages/core/src/contracts/`
  contract): `timeoutMember(userId, until)`, `removeTimeout(userId)`,
  `kickMember(userId, reason)`, `banMember(userId, opts)`, `unbanMember`,
  `purgeMessages(channelId, count)`, `assignRole`/`removeRole` — implemented in
  the Discord adapter with discord.js, exposed as `ctx.moderation` (null when
  unsupported).

**Phase 1 — warnings (no Discord-side enforcement needed):** `/warn user
reason`, `/warnings [user]`, `/unwarn id`. Uses only `WarningService` +
`PermissionService` + `memberRoleIds`; no `ModerationCapability` required, so
it can ship as soon as role ids are in the context. Options map to
`CommandOptionDef` (`user` as string id until a `user` option type is added to
the contract).

**Phase 2 — mute/kick:** `/mute user duration reason` (Discord timeout),
`/unmute user`, `/kick user reason`. Each calls `ctx.moderation`, then
`ModerationActionService.recordAction` with `expiresAt` for mutes. Requires the
job layer *or* Discord-native timeouts (which self-expire — preferred, no job
needed for mute).

**Phase 3 — ban/purge:** `/ban user [days] reason`, `/unban user`, `/purge
count [user]`. Purge records `metadata: { count, channelId }` with no target
user. Temporary bans need the job layer (section 5) to call `unbanMember` at
`expires_at`.

**Phase 4 — roles:** `/role assign user role`, `/role remove user role`,
recorded as `role_assign` actions. Gate which roles are assignable via a
`moderation_rules` row or `module_settings` to prevent privilege escalation
(never allow assigning roles above the bot's own).

## 5. Automod (rule engine)

A message-event pipeline in the Discord adapter feeds enabled
`moderation_rules` evaluated per guild:

- **`forbidden_words`** — `config: { words: string[], matchMode: 'word' |
  'substring', action: 'delete' | 'warn' | 'mute' }`. Escalation reuses
  `WarningService` / `ModerationActionService`, so automod and manual actions
  share one ledger.
- **`link_filter`** — reuse the SSRF-safe URL validator
  (`validateExternalUrl` in `packages/security/src/url-validation.ts`) plus a
  per-guild domain allow/deny list in `config`. The validator already
  classifies invalid/blocked/unsupported URLs with safe reasons.
- **`spam_protection`** — in-memory sliding-window rate counters (messages per
  user per N seconds, duplicate-message detection). Counters stay in process
  memory (like the audio queue) — no schema change; thresholds live in rule
  `config`.
- **`raid_protection`** — join-rate counters per guild; over threshold →
  temporary join gate + alert, recorded as an `other` action with metadata.
- **Scheduled announcements & expiry enforcement** — both need a small job
  layer (interval scheduler in the bot app, later a `jobs` table if
  persistence is needed): lift expired bans (`moderation_actions.expires_at`),
  post scheduled announcements, roll up warning statistics.

Order: forbidden words → link filter → spam → raid. Each rule evaluation that
triggers an action must audit (`moderation.automod.<ruleType>`) with rule id
and a safe summary — never raw message content in audit metadata.

## 6. Admin panel extensions (`apps/admin`)

- **Rule editor** — CRUD over `RuleService` (list/upsert/toggle already
  implemented); per-rule JSON config form with zod validation server-side,
  global vs per-guild scope selector.
- **Action timeline** — paged view over `moderation_actions` joined with
  `platform_users` and `guilds`, filterable by guild/type/moderator; warning
  list with revoke buttons (`WarningService.revoke`).
- **Permission mapping editor** — table per guild over
  `PermissionService.listForGuild` / `grant` / `revoke`; role ids fetched from
  the bot via the internal API (`packages/shared/src/internal-api.ts`) so the
  panel can show role names, not snowflakes.
- **Per-guild config** — moderation feature flags in
  `guild_settings.feature_flags` / `module_settings` (e.g. automod on/off per
  guild) alongside the existing audio settings.

All panel mutations go through the existing authenticated admin app and write
`audit_logs` entries with `actorType: 'admin'`.

## 7. Sequencing summary

1. Phase 0 adapter/context extensions (role ids + `ModerationCapability`).
2. Phase 1 warnings commands (smallest end-to-end slice, validates RBAC).
3. Panel: permission mapping editor + action timeline (makes RBAC usable).
4. Phase 2 mute/kick (Discord-native timeouts, no job layer).
5. Phase 3 ban/purge + minimal job layer for temp-ban expiry.
6. Automod rules (forbidden words → link filter → spam → raid) + rule editor.
7. Phase 4 role assignment + scheduled announcements.

Open questions to settle before Phase 0: native-Discord-permission fallback
(section 3), a `user` option type in `CommandOptionDef`, and whether rule
evaluation needs per-guild caching of `moderation_rules` (likely yes — refresh
on `moderation.rule.updated` audit events or a short TTL).
