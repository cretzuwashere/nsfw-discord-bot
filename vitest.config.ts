import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'packages/*/tests/unit/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
            'apps/*/tests/unit/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: [
            'packages/*/tests/integration/**/*.test.ts',
            'apps/*/tests/integration/**/*.test.ts',
          ],
          environment: 'node',
          globalSetup: './tests/integration-setup/global-setup.ts',
          // Integration tests share one DB; avoid concurrent schema churn.
          fileParallelism: false,
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
