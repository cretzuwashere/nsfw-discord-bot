# Feature 09 — Economy — Shop (buy roles/perks)

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot). Live slash invocation pending command registration. Shop tables shipped in migration `0008`.

> Module key: `economy`

## Scop

A per-server shop where members spend currency to buy roles/perks. Admins define items; purchases debit the balance and grant the role (with the same hierarchy guard role-menus uses). Extends the economy module.

## De ce a fost ales

The primary currency sink — gives coins a purpose and ties the economy back into Discord roles. Depends on the currency ledger (F7) + `ManageRoles`.

## User Flow

A member runs `/shop` to browse items + prices, then `/buy <item>` to purchase; the bot debits coins and assigns the role (or records the perk).

## Moderator/Admin Flow

`/shop add role:role price:integer label:string?` and `/shop remove item:string` (ManageRoles/ManageGuild) curate the catalog.

## Commands / Interactions

**Commands**
- `/shop` — list purchasable items + prices (paginated).
- `/buy item:string` — purchase an item (debits balance, grants role).
- `/shop add role:role price:integer label:string?` — (admin) add a role item.
- `/shop remove item:string` — (admin) remove an item.

**Interactions**
- `eco:shop:<page>` buttons for catalog pagination.

## Permissions

`SendMessages`; `ManageRoles` (to grant purchased roles); admin subcommands gated by `ManageGuild`. Bot's top role must sit above any purchasable role (hierarchy footgun — same as role-menus; guarded by `canManageRole`).

## Data / Persistence

`shop_items` (id, guildId, kind['role'], roleId, label, price bigint, active; index(guildId)). `shop_purchases` (id, guildId, userExternalId, itemId FK, pricePaid, createdAt).

## Cooldown / Anti-spam

Buying a role you already own → blocked. Insufficient funds → blocked. Price must be >0. Purchase is transactional (debit + grant + purchase row). Per-user buy cooldown.

## Edge Cases

- Role above the bot in hierarchy → block with a clear admin-facing error (don't debit).
- Item inactive/removed between `/shop` and `/buy` → friendly error.
- Role manually removed later → re-buyable (documented).
- Adding a managed/@everyone role → rejected.

## Failure Scenarios

- If the role grant fails after debit, the transaction rolls back (no coins lost). Implemented as: validate → grant → on success debit+record; on grant failure, no debit.

## Implementation Notes

Extends `economy-module`: `shop_items`/`shop_purchases` tables (new migration), `purchase()` repo method ordering the role grant before the debit, `/shop` + `/buy` commands, pagination handler.

## Testing

Unit: purchase validation (funds, ownership, price), hierarchy guard path. Smoke: commands collected; migration applies.

## Troubleshooting

Buy fails with 'can't manage role' → move the bot's role above the item role. Coins debited but no role → shouldn't happen (grant precedes debit); check audit log.

## Rollback / Disable Strategy

Remove the `/shop` + `/buy` commands + drop the two shop tables. Disable via `/modules`.

## Future Improvements

Consumable perks, limited stock, temporary roles (auto-expire via scheduler), XP-level gating of items.

