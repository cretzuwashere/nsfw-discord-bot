# Feature 04 — Server Stats & Weekly Highlights

## Status
PASS — implemented & validated (typecheck, lint, unit tests, migration applied, live bot boot + both scheduler jobs; live message counting active). Live slash invocation pending command registration.

> Module key: `server-stats`

## Scop

Count message activity (counts only — never message text) per guild/channel/member/day and surface it via `/serverstats`, `/myactivity`, and an optional weekly highlights recap post.

## De ce a fost ales

Gives a large server a visible heartbeat and recognition (top chatters, busiest channels) without reading message content (no privileged intent). Establishes the in-memory-accumulator + batched-upsert activity-counting approach that Levels reuses.

## User Flow

A member runs `/serverstats` to see messages today/this week, active members, and the week's top chatters/channels; `/myactivity` shows their own counts + rank. Weekly, the bot posts a 'Weekly Highlights' embed to a configured channel.

## Moderator/Admin Flow

`/statsconfig channel dow hour enabled` (ManageGuild) configures the weekly recap. Enable/disable via `/modules`.

## Commands / Interactions

**Commands**
- `/serverstats` — server activity overview (today, this week, top members/channels).
- `/myactivity user:user?` — a member's message counts + rank.
- `/statsconfig channel:channel dow:integer hour:integer enabled:boolean` — (ManageGuild) weekly recap config.

**Interactions**
- None required (overview is an embed). Optional Prev/Next buttons on long top-lists (deferred).

## Permissions

`SendMessages`, `EmbedLinks`, `ViewChannel` in counted channels. `/statsconfig` gated by `ManageGuild`.

## Data / Persistence

`activity_user_daily` (guildId, userExternalId, date, messages; unique(guildId,user,date)). `activity_channel_daily` (guildId, channelId, date, messages; unique). `serverstats_settings` (guildId PK, recapChannelId, recapEnabled, recapDow, recapHourUtc, lastRecapDate).

## Cooldown / Anti-spam

No user-facing spam (read-only). Bots excluded from counts. Writes are batched: an in-memory accumulator flushes via a 60s scheduler job using upserts, so a busy server is not one DB write per message.

## Edge Cases

- No activity yet → zeros, friendly empty state.
- Recap channel missing/forbidden → skip + log.
- Date rollover handled in UTC.
- Accumulator lost on restart → at most ~60s of counts lost (documented, acceptable).

## Failure Scenarios

- Flush upsert fails → keep counts in memory and retry next tick (no data loss unless the process dies).

## Implementation Notes

New package `packages/server-stats-module`. `accumulator.ts` (pure Map-based counter, tested). `repo.ts` batched upserts via `onConflictDoUpdate`. `message.create` event handler increments the accumulator. Two scheduler jobs: flush (60s) + weekly recap. `/serverstats` aggregates from the daily tables.

## Testing

Unit: accumulator increment/flush/reset; weekly-due predicate; top-N ranking. Smoke: event handler wired; migration generated.

## Troubleshooting

Counts always zero → ensure the module is enabled and the `message.create` handler is registered (and the bot can see the channels). Recap missing → check `/statsconfig` dow/hour (UTC).

## Rollback / Disable Strategy

Remove module + drop the three tables, or disable via `/modules`.

## Future Improvements

Per-channel leaderboards, hourly heatmap, voice-minutes once voice-state events exist, button pagination.

