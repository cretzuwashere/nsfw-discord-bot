# Fun Features — Troubleshooting

Common problems and fixes for the fun feature modules. (Each feature appends its
specific notes below.)

## General

| Symptom | Likely cause | Fix |
|---|---|---|
| New slash command missing in Discord | Module not added to `apps/bot/src/register-commands.ts`, or commands not re-registered | Add the module's `commands` there and run `pnpm discord:register-commands` (needs a valid token). |
| Module not in admin `/modules` list | No seed row | Add the module to `packages/database/src/seed.ts` and run `pnpm db:seed`. |
| Buttons do nothing | Module's `component.interaction` handler not registered, or the interaction's owning record is gone/expired | Confirm `module.events` includes the handler and the record (round/game/giveaway) is still active. |
| `db:migrate` fails | Schema edited without generating a migration, or migrations out of order | Run `pnpm db:generate`, review the SQL, then `pnpm db:migrate`. Never hand-edit applied migrations. |
| Role grant fails ("can't manage role") | Bot's highest role is below the target role, or the role is managed | Move the bot's role above the target role in Server Settings → Roles. |
| Bot not running commands at all | Bot container genuinely down, or `DISCORD_TOKEN` invalid (a bad token keeps the container **healthy** by design — it won't show as unhealthy in `docker compose ps`) | `docker compose ps` (is it actually down?) and `docker compose logs bot`; for a token problem read `checks.discord.detail` from `/healthz` — not `docker compose ps` — then fix the token in `.env`. |

## Per-feature notes

<!-- Each feature appends its troubleshooting rows here. -->
