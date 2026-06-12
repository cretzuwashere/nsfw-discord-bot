import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e suite. Runs INSIDE the dev container (built from the
 * mcr.microsoft.com/playwright image — browsers are preinstalled, never run
 * `playwright install`) against the compose `admin` service.
 */
export default defineConfig({
  testDir: './playwright',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalSetup: './playwright/global-setup.ts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://admin:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/admin.json' },
      dependencies: ['setup'],
    },
  ],
});
