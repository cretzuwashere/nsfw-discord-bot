import type { HealthCheckResult } from '@botplatform/shared';
import type { HealthIndicator } from './contracts/ports.js';

/** Aggregates named health indicators into one overall result. */
export class HealthAggregator {
  private readonly indicators: HealthIndicator[] = [];

  register(indicator: HealthIndicator): void {
    this.indicators.push(indicator);
  }

  async run(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};
    let anyError = false;

    await Promise.all(
      this.indicators.map(async (indicator) => {
        try {
          const result = await indicator.check();
          checks[indicator.name] = result;
          if (result.status === 'error') anyError = true;
        } catch (error) {
          checks[indicator.name] = {
            status: 'error',
            detail: error instanceof Error ? error.message : 'check failed',
          };
          anyError = true;
        }
      })
    );

    return { status: anyError ? 'degraded' : 'ok', checks };
  }
}
