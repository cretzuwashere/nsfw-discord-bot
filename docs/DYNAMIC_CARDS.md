# Dynamic Cards

The **Dynamic Cards** module turns sanitized, declarative templates into personalized
PNG images — welcome cards, birthday cards, banners and the like. It is a *rendering
service*, not a user-facing command set: it has **no slash commands**. Other modules
(welcome, birthday) call it to attach a generated image to a message, and the admin
panel uses it for live previews.

Source:

- Module: `packages/cards-module/src/` (`index.ts`, `layout.ts`, `renderer.ts`, `storage.ts`, `repo.ts`, `service.ts`, `placeholders.ts`)
- Admin routes: `apps/admin/src/routes/cards.ts`
- Admin views: `apps/admin/views/cards.ejs`, `apps/admin/views/card-edit.ejs`
- Schema: `packages/database/src/schema.ts` (`card_templates`, `card_assets`)
- Registered in: `apps/bot/src/main.ts` (`createCardsModule(...)`)

---

## What it does

1. Stores **card templates**: a width/height plus a declarative `layout` (background,
   text layers, optional avatar). Templates are scoped per-guild or **global**
   (`guild_id = NULL`).
2. Stores **card assets**: uploaded background images on the uploads volume.
3. **Renders** a template to a PNG by building an SVG document and rasterizing it with
   [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js). Text layers have
   `{{placeholders}}` substituted (e.g. the joining member's name) before rendering.
4. Resolves the background image from storage and fetches the member's avatar over an
   SSRF-safe HTTP streamer, then composites both into the card.

The module exposes its service object (`renderById`, `renderTemplate`, `fetchImage`)
to the rest of the bot. In `apps/bot/src/main.ts` the welcome module receives a
`renderCard` bridge:

```ts
renderCard: (templateId, data) => cardsHandle.service.renderById(templateId, data),
```

---

## Required permissions and intents

| Requirement | Why |
|---|---|
| **`AttachFiles`** permission (declared in module metadata) | The bot must be allowed to attach the generated PNG to the channel message that delivers the card. |
| **`GuildMembers`** intent (privileged) | Needed by the *consuming* modules (welcome/birthday) to receive member join/leave events and the member avatar URL used for the avatar layer. Enable it in the Discord developer portal. |

The cards module itself emits no platform events and registers no commands, so it adds
no further intent requirements beyond what its consumers (welcome, birthday) already
need. See `metadata.requiredPermissions: ['AttachFiles']` in
`packages/cards-module/src/index.ts`.

---

## Configuring it in the admin panel

All card management lives under the **Dynamic Cards** page.

| Action | Route / Page | Notes |
|---|---|---|
| List templates and assets | `GET /cards` → `cards.ejs` | Shows templates, uploaded backgrounds and the supported placeholder list. |
| New template form | `GET /cards/new` → `card-edit.ejs` | |
| Edit a template | `GET /cards/:id` → `card-edit.ejs` | 404 if the template id is unknown. |
| Save a template (create/update) | `POST /cards/:id/save` | CSRF-protected; requires a mutating role. |
| Live PNG preview | `GET /cards/:id/preview.png` | Renders the template with **sample data** (see below). `cache-control: no-store`. |
| Upload a background image | `POST /cards/upload` | Multipart; requires a mutating role. |
| Archive a template | `POST /cards/:id/archive` | Soft delete (`archived_at`); CSRF-protected. |

All routes require an authenticated admin (`requireAuth`). Mutating routes also require
a mutating role (`requireMutatingRole`). The save/archive routes use the standard
`@fastify/csrf` body-token check; the multipart upload does not (see
[Upload security](#upload-security-csrf-on-multipart) below).

### Template fields (on save)

The save handler (`apps/admin/src/routes/cards.ts`) sanitizes and clamps everything:

| Field | Form key | Validation |
|---|---|---|
| Name | `name` | Trimmed; **required** (400 with form error if empty). |
| Kind | `kind` | Free string, default `generic`. Documented kinds: `welcome`, `birthday`, `announcement`, `role_unlock`, `event`, `generic`. |
| Width | `width` | Integer, clamped to **100–4000**, default **1000**. |
| Height | `height` | Integer, clamped to **100–4000**, default **420**. |
| Layout | `layout` | JSON string, parsed via `safeJsonParse` then normalized by `normalizeLayout` against the chosen width/height. |

### Live preview sample data

`GET /cards/:id/preview.png` always renders with fixed sample values (so admins can see
the layout without a real member):

```text
user.username    = SampleUser
user.displayName = Sample User
user.avatarUrl   = ""            (empty → no avatar fetched in preview)
server.name      = Sample Server
server.memberCount = 1234
birthday.age     = 25
role.name        = Member
date.today       = <today, YYYY-MM-DD>
```

---

## The layout JSON schema

The layout is a **declarative, sanitized** spec — there is no code execution. It is
validated and clamped by `normalizeLayout(raw, { width, height })` in
`packages/cards-module/src/layout.ts`. Unknown fields are dropped and every value is
clamped to a safe range.

```jsonc
{
  "background": { "type": "color", "color": "#1f2530" },
  // — or —
  "background": { "type": "image", "assetId": "<card_asset uuid>" },

  "texts": [
    {
      "content": "Welcome {{user.displayName}}!",  // may contain placeholders
      "x": 40,
      "y": 60,
      "fontSize": 32,
      "color": "#ffffff",
      "weight": "normal",        // "normal" | "bold"
      "anchor": "start"          // "start" | "middle" | "end"
    }
  ],

  "avatar": {                    // optional
    "x": 40,
    "y": 40,
    "size": 128,
    "shape": "circle"            // "circle" | "square"
  }
}
```

Normalization rules (enforced server-side, so malformed input cannot break rendering):

| Field | Rule |
|---|---|
| `background.type` | `image` only when `assetId` is a string; otherwise falls back to `color`. |
| `background.color` | Must match `#RRGGBB` (6 hex digits; `#` optional). Default `#1f2530`. |
| `texts` | Array, **capped at 20** layers. |
| `text.content` | String, truncated to **200 chars**. |
| `text.x` / `text.y` | Integer clamped to `0..width` / `0..height`. |
| `text.fontSize` | Integer clamped **8–200** (default 32). |
| `text.color` | `#RRGGBB`, default `#ffffff`. |
| `text.weight` | `bold` if exactly `"bold"`, else `normal`. |
| `text.anchor` | `middle`/`end` if specified, else `start`. |
| `avatar.x` / `avatar.y` | Integer clamped to `0..width` / `0..height`. |
| `avatar.size` | Integer clamped **16–512** (default 128). |
| `avatar.shape` | `square` if exactly `"square"`, else `circle`. |

The render font family is `DejaVu Sans` (with system-font fallback enabled). Image
backgrounds and avatars are composited with `preserveAspectRatio="xMidYMid slice"`
(cover-style cropping). A `circle` avatar is masked with an SVG `clipPath`.

---

## Placeholders

Text layers support `{{placeholder}}` substitution shared platform-wide via
`@botplatform/shared` (re-exported by `packages/cards-module/src/placeholders.ts`).
Unknown placeholders render as an **empty string** — nothing is ever evaluated as code.

Supported keys (`SUPPORTED_PLACEHOLDERS`):

- `user.username`
- `user.displayName`
- `user.mention`  (`<@id>`)
- `user.avatarUrl`
- `user.id`
- `server.name`
- `server.memberCount`
- `date.today`
- `birthday.age`
- `role.name`

`user.avatarUrl` is special: it is not drawn as text but is the URL used to fetch the
avatar image for the `avatar` layer (see below).

---

## SVG → PNG rendering pipeline

`packages/cards-module/src/renderer.ts` builds the SVG and rasterizes it:

1. `buildCardSvg(input)` (pure, unit-tested) assembles the `<svg>`:
   - Background `<rect>` (solid color) or `<image>` (data-URI of the decoded
     background bytes).
   - Optional avatar `<image>`, circular-clipped when `shape === 'circle'`.
   - Each text layer: placeholders applied, then **XML-escaped**, then emitted as
     `<text>`.
2. `renderCardPng(input)` feeds that SVG to `new Resvg(...)` with
   `loadSystemFonts: true`, `defaultFontFamily: 'DejaVu Sans'`, and
   `fitTo: { mode: 'width', value: width }`, returning a PNG `Buffer`.

Image bytes are embedded as `data:image/png;base64,…` data URIs. resvg's raster decoder
handles PNG/JPEG/WebP regardless of the declared `image/png` prefix, so the prefix is
not a content-type assertion.

---

## Background uploads

Uploads are handled by `POST /cards/upload` and stored by `CardAssetStorage`
(`packages/cards-module/src/storage.ts`) on the uploads volume.

| Limit | Value |
|---|---|
| Allowed MIME types | `image/png`, `image/jpeg`, `image/webp` (others rejected). |
| Max size | **8 MB** (`MAX_BYTES = 8 * 1024 * 1024`). |
| Empty files | Rejected. |

On success a row is written to `card_assets` recording the relative `storage_path`,
`originalName` (truncated to 200 chars), `mimeType` and `byteSize`. On failure the user
is redirected back to `/cards?msg=…` with the error reason.

### Path-traversal-safe storage

Stored filenames are **generated**, never derived from user input:

- The destination folder is the guild UUID (validated `^[a-f0-9-]{36}$`) or `global`.
- The filename is `randomUUID() + ext`, where `ext` comes from the allow-listed MIME map.
- The resulting absolute path is additionally asserted to stay **inside** the uploads
  root via `safeResolve()` — if `resolve(root, relPath)` escapes the root, the operation
  is refused. Reads and deletes apply the same guard.

The uploads root is `config.storage.uploadsDir`, from the `UPLOADS_DIR` environment
variable (default `/workspace/uploads`; see `packages/config/src/index.ts`). In Docker
this should be a mounted volume so assets survive container restarts. The DB only ever
stores the *relative* path, never an absolute host path (`schema.ts`).

### Upload security (CSRF on multipart)

The upload route intentionally omits the `@fastify/csrf` body-token check, because that
check does not apply to streamed multipart bodies. It is instead protected by:

- the `SameSite=Lax` session cookie (a cross-site POST never carries the session), and
- the `requireAuth` + `requireMutatingRole` guards.

See the comment block in `apps/admin/src/routes/cards.ts`.

---

## SSRF-safe avatar fetch

When a template has an `avatar` layer and a non-empty `user.avatarUrl`, the service
fetches the image via `openSafeHttpStream` from `@botplatform/security`
(`packages/cards-module/src/service.ts` → `fetchImage`).

Protections:

- **SSRF guard**: the underlying URL validation blocks loopback (`127.0.0.0/8`, `::1`),
  private (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local
  (`169.254/16`, `fe80::/10`) and carrier-grade-NAT ranges, including the
  `169.254.169.254` cloud-metadata endpoint and IPv4-mapped loopback. Redirects to such
  hosts are refused.
- **Timeout**: 8000 ms.
- **Size cap**: the stream is aborted and the fetch returns `undefined` once it exceeds
  the byte cap (`maxImageBytes`, default **8 MB**).
- Any fetch failure is swallowed (logged at debug) — the card renders without the avatar
  rather than failing.

---

## Security notes

- **XML escaping**: all placeholder-resolved text is run through `escapeXml` (`&`, `<`,
  `>`, `"`, `'`) before being placed into `<text>`, preventing SVG/markup injection from
  user-controlled names.
- **No code execution**: layouts are a fixed declarative schema; placeholders only do
  string substitution against a provided data map.
- **Input clamping**: dimensions, coordinates, font sizes, colors and layer counts are
  all clamped server-side (`normalizeLayout`, `clampInt`), so a hostile layout JSON
  cannot produce an oversized canvas or out-of-range values.
- **Generated filenames + root-confinement**: uploaded assets cannot escape the uploads
  volume.

---

## Database tables

Defined in `packages/database/src/schema.ts`; migrations in
`packages/database/migrations`.

### `card_templates`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()`. |
| `guild_id` | uuid → `guilds.id` (cascade) | **NULL = global** template for all guilds. |
| `name` | text | Required. |
| `kind` | text, default `generic` | `welcome` / `birthday` / `announcement` / `role_unlock` / `event` / `generic`. |
| `width` | integer, default 1000 | |
| `height` | integer, default 420 | |
| `layout` | jsonb, default `{}` | Sanitized layout spec. |
| `background_asset_id` | uuid | Reference to a background asset (layout also carries `assetId`). |
| `archived_at` | timestamptz, nullable | Set on archive (soft delete); list queries exclude archived rows. |
| `created_at` / `updated_at` | timestamptz | `updated_at` bumped on update. |

Index: `card_templates_guild_idx` on `guild_id`.

`listTemplates(guildId)` returns that guild's templates **plus** global templates,
excluding archived ones (`packages/cards-module/src/repo.ts`).

### `card_assets`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()`. |
| `guild_id` | uuid → `guilds.id` (cascade) | NULL = global asset. |
| `storage_path` | text | **Relative** path within the uploads volume — never absolute. |
| `original_name` | text, default `''` | Uploaded filename (truncated to 200 chars). |
| `mime_type` | text | One of the allowed image types. |
| `byte_size` | integer | |
| `created_at` | timestamptz | |

Index: `card_assets_guild_idx` on `guild_id`. `listAssets` returns up to **100** rows.

---

## Audit events

Admin mutations are recorded via the audit log (`ctx.audit.record`, module key
`dynamic-cards`):

| Action | When | Target |
|---|---|---|
| `card.template.created` | New template saved | `card_template` |
| `card.template.updated` | Existing template saved | `card_template` |
| `card.template.archived` | Template archived | `card_template` |
| `card.asset.uploaded` | Background image uploaded | `card_asset` |

(The module declares `card.template.created`, `card.template.updated`,
`card.template.archived` in its metadata; the upload route additionally records
`card.asset.uploaded`.)

---

## How welcome and birthday use cards

Cards have no commands of their own — they're consumed by other modules through the
`renderCard` bridge wired in `apps/bot/src/main.ts`.

- **Welcome** (`packages/welcome-module/src/service.ts`): when a guild's welcome
  settings have a `welcomeCardTemplateId`, the join handler calls
  `renderCard(templateId, { ...placeholderData, 'user.avatarUrl': avatarUrl })`. If a
  PNG comes back it is attached to the welcome message as `welcome.png`. If rendering
  returns `null` (missing template or render error), the message is still sent without
  the card.
- **Birthday** (`packages/birthdays-module`): birthday announcements support an
  optional card in the same way (the module description notes "optional role and card").

`renderById` returns `null` rather than throwing on a missing template or render
failure, so a broken template never blocks the underlying message.

---

## Docker commands

Everything runs in Docker; admin operations against the rendering service or DB go
through the app container.

```bash
# Apply migrations (creates card_templates / card_assets)
docker compose exec app pnpm db:migrate

# Run the cards module tests
docker compose exec app pnpm --filter @botplatform/cards-module test

# Tail bot logs (the module logs "dynamic cards ready" with the uploadsDir on load)
docker compose logs -f app
```

Ensure `UPLOADS_DIR` points at a mounted volume so uploaded backgrounds persist.

---

## Known limitations

- **No slash commands.** Cards are managed only from the admin panel and rendered by
  other modules; there is no in-Discord `/card` command.
- **Single-line text only.** Each text layer is one `<text>` element — there is no
  automatic word wrapping or multi-line flow. Long content (capped at 200 chars) can
  overflow the canvas.
- **Fonts limited to bundled/system fonts.** Text renders with `DejaVu Sans`
  (plus system fonts). Custom font uploads are not supported; glyphs outside the
  available fonts (some emoji/scripts) may not render.
- **Max 20 text layers** per template, and dimensions are capped at 4000×4000.
- **Previews use fixed sample data** and never fetch a real avatar (the sample
  `user.avatarUrl` is empty), so the avatar layer is blank in previews.
- **Archive is soft delete only.** Archived templates are hidden from lists but their
  rows (and uploaded assets) remain; there is no admin UI to permanently delete a
  template or an uploaded asset.
- **Uploads are global in the admin UI.** The admin upload and list routes pass
  `guildId: null`, so the panel manages global templates/assets; per-guild scoping
  exists in the schema and repo but is not surfaced by these routes.
