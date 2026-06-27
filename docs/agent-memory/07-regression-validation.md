# 07 — Regression & Testing Validation (Raise Hand / Speaker Queue)

> Agent: **AGENT 7 — TESTING & REGRESSION**
> Date: 2026-06-27
> All commands run in Docker: `docker compose exec -T app pnpm …`.

This separates **what was actually run** (automated) from **what requires a live
multi-user voice channel** (manual). Nothing is marked validated that was not
executed.

## 1. Automated gates — real results

| Gate | Command | Result |
|---|---|---|
| Unit tests | `pnpm test:unit` | ✅ **35 files / 346 tests pass** (incl. 14 new raise-hand logic tests) |
| Integration tests | `pnpm test:integration` | ✅ **7 files / 37 tests pass** (incl. `migrations.test.ts` applying `0002` to a fresh test DB) |
| Lint (changed files) | `pnpm exec eslint <my files>` | ✅ clean (exit 0) |
| Typecheck (each changed package) | `pnpm --filter <pkg> typecheck` | ✅ clean: `core`, `database`, `discord-adapter`, `shared`, `raise-hand-module`, `bot` |
| Migration generate | `pnpm db:generate` | ✅ `0002_blue_cannonball.sql` |
| Migration apply | `pnpm db:migrate` | ✅ `migrations applied`; `\d` confirms tables + partial unique index |
| Build | `pnpm build` | ✅ `apps/bot` + `apps/admin` build clean (tsup); module bundled |
| Runtime load | `docker compose restart bot` + logs | ✅ `raise-hand module ready`, kernel + adapter started, `discord connected` |
| Slash registration | `pnpm discord:register-commands` | ✅ **36 commands registered** with Discord (guild, instant) — 8 new |

### Regression check (existing features intact)
- Full unit + integration suites pass with no failures → the additive changes to
  `core` (`events.ts`, `guild-service.ts`), `discord-adapter` (`adapter.ts`,
  `guild-service.ts`), `database` (`schema.ts`, `seed.ts`) and `shared`
  (`types.ts`) did **not** break any existing module (audio, moderation,
  announcements, role-menus, welcome, cards, automod, reminders, birthdays,
  scheduled-messages, custom-commands).
- The bot restarted and **all 11 prior modules + raise-hand** logged "ready"; the
  scheduler started with its 4 jobs; the internal API came up on 8081; Discord
  reconnected. No new errors.

### Known non-raise-hand issue (documented, not introduced here)
- `pnpm typecheck` (whole monorepo) fails in `packages/audio-module` test mocks
  (`flatPlaylist` missing on `YtDlpRunner`). Those files were already modified by
  a concurrent effort in the working tree at session start; raise-hand does not
  touch the audio module. Every package raise-hand changed typechecks clean.

## 2. Scenario coverage matrix

Legend: **Auto** = covered by an automated test; **Logic** = covered by pure
unit-logic tests; **Manual** = requires a live VC with members (not run here).

### Normal user
| Scenario | How covered |
|---|---|
| Raise hand (in VC) | Logic (position/dedupe) + Manual (Discord round-trip) |
| Raise hand (not in VC) → error | Manual (command guard `getUserVoiceChannel()===null`) |
| Raise twice (idempotent) | Logic (`addEntry` returns `created:false`; position reported) + Manual |
| Show queue order | Logic (`sortWaiting`, `formatQueueLines`) + Manual |
| Lower hand | Manual (`removeEntry`) |
| Becomes active speaker | Logic (`advance`/`nextWaiting`) + Manual |
| Leaves VC while queued → auto-removed | Manual (needs a real voice disconnect → `voice.state.update`) |

### Moderator
| Scenario | How covered |
|---|---|
| View queue | Logic + Manual |
| Next speaker (advance + announce) | Logic (`advance`) + Manual (announcement message) |
| Remove a speaker | Manual (`removeEntry` by target id) |
| Clear the queue | Manual (`clearQueue`) |
| Promote a user to front | Logic (`promotedPriority`) + Manual |
| Post control panel | Manual (`postPanel` → live message) |

### Permission failures
| Scenario | How covered |
|---|---|
| Normal user runs a moderator slash command | Discord-enforced via `default_member_permissions: ['MuteMembers']` (validated: registration accepted the gate). Manual to observe the hidden/blocked command. |
| Normal user clicks a moderator panel button | Server-side re-check `memberHasPermission('MuteMembers') \|\| isGuildOwner` → reply "Only moderators…". Manual to observe. |
| Bot lacks Send/Embed permission | `postPanel`/`refreshPanel` catch + return a safe "check my channel permissions" message. Manual. |

### Edge cases
| Scenario | How covered |
|---|---|
| Empty queue + next | Logic + service returns "No one is waiting". |
| Empty queue + clear | Service returns "0 entries removed". |
| Duplicate user | Logic + DB **partial unique index** `WHERE status <> 'done'` (verified in Postgres). |
| User left the server | `removeEntry`/leave handler operate by id; stale entry simply never matches a live member; moderator `/remove-speaker` clears it. Manual. |
| Bot restart | ✅ **Validated** — state is in Postgres; bot restarted and the module re-loaded; queue rows persist (panel customIds carry the VC id so buttons keep working). |
| Multiple VCs in one guild | Logic + schema: queue scoped by unique `(guild_id, voice_channel_id)`. Manual for full round-trip. |
| Multiple guilds | Schema: `guild_id` FK on every queue. Manual. |

## 3. What could NOT be validated locally (explicit)

- **Live voice-channel behaviour with real members.** Raising/lowering via the
  slash command and the panel buttons, the moderator advancing the queue and the
  "🎤 next to speak" announcement, promotion reordering, and especially the
  **voice-leave auto-removal** (`voice.state.update`) all require multiple humans
  joining/leaving an actual Discord voice channel and clicking components. This
  cannot be simulated from the container. The manual test script is in
  [`../raise-hand/testing.md`](../raise-hand/testing.md).
- **Server-side button gate rejection** observed in the Discord client (the code
  path + permission method are validated by typecheck + the full suite, but the
  end-user rejection message is manual).

## Checkpoint

Status: PARTIAL

### Validat
- All automated gates green (unit 346, integration 37, lint, per-package
  typecheck, migration generate+apply, build, runtime bot load, Discord slash
  registration of 36 commands incl. the 8 new ones).
- No regression in any existing module (full suite + clean bot restart).
- Persistence-across-restart validated (DB-backed state + module reload).
- Dedupe enforced at the DB level (partial unique index verified in Postgres).

### Nevalidat
- End-to-end behaviour in a live multi-user voice channel (raise/lower/next/
  remove/clear/promote/panel buttons + voice-leave auto-removal). Manual script
  provided.
- Whole-monorepo `pnpm typecheck` is red **only** due to a concurrent
  audio-module change unrelated to this feature.

### Probleme
- Concurrent audio-module test-mock typecheck breakage (not raise-hand) blocks a
  single green whole-repo `typecheck`; documented and isolated.
- Panel **Raise** button does not verify VC presence (slash command does) — known,
  documented limitation.

### Următorul agent poate continua?
**Da.** The feature is automated-green and runtime-verified; only live-VC
behaviour remains, which is inherently manual and scripted in `testing.md`.
Overall status PARTIAL strictly because that live-VC behaviour could not be
exercised in this environment, not because of any known defect.
