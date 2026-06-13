import type { Logger } from '@botplatform/logger';

/**
 * A minimal in-process periodic scheduler. Modules register named jobs that
 * run on a fixed interval (the "tick"); each job is responsible for querying
 * the database for due work (scheduled messages, reminders, birthdays) and
 * acting on it. This keeps scheduling DB-backed and crash-safe without
 * requiring Redis (see docs/ASSUMPTIONS.md). The interface is small enough
 * that a distributed scheduler can replace it later.
 */
export interface ScheduledJob {
  name: string;
  /** How often the job's `run` is invoked, in milliseconds. */
  intervalMs: number;
  run(): Promise<void>;
}

export class Scheduler {
  private readonly jobs: ScheduledJob[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Jobs currently executing — prevents overlapping runs of the same job. */
  private readonly inFlight = new Set<string>();
  private running = false;

  constructor(private readonly logger: Logger) {}

  register(job: ScheduledJob): void {
    if (this.jobs.some((existing) => existing.name === job.name)) {
      throw new Error(`scheduled job '${job.name}' registered twice`);
    }
    this.jobs.push(job);
    if (this.running) this.arm(job);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const job of this.jobs) this.arm(job);
    this.logger.info({ jobs: this.jobs.map((j) => j.name) }, 'scheduler started');
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  /** Run a single job immediately (used in tests). */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`no scheduled job named '${name}'`);
    await this.execute(job);
  }

  private arm(job: ScheduledJob): void {
    const timer = setInterval(() => void this.execute(job), job.intervalMs);
    timer.unref?.();
    this.timers.set(job.name, timer);
  }

  private async execute(job: ScheduledJob): Promise<void> {
    // Overlap guard: if the previous run of this job is still going (a slow
    // tick), skip this tick rather than running concurrently — concurrent
    // delivery jobs could otherwise double-send.
    if (this.inFlight.has(job.name)) {
      this.logger.warn({ job: job.name }, 'scheduled job still running; skipping this tick');
      return;
    }
    this.inFlight.add(job.name);
    try {
      await job.run();
    } catch (error) {
      // A failing job must never crash the worker; the next tick retries.
      this.logger.error({ err: error, job: job.name }, 'scheduled job failed');
    } finally {
      this.inFlight.delete(job.name);
    }
  }
}
