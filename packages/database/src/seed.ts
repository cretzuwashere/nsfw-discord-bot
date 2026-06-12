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

  await modulesRepo.ensure({
    key: MODULE_KEYS.audioPlayer,
    name: 'Audio Player',
    description: 'Voice channel audio playback with queue management.',
    defaultEnabled: true,
  });
  await modulesRepo.ensure({
    key: MODULE_KEYS.moderation,
    name: 'Moderation Foundation',
    description: 'Warnings, moderation actions and configurable rules (foundation).',
    defaultEnabled: false,
  });
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
