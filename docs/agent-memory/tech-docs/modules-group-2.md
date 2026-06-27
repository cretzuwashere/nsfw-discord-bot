# Module Group 2 — dynamic-cards, role-menus, birthdays, reminders

Verified in code on 2026-06-27 against `packages/*/src/`, `packages/database/src/schema.ts`,
`packages/database/src/seed.ts`, `apps/bot/src/main.ts`, and `apps/admin/src/routes/`.
"verified" = read directly in source; "deduced" = inferred from surrounding code; nothing here is
documented-elsewhere-unverified.

---

## 1. dynamic-cards (`cards-module`) — `MODULE_KEYS.dynamicCards` = `cards-module`

- Package dir: `packages/cards-module`
- Purpose: a **rendering service** that generates personalized PNGs (welcome cards, birthday cards,
  banners) from sanitized layout templates. NOT a user-facing command module.
- Factory: `createCardsModule({ config, logger, db })` in `packages/cards-module/src/index.ts`.
  Returns `{ module, service, storage }`. Wired in `apps/bot/src/main.ts:72`.
- Slash commands: **NONE** (`commands: []`, verified `index.ts:41`). It exposes a `CardsService`
  consumed by other modules + the admin preview. main.ts bridges it into welcome via
  `renderCard: (templateId, data) => cardsHandle.service.renderById(...)` (`main.ts:79-81`); the
  birthdays admin route also reads card templates (`apps/admin/src/routes/birthdays.ts:2`).
- Platform events handled: **NONE** (no `events` array).
- Interaction handlers: **NONE**.
- Scheduler jobs: **NONE** (handle has no `schedulerJob`; nothing registered in main.ts).
- DB tables (verified `schema.ts:434-469`):
  - `card_templates` (`cardTemplates`): id, guildId (null = global), name, kind
    (welcome|birthday|announcement|role_unlock|event|generic), width(1000)/height(420),
    `layout` jsonb (sanitized), backgroundAssetId, archivedAt (soft-delete), timestamps.
  - `card_assets` (`cardAssets`): id, guildId, `storagePath` (relative to uploads volume — never
    absolute host path), originalName, mimeType, byteSize, createdAt.
- metadata (verified `index.ts:37-40`):
  - `requiredPermissions: ['AttachFiles']`
  - `requiredIntents`: **NOT SET** (omitted)
  - `auditEvents: ['card.template.created', 'card.template.updated', 'card.template.archived']`
- Admin route: **`apps/admin/src/routes/cards.ts`** (registered `routes/index.ts:20`). Routes:
  `GET /cards`, `GET /cards/new`, `GET /cards/:id`, `POST /cards/:id/save`,
  `GET /cards/:id/preview.png`, `POST /cards/upload`, `POST /cards/:id/archive`.
- Default-enabled (seed.ts:43-48): **false**. Seed name `Dynamic Cards`.
- Notable gaps/caveats:
  - Avatar/background image fetch is SSRF-guarded via `openSafeHttpStream` and capped at
    `DEFAULT_MAX_IMAGE_BYTES = 8 MiB` (`service.ts:17,72-95`).
  - `backgroundAssetId` column on `card_templates` is not a real FK (plain uuid, no `.references`);
    asset resolution happens through the layout JSON's `background.assetId`, not this column
    (`service.ts:38`). Deduced: the column appears legacy/unused by the renderer.

---

## 2. role-menus (`role-menus-module`) — `MODULE_KEYS.roleMenus` = `role-menus-module`

- Package dir: `packages/role-menus-module`
- Purpose: self-assignable roles via buttons / select menus (seed name **"Reaction Roles"**).
- Factory: `createRoleMenusModule({ config, logger, db, audit, guildServiceProvider })`
  (`index.ts:28`). Wired in `main.ts:82-88`.
- Slash command (verified `commands.ts`): single top-level **`/roles`** (`guildOnly: true`),
  with subcommands:
  - `list` — list role menus (ephemeral). Gate: **none**.
  - `menu <id:string,required>` — publish a menu to the current channel. Gate: **none**.
  - `refresh <id:string,required>` — re-publish (deletes old message, re-sends). Gate: **none**.
  - `remove <id:string,required>` — disable a menu (`enabled=false`). Gate: **none**.
  - **defaultMemberPermissions gate: NONE on the command or any subcommand** (the type supports it
    — `core/src/contracts/commands.ts:70` — but it is not set). CAVEAT below.
- Platform events handled (verified `index.ts:50-55`): **`component.interaction`** →
  `service.handleInteraction`.
- Interaction handlers (customId patterns, verified `logic.ts:94-107` + `service.ts`):
  - Button: `rolemenu:<menuId>:<roleId>` (`buttonCustomId`). Toggles/sets that single role per the
    menu mode.
  - Select: `rolemenu:<menuId>` (`selectCustomId`); chosen values = full desired set.
  - `parseCustomId` rejects anything not starting with `rolemenu:`. Behavior: resolves menu, checks
    `enabled`, computes add/remove via pure `computeRoleChanges` honoring mode
    (add_only|remove_only|single|unique|multiple/toggle) and constraints
    (maxSelections, requiredRoleId, blockedRoleId), then calls
    `guildService.addRole/removeRole` and logs each change to `role_assignment_logs`.
- Scheduler jobs: **NONE**.
- DB tables (verified `schema.ts:495-554`):
  - `role_menus` (`roleMenus`): id, guildId (FK), name, `type` enum (default `button`),
    `mode` enum (default `multiple`), channelId, messageId, style (plain|embed|card, default embed),
    title, description, `constraints` jsonb, enabled (default true), timestamps.
  - `role_menu_options` (`roleMenuOptions`): id, menuId (FK cascade), roleId, label, description,
    emoji, position.
  - `role_assignment_logs` (`roleAssignmentLogs`): bigserial id, guildId (FK), menuId
    (FK set-null), userExternalId, roleId, action (added|removed), createdAt.
- metadata (verified `index.ts:44-48`):
  - `requiredPermissions: ['ManageRoles', 'SendMessages']`
  - `requiredIntents: ['Guilds']`
  - `auditEvents: ['rolemenu.published']`
- Admin route: **`apps/admin/src/routes/role-menus.ts`** (registered `routes/index.ts:22`). The
  admin panel is the primary editor (command file comment: "admin panel is the primary editor").
  Routes: `GET /role-menus`, `/role-menus/new`, `/role-menus/:id`, `POST /role-menus/:id/save`,
  `POST /role-menus/:id/toggle`.
- Default-enabled (seed.ts:49-54): **false**. Seed name `Reaction Roles`.
- Notable gaps/caveats:
  - **CAVEAT (gating):** `/roles menu|refresh|remove` publish/disable role menus to channels with
    **no `defaultMemberPermissions` gate** — any guild member can invoke them. Replies are
    ephemeral but the publish side-effect posts a real message. Per-member button gating
    (`GuildService.memberHasPermission`) is NOT used by the interaction handler; constraint roles
    (requiredRoleId/blockedRoleId) are the only access control on button/select use.
  - Button menus cap at 25 options (`logic.ts:139`). Select max-values forced to 1 for
    single/unique modes.

---

## 3. birthdays (`birthdays-module`) — `MODULE_KEYS.birthdays` = `birthdays-module`

- Package dir: `packages/birthdays-module`
- Purpose: opt-in birthday announcements with optional birthday role (+ card template config in
  settings, though the scheduler does not currently render the card — see caveat).
- Factory: `createBirthdaysModule({ config, logger, db, audit, guildServiceProvider, adapterKey? })`
  (`index.ts:33`). Returns `{ module, repo, schedulerJob }`. Wired `main.ts:147-153`, scheduler
  registered `main.ts:207`.
- Slash command (verified `index.ts:44-113`): single **`/birthday`** (`guildOnly: true`),
  subcommands:
  - `set <month:int,req> <day:int,req> [year:int] [timezone:string]` — opt-in store/update. Gate:
    **none**.
  - `view` — show your saved birthday (ephemeral). Gate: **none**.
  - `remove` — hard-delete your birthday (privacy). Gate: **none**.
  - `upcoming` — list upcoming birthdays (filters out `visibility === 'private'`, max 15). Gate:
    **none**.
  - **defaultMemberPermissions gate: NONE** (all subcommands are self-service + ephemeral).
- Platform events handled: **NONE**.
- Interaction handlers: **NONE**.
- Scheduler job (verified `index.ts:116-183`):
  - name **`birthdays.announce`**, interval **`TICK_MS = 5 * 60_000` = every 5 minutes**
    (the per-hour announce-hour gate + per-(guild,user,date) dedup row prevents duplicates).
  - Logic: for each enabled `birthday_settings` with an announce channel, gates on the guild's
    `announceHour` in **UTC** (settings has no tz column), then matches each birthday's month/day in
    **the user's own timezone**, dedups via `birthday_announcements`, sends FIRST then records dedup
    (so transient failures retry), optionally adds the birthday role, and audits `birthday.announced`.
- DB tables (verified `schema.ts:559-615`):
  - `birthdays` (`birthdays`): id, guildId (FK), userExternalId, month, day, year (nullable),
    timezone (default UTC), visibility (public|members|private, default members), timestamps.
    Unique index on (guildId, userExternalId); index on (month, day).
  - `birthday_settings` (`birthdaySettings`): guildId PK/FK, enabled (default false),
    announcementChannelId, message (default "🎉 Happy birthday {{user.mention}}!"), cardTemplateId,
    roleEnabled, roleId, roleDurationHours (default 24), announceHour (default 9), updatedAt.
  - `birthday_announcements` (`birthdayAnnouncements`): bigserial id, guildId (FK), userExternalId,
    announcedOn (YYYY-MM-DD text), createdAt. Unique (guildId, userExternalId, announcedOn).
- metadata (verified `index.ts:189-193`):
  - `requiredPermissions: ['SendMessages', 'ManageRoles']`
  - `requiredIntents: ['Guilds']`
  - `auditEvents: ['birthday.announced']`
- Admin route: **`apps/admin/src/routes/birthdays.ts`** (registered `routes/index.ts:25`). Routes
  include `GET /birthdays`, `POST /birthdays/save`, plus a member-removal POST. Pulls card templates
  via `createCardsRepo`.
- Default-enabled (seed.ts:55-60): **false**. Seed name `Birthdays`.
- Notable gaps/caveats:
  - **CAVEAT:** `birthday_settings.cardTemplateId` and `roleDurationHours` are stored but the
    scheduler (`index.ts`) does **NOT** render a birthday card nor schedule role removal after
    `roleDurationHours` — the role is added (`addRole`) and never auto-removed in this code path.
    Deduced: card + temp-role-expiry are configured-but-unimplemented in the scheduler.
  - Announce-hour gate is UTC-only even though each birthday row has its own timezone (intentional,
    documented in the code comment `index.ts:127-129`).

---

## 4. reminders (`reminders-module`) — `MODULE_KEYS.reminders` = `reminders-module`

- Package dir: `packages/reminders-module`
- Purpose: personal + recurring reminders, delivered by DM or in a channel.
- Factory: `createRemindersModule({ config, logger, db, audit, guildServiceProvider, adapterKey? })`
  (`index.ts:34`). Returns `{ module, repo, schedulerJob }`. Wired `main.ts:140-146`, scheduler
  registered `main.ts:206`.
- Slash command (verified `index.ts:95-165`): single **`/reminder`** (`guildOnly: true`),
  subcommands:
  - `create <message:string,req> <when:string,req> [here:boolean] [repeat:string]` — create a
    reminder. `when`/`repeat` parsed by `parseDuration` (e.g. `30m`, `2h`, `1d 6h`, bare number =
    minutes; clamped 60s..365d). `here=true` → channel delivery, else DM. Enforces
    `MAX_PER_USER = 25` active reminders. Gate: **none**.
  - `list` — list your active reminders (ephemeral, max 50). Gate: **none**.
  - `remove <id:string,req>` — remove a reminder by id prefix (scoped to invoking user). Gate:
    **none**.
  - **defaultMemberPermissions gate: NONE** (self-service + ephemeral).
- Platform events handled: **NONE**.
- Interaction handlers: **NONE**.
- Scheduler job (verified `index.ts:167-174`):
  - name **`reminders.deliver-due`**, interval **`TICK_MS = 30_000` = every 30 seconds**.
  - Delivery (`deliver`, `index.ts:39-87`): channel delivery prepends role mentions +
    `<@user>`; DM fallback otherwise. If bot offline → leave dueAt unchanged (retry next tick).
    If send fails while online → `reschedule(+RETRY_BACKOFF_MS = 2 min)` (never drops a one-off /
    never skips a recurrence). On success: recurring → reschedule by `recurrenceSeconds`; one-off →
    `deactivate`. Audits `reminder.delivered`.
- DB tables (verified `schema.ts:617-640`):
  - `reminders` (`reminders`): id, guildId (nullable FK), userExternalId, deliveryType (dm|channel,
    default dm), channelId, message, timezone (default UTC), `dueAt` (required), recurrenceSeconds
    (null = one-off), `mentionRoleIds` jsonb string[] (default []), active (default true),
    createdByAdmin (default false), createdAt. Indexes on dueAt and userExternalId.
  - This is the **only** table for the module (no settings/log table).
- metadata (verified `index.ts:180-184`):
  - `requiredPermissions: ['SendMessages']`
  - `requiredIntents: ['Guilds']`
  - `auditEvents: ['reminder.delivered']`
- Admin route: **NONE** — there is no `apps/admin/src/routes/reminders.ts` and no entry in
  `routes/index.ts`. The schema has a `createdByAdmin` flag implying admin creation was planned,
  but no admin UI exists yet. **This is a real gap.** (Reminders is not covered by the
  placeholder plugin either — that plugin only covers paths no real module owns.)
- Default-enabled (seed.ts:61-66): **false**. Seed name `Reminders`.
- Notable gaps/caveats:
  - **GAP:** no admin route for reminders despite a `createdByAdmin` column → admin-created
    reminders are unreachable from the panel today.
  - `timezone` column on `reminders` is stored but unused by the delivery path (delays are computed
    as absolute `dueAt = now + seconds`); deduced legacy/forward-looking.
  - `/reminder` is `guildOnly` so DM-only usage is not possible; DMs are still the default delivery.

---

## Cross-cutting facts (verified)

- All 4 modules are wired in `apps/bot/src/main.ts` and present in the seed (`seed.ts`).
- Default-enabled: dynamic-cards, role-menus, birthdays, reminders are **all `false`** in seed.
- Scheduler registrations (main.ts): `reminders.deliver-due` (206), `birthdays.announce` (207).
  cards + role-menus register no jobs.
- `defaultMemberPermissions` IS a supported field on `CommandDefinition`
  (`core/src/contracts/commands.ts:70`) but **none** of these 4 modules use it — every command is
  `guildOnly` + ephemeral self-service. role-menus' publish subcommands are the main exposure.
- Admin routes present: cards, role-menus, birthdays. **Missing: reminders.**

## Checkpoint

Status: PASS

### Validat
- Slash commands, subcommands, options, and "no defaultMemberPermissions gate" for all 4 modules
  (read commands.ts / index.ts directly).
- Platform events: only role-menus subscribes (`component.interaction`).
- Interaction customId patterns for role-menus (`rolemenu:<menuId>[:<roleId>]`) from logic.ts.
- Scheduler jobs + intervals: `birthdays.announce` 5 min, `reminders.deliver-due` 30 s; cards &
  role-menus none. Confirmed registration in main.ts.
- All DB tables read from schema.ts (line ranges cited).
- metadata.requiredPermissions / requiredIntents read from each index.ts.
- Admin routes confirmed by listing routes/ and reading routes/index.ts; reminders has none.
- Default-enabled states read from seed.ts.

### Nevalidat
- Runtime behavior not executed (no Node/containers available in this pass) — all "verified" is
  static source reading.
- Admin route view templates (cards.ts/role-menus.ts/birthdays.ts bodies) only skimmed for route
  paths, not full field-by-field behavior.

### Probleme
- Reminders has no admin route despite a `createdByAdmin` column (real gap).
- Birthdays settings expose cardTemplateId + roleDurationHours that the scheduler does not act on
  (card render + temp-role expiry unimplemented in the announce job).
- role-menus publish/disable subcommands have no member-permission gate.

### Următorul agent poate continua?
Da. Open follow-ups: (1) verify whether any other module/route renders the birthday card or expires
the birthday role; (2) decide if reminders needs an admin route to honor `createdByAdmin`;
(3) consider a defaultMemberPermissions gate (e.g. ManageRoles) on `/roles menu|refresh|remove`.
