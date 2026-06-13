/**
 * Human-facing catalog of every slash command, grouped by module, for the
 * `/commands` documentation page. Kept in sync with the command definitions
 * in each module package (the source of truth); this curated list adds usage
 * notes and required-permission context for self-hosting admins.
 */

export interface CatalogCommand {
  /** Full invocation, e.g. `/play url:<link>` or `/birthday set`. */
  usage: string;
  description: string;
  /** Option summaries, e.g. `url — the link to play (required)`. */
  options?: string[];
  /** Discord permission a member needs to use it (moderation commands). */
  requiresPermission?: string;
}

export interface CatalogModule {
  key: string;
  name: string;
  /** Empty when the module has no slash commands (admin/scheduler/event-driven). */
  commands: CatalogCommand[];
  /** Shown when commands is empty. */
  note?: string;
}

export const COMMAND_CATALOG: CatalogModule[] = [
  {
    key: 'audio-player',
    name: 'Audio Player',
    commands: [
      { usage: '/play url:<link>', description: 'Play from YouTube, SoundCloud, Spotify or a direct audio link — starts now, or queues if something is playing.', options: ['url — YouTube / SoundCloud / Spotify link or a direct audio file URL (required)'] },
      { usage: '/controls', description: 'Show the live audio control panel: progress bar + Pause/Resume/Skip/Stop/Leave buttons.' },
      { usage: '/nowplaying', description: 'Show the current track with a visual progress bar and controls.' },
      { usage: '/queue', description: 'List the now-playing track and everything queued.' },
      { usage: '/skip', description: 'Skip the current track and start the next one.' },
      { usage: '/pause', description: 'Pause playback.' },
      { usage: '/resume', description: 'Resume paused playback.' },
      { usage: '/stop', description: 'Stop playback and clear the queue (stays in the channel).' },
      { usage: '/join', description: 'Join your current voice channel.' },
      { usage: '/leave', description: 'Leave the voice channel and stop playback.' },
    ],
  },
  {
    key: 'announcements',
    name: 'Announcements',
    commands: [
      { usage: '/announcement list', description: 'List recent announcements and their status.' },
      { usage: '/announcement preview id:<id>', description: 'Preview an announcement (ephemeral).', options: ['id — announcement id, first 8 characters is enough (required)'] },
      { usage: '/announcement send id:<id>', description: 'Deliver an announcement now.', options: ['id — announcement id (required)'] },
      { usage: '/announcement cancel id:<id>', description: 'Cancel a draft or scheduled announcement.', options: ['id — announcement id (required)'] },
    ],
  },
  {
    key: 'role-menus',
    name: 'Reaction Roles',
    commands: [
      { usage: '/roles list', description: 'List the server’s role menus.' },
      { usage: '/roles menu id:<id>', description: 'Publish a configured role menu to this channel.', options: ['id — role menu id (required)'] },
      { usage: '/roles refresh id:<id>', description: 'Re-publish / update a role menu’s message.', options: ['id — role menu id (required)'] },
      { usage: '/roles remove id:<id>', description: 'Disable a role menu.', options: ['id — role menu id (required)'] },
    ],
  },
  {
    key: 'birthdays',
    name: 'Birthdays',
    commands: [
      { usage: '/birthday set month:<1-12> day:<1-31>', description: 'Opt in and save your birthday (you can remove it any time).', options: ['month (required)', 'day (required)', 'year — optional, only used to show age', 'timezone — optional IANA zone, e.g. Europe/Bucharest'] },
      { usage: '/birthday view', description: 'View your saved birthday.' },
      { usage: '/birthday remove', description: 'Delete your saved birthday.' },
      { usage: '/birthday upcoming', description: 'Show upcoming birthdays (respecting visibility).' },
    ],
  },
  {
    key: 'reminders',
    name: 'Reminders',
    commands: [
      { usage: '/reminder create message:<text> when:<delay>', description: 'Set a reminder (DM by default).', options: ['message (required)', 'when — delay like 30m, 2h, 1d 6h (required)', 'here — send in this channel instead of DM', 'repeat — repeat every, e.g. 1d'] },
      { usage: '/reminder list', description: 'List your active reminders.' },
      { usage: '/reminder remove id:<id>', description: 'Cancel a reminder.', options: ['id — reminder id, first 8 characters (required)'] },
    ],
  },
  {
    key: 'moderation',
    name: 'Moderation',
    commands: [
      { usage: '/warn user:<@user> reason:<text>', description: 'Warn a member and log a case.', options: ['user (required)', 'reason (required)'], requiresPermission: 'Moderate Members' },
      { usage: '/warnings user:<@user>', description: 'List a member’s warnings.', requiresPermission: 'Moderate Members' },
      { usage: '/clearwarnings user:<@user>', description: 'Record a warnings-clear for a member.', requiresPermission: 'Moderate Members' },
      { usage: '/timeout user:<@user> minutes:<n>', description: 'Time out (mute) a member.', options: ['user (required)', 'minutes (required)', 'reason'], requiresPermission: 'Moderate Members' },
      { usage: '/untimeout user:<@user>', description: 'Remove a member’s timeout.', requiresPermission: 'Moderate Members' },
      { usage: '/kick user:<@user>', description: 'Kick a member.', options: ['user (required)', 'reason'], requiresPermission: 'Kick Members' },
      { usage: '/ban user:<@user>', description: 'Ban a member.', options: ['user (required)', 'reason', 'delete_days — 0–7'], requiresPermission: 'Ban Members' },
      { usage: '/unban user_id:<id>', description: 'Unban a user by ID.', options: ['user_id (required)', 'reason'], requiresPermission: 'Ban Members' },
      { usage: '/purge amount:<1-100>', description: 'Bulk-delete recent messages in this channel.', requiresPermission: 'Manage Messages' },
      { usage: '/slowmode seconds:<0-21600>', description: 'Set this channel’s slowmode.', requiresPermission: 'Manage Channels' },
      { usage: '/lock', description: 'Lock this channel.', options: ['reason'], requiresPermission: 'Manage Channels' },
      { usage: '/unlock', description: 'Unlock this channel.', options: ['reason'], requiresPermission: 'Manage Channels' },
    ],
  },
  {
    key: 'custom-commands',
    name: 'Custom Commands',
    commands: [
      { usage: '/custom name:<name>', description: 'Run a custom command created in the admin panel.', options: ['name — the custom command’s name (required)'] },
    ],
  },
  {
    key: 'welcome',
    name: 'Welcome / Leave',
    commands: [],
    note: 'No slash commands — runs automatically on member join/leave. Configure it on the Welcome / Leave admin page.',
  },
  {
    key: 'dynamic-cards',
    name: 'Dynamic Cards',
    commands: [],
    note: 'No slash commands — a rendering service used by Welcome and Birthdays. Manage templates on the Dynamic Cards admin page.',
  },
  {
    key: 'scheduled-messages',
    name: 'Scheduled Messages',
    commands: [],
    note: 'No slash commands — fully managed on the Scheduled Messages admin page.',
  },
  {
    key: 'automod',
    name: 'Auto-Moderation',
    commands: [],
    note: 'No slash commands — runs on every message. Configure rules on the Auto-Moderation admin page (requires the Message Content intent for content rules).',
  },
];
