import type { FullConfig } from '@playwright/test';

const HEALTH_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

/** Wait until the admin service answers /healthz before any test runs. */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://admin:3000';
  const healthUrl = `${baseURL.replace(/\/$/, '')}/healthz`;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  console.log(`[e2e] waiting for admin service at ${healthUrl} ...`);
  let lastProblem = 'no response yet';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(POLL_INTERVAL_MS) });
      if (response.status === 200) {
        console.log('[e2e] admin service is healthy.');
        return;
      }
      lastProblem = `HTTP ${response.status}`;
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Admin service at ${healthUrl} did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s ` +
      `(last problem: ${lastProblem}).\n` +
      `Check that the stack is up and healthy:\n` +
      `  docker compose ps\n` +
      `  docker compose logs admin`
  );
}
