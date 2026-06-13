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
