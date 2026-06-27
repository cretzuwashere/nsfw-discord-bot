import { hashPassword } from '@botplatform/security';
import { MODULE_KEYS } from '@botplatform/shared';
import type { Db } from './client.js';
import { createAdminUsersRepo } from './repositories/admin-users.js';
import { createModulesRepo } from './repositories/modules.js';

export interface SeedOptions {
  adminEmail?: string | undefined;
  adminPassword?: string | undefined;
  e2eAdminEmail?: string | undefined;
  e2eAdminPassword?: string | undefined;
  log?: (message: string) => void;
}

/**
 * Idempotent bootstrap: registers the built-in modules and creates the first
 * admin user (plus an isolated E2E test user when configured).
 */
export async function seed(db: Db, options: SeedOptions = {}): Promise<void> {
  const log = options.log ?? (() => {});
  const modulesRepo = createModulesRepo(db);
  const adminRepo = createAdminUsersRepo(db);

  const builtInModules: Array<{ key: string; name: string; description: string; defaultEnabled: boolean }> = [
    {
      key: MODULE_KEYS.audioPlayer,
      name: 'Audio Player',
      description: 'Voice channel audio playback (YouTube, SoundCloud, Spotify, direct links) with a queue.',
      defaultEnabled: true,
    },
    {
      key: MODULE_KEYS.announcements,
      name: 'Announcements',
      description: 'Create, schedule and send server announcements from the admin panel.',
      defaultEnabled: true,
    },
    {
      key: MODULE_KEYS.welcome,
      name: 'Welcome / Leave',
      description: 'Welcome and leave messages, cards, auto-roles and DMs.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.dynamicCards,
      name: 'Dynamic Cards',
      description: 'Generate personalized images (welcome cards, birthday cards, banners).',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.roleMenus,
      name: 'Reaction Roles',
      description: 'Self-assignable roles via buttons, select menus and reactions.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.birthdays,
      name: 'Birthdays',
      description: 'Opt-in birthday announcements, roles and cards.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.reminders,
      name: 'Reminders',
      description: 'Personal and server reminders, recurring and timezone-aware.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.scheduledMessages,
      name: 'Scheduled Messages',
      description: 'Schedule one-off and recurring messages to channels.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.moderation,
      name: 'Moderation',
      description: 'Warnings, mutes/timeouts, kick/ban, purge and moderation cases.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.automod,
      name: 'Auto-Moderation',
      description: 'Banned words, spam, mention and link filtering with escalation.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.customCommands,
      name: 'Custom Commands',
      description: 'Create text, embed and random-response commands.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.raiseHand,
      name: 'Speaker Queue',
      description: 'Raise-hand speaking queue for voice channels with moderator controls and a button panel.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.funCommands,
      name: 'Fun Commands',
      description: 'Random fun slash commands: 8-ball, dice, coin flip, chooser and rock-paper-scissors.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.engagementPrompts,
      name: 'Engagement Prompts',
      description: 'Conversation starters: Question of the Day, Would You Rather, Truth or Dare and party games.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.giveaways,
      name: 'Giveaways',
      description: 'Run giveaways with a one-tap Enter button and an automatic scheduled draw.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.serverStats,
      name: 'Server Stats',
      description: 'Message-activity stats and a weekly highlights recap (counts only, no message content).',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.trivia,
      name: 'Trivia',
      description: 'Channel trivia rounds with button answers, a bundled question bank and a win leaderboard.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.minigames,
      name: 'Mini-games',
      description: 'Head-to-head Tic-Tac-Toe and Connect Four played with buttons.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.economy,
      name: 'Economy',
      description: 'Virtual currency: balances, daily/streak rewards, member transfers and a role shop.',
      defaultEnabled: false,
    },
    {
      key: MODULE_KEYS.levels,
      name: 'Levels',
      description: 'Earn XP from chatting, level up (with optional reward roles) and compete on a leaderboard.',
      defaultEnabled: false,
    },
  ];
  for (const module of builtInModules) {
    await modulesRepo.ensure(module);
  }
  log('modules ensured');

  await ensureAdmin(adminRepo, options.adminEmail, options.adminPassword, 'owner', log);
  await ensureAdmin(adminRepo, options.e2eAdminEmail, options.e2eAdminPassword, 'admin', log);
}

async function ensureAdmin(
  adminRepo: ReturnType<typeof createAdminUsersRepo>,
  email: string | undefined,
  password: string | undefined,
  role: 'owner' | 'admin',
  log: (message: string) => void
): Promise<void> {
  if (!email || !password) return;
  const existing = await adminRepo.findByEmail(email);
  if (existing) {
    log(`admin user already exists: ${email}`);
    return;
  }
  if (password.length < 8) {
    throw new Error(`refusing to create admin '${email}': password must be at least 8 characters`);
  }
  const passwordHash = await hashPassword(password);
  await adminRepo.create({ email, passwordHash, role });
  log(`admin user created: ${email}`);
}
