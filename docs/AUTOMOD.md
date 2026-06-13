# Auto-Moderation Module

Automatic message filtering for Discord. The module listens to every message in
your servers, evaluates it against a set of admin-configured rules, and takes an
action (log, delete, warn, timeout, kick, or ban) when a rule is violated. It
supports per-rule escalation, ignored channels and roles, and records every
violation for review in the admin panel.

- **Package:** `packages/automod-module`
- **Matcher (pure rule logic):** `packages/automod-module/src/matcher.ts`
- **Service / event wiring:** `packages/automod-module/src/index.ts`
- **Data access:** `packages/automod-module/src/repo.ts`
- **Admin routes:** `apps/admin/src/routes/automod.ts`
- **Admin view:** `apps/admin/views/automod.ejs`
- **Registered in:** `apps/bot/src/main.ts` (`createAutomodModule`)
- **Module key:** `automod`

This module has **no slash commands** — it is event-driven and fully configured
through the admin panel.

---

## CRITICAL: Message Content privileged intent

Several rule types need to read the actual text of each message. Discord gates
message text behind the **Message Content** privileged intent. If that intent is
not enabled, the bot receives messages with **empty content**, so content-based
rules cannot match anything.

To enable content rules you must do **both** of the following:

1. Set the environment variable `DISCORD_ENABLE_MESSAGE_CONTENT=true`
   (defined in `packages/config/src/index.ts`; defaults to `false`). The bot
   exposes this as `config.discord.enableMessageContent`.
2. Enable the **Message Content Intent** toggle in the
   [Discord Developer Portal](https://discord.com/developers/applications)
   under your application's **Bot** settings.

### Degraded state

When `DISCORD_ENABLE_MESSAGE_CONTENT` is off, the module loads in a **DEGRADED**
state. On startup (`onLoad`) it logs:

```
Content-based automod rules (banned words, links, caps) need the MessageContent
privileged intent. Set DISCORD_ENABLE_MESSAGE_CONTENT=true and enable it in the Discord portal.
```

The admin Auto-Moderation page also shows a red banner saying the same thing.

In the degraded state, **content-based rules do nothing** (they have no text to
inspect), but the following rules still work because they rely on metadata rather
than message text:

- `mention_spam` (uses the mention count)
- `attachments` (uses the attachment flag)
- `spam` (message-rate counting, see below)

> **Note:** The `requiredIntents` declared by the module are `Guilds`,
> `GuildMessages`, and `MessageContent`. `MessageContent` is privileged and only
> actually requested when `DISCORD_ENABLE_MESSAGE_CONTENT=true`.

---

## Required Discord permissions and intents

### Bot permissions

Declared by the module (`metadata.requiredPermissions`):

- **Manage Messages** — required to delete offending messages (`delete` action).
- **Moderate Members** — required to time members out (`timeout` action).

To use the `kick` or `ban` actions the bot also needs the corresponding
**Kick Members** / **Ban Members** permissions, and its role must sit **above**
the target member's highest role in the server role hierarchy. Actions that the
bot is not permitted to perform fail silently (the failure is logged at debug
level) but the violation is still recorded.

### Gateway intents

- `Guilds` (always)
- `GuildMessages` (always — to receive `message.create` events)
- `MessageContent` (privileged — only for content rules; see above)

---

## Rule types

Rule types come from `AutomodRuleType` in `matcher.ts` and the
`automod_rule_type` Postgres enum in `packages/database/src/schema.ts`. The admin
panel exposes the following eight types (`RULE_TYPES` in
`apps/admin/src/routes/automod.ts`):

| Rule type          | Needs message content? | What it detects |
|--------------------|------------------------|-----------------|
| `banned_words`     | Yes                    | Message contains any configured word (case-insensitive substring match). |
| `spam`             | No                     | A user sends too many messages within a short window (rate-based). |
| `mention_spam`     | No                     | Message has more than N user/role mentions. |
| `caps`             | Yes                    | Message is mostly uppercase. |
| `invite_links`     | Yes                    | Message contains a Discord invite link. |
| `suspicious_links` | Yes                    | Message contains a link to a domain not on the allow-list. |
| `attachments`      | No                     | Message has any attachment. |
| `new_account`      | (metadata)             | Author's account is younger than N days. **See limitation below.** |

> The enum also contains `repeated_messages` and `raid`, but these are **not**
> exposed in the admin UI and are treated as no-ops by the matcher (the matcher
> returns "no match" for them). Only the eight types above are usable today.

### Per-rule configuration

The matcher reads a JSON `config` object per rule. The admin route
(`buildConfig` in `apps/admin/src/routes/automod.ts`) builds and validates this
object from the form. Defaults are applied by the matcher when a value is
missing.

#### `banned_words`
- **`words`** — array of words/phrases. Matching is a case-insensitive substring
  check, so `"spam"` also matches `"spammer"`. In the admin form, enter words
  separated by commas or newlines.

#### `spam`
- **`threshold`** — messages allowed per 10-second window. Admin form clamps to
  **2–50** (default **5**). A user sending **more than** `threshold` messages in
  10 seconds violates the rule. See [Spam rate detection](#spam-rate-detection).

#### `mention_spam`
- **`mentionThreshold`** — maximum mentions allowed. Admin form clamps to
  **1–50** (default **5**). A message with **more than** this many mentions
  violates the rule.

#### `caps`
- **`capsMinLength`** — minimum number of letters before the rule applies. Admin
  form clamps to **1–500** (default **10**). Messages with fewer letters are
  ignored.
- **`capsRatio`** — uppercase ratio that triggers the rule (0–1). The admin form
  **hard-codes this to `0.7`** (70% uppercase). The matcher's own default is also
  `0.7`. Only letters `A–Z`/`a–z` count toward the ratio.

#### `invite_links`
- No config. Matches `discord.gg/...`, `discord.com/invite/...`, and
  `discordapp.com/invite/...` links.

#### `suspicious_links`
- **`allowedDomains`** — array of allowed domains (lower-cased). Any HTTP/HTTPS
  link whose host is **not** one of these (or a subdomain of one) triggers the
  rule. In the admin form, enter domains separated by commas or newlines.

#### `attachments`
- No config. Any message with an attachment triggers the rule.

#### `new_account`
- **`minAccountAgeDays`** — minimum account age in days. Admin form clamps to
  **1–365** (default **7**). **Limitation:** see below — the current Discord
  adapter does not pass account age, so this rule never fires.

---

## Actions

Actions come from the `automod_action` enum and the admin `ACTIONS` list. The
admin panel exposes six actions:

| Action      | Effect |
|-------------|--------|
| `log_only`  | Records the violation only; no enforcement. |
| `delete`    | Deletes the offending message (needs **Manage Messages**). |
| `warn`      | Sends a public reply mentioning the user with the rule's **warn message**. Only the offending user is pinged (`@everyone`/role mentions are suppressed). If no warn message is set, nothing is sent. |
| `timeout`   | Times the member out for **600 seconds (10 minutes)** (needs **Moderate Members**). |
| `kick`      | Kicks the member (needs **Kick Members**). |
| `ban`       | Bans the member (needs **Ban Members**). |

Notes:

- The enum additionally contains `mute`, which the service treats identically to
  `timeout` (10-minute timeout). `mute` is **not** offered in the admin form.
- The action's audit reason is `automod: <reason>` (for example
  `automod: banned word`).
- Only **one action is applied per message** — the module stops at the first
  rule that matches.

---

## Escalation

Each rule can optionally escalate to a harsher action when a user repeatedly
violates rules. Configure two fields on the rule:

- **`escalationThreshold`** — number of recent violations that triggers
  escalation (admin form clamps to **1–100**).
- **`escalationAction`** — the action to use once the threshold is reached
  (any of the six actions).

When a rule fires, the module counts this user's violations in the **last 10
minutes** (`ESCALATION_WINDOW_MS = 10 * 60_000`) across the whole guild, adds the
current one, and if `count + 1 >= escalationThreshold`, it uses
`escalationAction` instead of the rule's normal action. Leave both fields empty
to disable escalation for a rule.

---

## Ignored channels and roles

Each rule has two lists, evaluated **before** the rule is checked:

- **`ignoredChannelIds`** — if the message is in one of these channels, the rule
  is skipped.
- **`ignoredRoleIds`** — if the message author has any of these roles, the rule
  is skipped.

In the admin form, enter IDs in the "Ignored channel IDs" / "Ignored role IDs"
fields, separated by commas or newlines. **Only purely numeric IDs are kept** —
non-numeric tokens are silently dropped (`parseIds` in the route). Each rule's
ignore lists are independent.

---

## Spam rate detection

The `spam` rule is **stateful** and is handled by the service rather than the
pure matcher (which returns "no match" for `spam`).

- The module keeps an **in-memory** map of recent message timestamps per
  `guild:user` key.
- The window is **10 seconds** (`SPAM_WINDOW_MS = 10_000`).
- A user violates the rule when they send **more than** `threshold` messages in
  that window. The default threshold is **5** (`SPAM_THRESHOLD`); a per-rule
  `config.threshold` overrides it.

Because the counts live in memory, they **reset whenever the bot restarts** and
are **not shared across multiple bot instances**. Spam tracking does not need the
Message Content intent (it counts messages, not their text).

---

## Configuring rules in the admin panel

Open the **Auto-Moderation** page at **`/automod`** (route in
`apps/admin/src/routes/automod.ts`, view `apps/admin/views/automod.ejs`). All
routes require login (`requireAuth`); mutating routes also require a mutating
role and pass CSRF protection.

The page is per-server: use the **Server** picker (or `?guild=<id>`) to switch
servers. It shows three sections:

1. **Rules** — a table of existing rules (name, type, action with any escalation
   shown as `action → escalationAction`, enabled/disabled status, and a Delete
   button).
2. **Add a rule** — the rule editor form. Pick a rule type, fill the config
   fields that apply, choose an action and optional warn message, optionally set
   escalation, and optionally set ignored channels/roles.
3. **Recent violations** — the latest 25 violations for the selected server
   (time, user ID, rule type, action taken, detail).

If `DISCORD_ENABLE_MESSAGE_CONTENT` is off, a red banner appears at the top
warning that content-based rules will not work.

### Admin routes

| Method & path           | Purpose |
|-------------------------|---------|
| `GET /automod`          | Render the page for the selected guild. |
| `POST /automod/save`    | Create or update a rule (CSRF-protected). |
| `POST /automod/:id/delete` | Delete a rule (CSRF-protected). |

> The editor form **creates or updates** a rule. Editing is keyed on a hidden
> `id` field; the visible form is wired for adding new rules, so editing an
> existing rule requires submitting its `id`.

---

## Database tables

Defined in `packages/database/src/schema.ts`; created by the migrations under
`packages/database/migrations`.

### `automod_rules`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | |
| `guild_id` | uuid | FK → `guilds.id`, `ON DELETE CASCADE` |
| `name` | text | |
| `rule_type` | `automod_rule_type` enum | |
| `enabled` | boolean | default `false` |
| `config` | jsonb | type-specific config; default `{}` |
| `action` | `automod_action` enum | default `log_only` |
| `severity` | integer | default `1` (admin clamps 1–5) |
| `ignored_channel_ids` | jsonb (`string[]`) | default `[]` |
| `ignored_role_ids` | jsonb (`string[]`) | default `[]` |
| `escalation_threshold` | integer | nullable |
| `escalation_action` | `automod_action` enum | nullable |
| `response_message` | text | nullable (the warn message) |
| `created_at` / `updated_at` | timestamptz | |

Indexed on `guild_id`.

### `automod_violations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial (PK) | |
| `guild_id` | uuid | FK → `guilds.id`, `ON DELETE CASCADE` |
| `rule_id` | uuid | FK → `automod_rules.id`, `ON DELETE SET NULL` |
| `user_external_id` | text | Discord user ID |
| `channel_id` | text | nullable |
| `rule_type` | `automod_rule_type` enum | |
| `action_taken` | `automod_action` enum | |
| `detail` | text | the match reason |
| `created_at` | timestamptz | |

Indexed on `guild_id` and on `(guild_id, user_external_id)`.

A violation row is recorded for **every** match, including `log_only`, and even
when the enforcement action fails. Deleting a rule sets `rule_id` to `NULL` on
its past violations (history is preserved).

---

## Audit events

The module and admin routes emit audit-log entries:

| Action | Emitted by | Actor | Notes |
|--------|------------|-------|-------|
| `automod.violation` | bot (`index.ts`) | `system` | severity `notice`; metadata `{ rule, action, reason }`; target = the user. |
| `automod.rule.created` | admin route | `admin` | on creating a rule via `/automod/save`. |
| `automod.rule.updated` | admin route | `admin` | on updating an existing rule. |

Only `automod.violation` is declared in the module's `metadata.auditEvents`. The
`rule.created` / `rule.updated` events are emitted by the admin panel when an
admin changes configuration.

---

## Privacy and security notes

- **Message content** is only readable when the privileged intent is enabled.
  Message text itself is **not** stored — only a short `detail` reason (e.g.
  "banned word", "invite link", "link to evil.example") is persisted per
  violation, alongside the user ID and channel ID.
- **Owner / hierarchy protection** comes from Discord itself: the bot cannot
  time out, kick, or ban members whose role is equal to or above the bot's, and
  cannot act on the server owner. Such actions fail and are logged at debug
  level, but the violation is still recorded.
- Spam counters are **in-memory** and contain only timestamps; they are never
  persisted.
- Admin mutations are CSRF-protected, require authentication and a mutating
  role, and are audited.

---

## Known limitations

- **`new_account` never fires today.** The Discord adapter passes
  `accountAgeDays: undefined` into the matcher (`index.ts`), and the matcher
  treats an undefined account age as "no match". The rule and its config exist,
  but enforcement requires the adapter to expose account age.
- **`repeated_messages` and `raid`** exist in the enum but are no-ops and are not
  shown in the admin UI.
- **`mute` action** exists in the enum (and behaves like a 10-minute timeout) but
  is not selectable in the admin form.
- **`caps` ratio is fixed at 0.7** — the admin form does not let you change the
  ratio, only the minimum length.
- **Spam state is per-process and non-persistent** — it resets on restart and is
  not shared across multiple bot instances.
- **One action per message** — only the first matching rule acts on a given
  message.
- **Failed enforcement is silent** — if the bot lacks permission or hierarchy to
  act, the action fails (logged at debug level) but the violation is still
  recorded as if the action were taken.

---

## Docker commands

Everything runs in Docker. Useful commands for this module:

```bash
# Apply database migrations (creates automod_rules / automod_violations)
docker compose exec app pnpm db:migrate

# Tail bot logs to see the automod load state (enabled vs DEGRADED) and matches
docker compose logs -f app

# Restart after changing DISCORD_ENABLE_MESSAGE_CONTENT in your .env
docker compose up -d --force-recreate app
```

To turn on content rules, set in your environment / `.env`:

```env
DISCORD_ENABLE_MESSAGE_CONTENT=true
```

…then enable the **Message Content Intent** in the Discord Developer Portal and
recreate the `app` container.
