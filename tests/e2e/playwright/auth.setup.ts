import { test as setup } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { login } from './helpers.js';

// Same file the chromium project loads via `storageState` in the config.
const STORAGE_STATE_PATH = fileURLToPath(new URL('./.auth/admin.json', import.meta.url));

setup('authenticate as the seeded e2e admin', async ({ page }) => {
  await login(page);
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
