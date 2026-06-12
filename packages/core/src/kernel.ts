import type { AppConfig } from '@botplatform/config';
import type { Logger } from '@botplatform/logger';
import type { ChannelAdapter } from './contracts/adapter.js';
import type { CommandDispatcher } from './contracts/commands.js';
import type { BotModule } from './contracts/module.js';
import type { AuditLogPort, ModuleStatePort } from './contracts/ports.js';
import { HealthAggregator } from './health.js';
import { ModuleRegistry } from './registry.js';

export interface KernelOptions {
  config: AppConfig;
  logger: Logger;
  modules: BotModule[];
  adapters: ChannelAdapter[];
  audit: AuditLogPort;
  moduleState: ModuleStatePort;
  /** Called last during shutdown — close DB pools, HTTP servers, etc. */
  onShutdown?: () => Promise<void>;
}

/**
 * The bot core. Owns startup order, module/adapter lifecycle, the command
 * error boundary and graceful shutdown. Contains no Discord-specific logic —
 * platform specifics live in channel adapters.
 */
export class BotKernel {
  readonly registry = new ModuleRegistry();
  readonly health = new HealthAggregator();
  readonly startedAt = new Date();

  private dispatcher: CommandDispatcher | null = null;
  private started = false;
  private stopping = false;

  constructor(private readonly options: KernelOptions) {}

  get logger(): Logger {
    return this.options.logger;
  }

  getDispatcher(): CommandDispatcher {
    if (!this.dispatcher) throw new Error('Kernel not started');
    return this.dispatcher;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { config, logger, modules, adapters, audit, moduleState } = this.options;

    logger.info({ env: config.nodeEnv, version: config.version }, 'bot kernel starting');

    for (const module of modules) {
      this.registry.register(module);
      logger.info({ module: module.key, commands: module.commands.length }, 'module registered');
    }

    this.dispatcher = this.registry.createDispatcher({ logger, moduleState, audit });

    for (const module of modules) {
      try {
        await module.onLoad?.({ logger: logger.child({ module: module.key }), config, audit });
      } catch (error) {
        logger.error({ err: error, module: module.key }, 'module onLoad failed');
        throw error;
      }
    }

    for (const adapter of adapters) {
      try {
        await adapter.start({
          logger: logger.child({ adapter: adapter.key }),
          config,
          audit,
          commands: this.registry.allCommands(),
          dispatch: this.dispatcher,
        });
        logger.info({ adapter: adapter.key }, 'adapter started');
      } catch (error) {
        // An adapter failure must not take down the platform (health checks,
        // other adapters and the admin panel keep working).
        logger.error({ err: error, adapter: adapter.key }, 'adapter failed to start');
        await audit.record({
          actorType: 'system',
          action: 'adapter.start.error',
          metadata: { adapter: adapter.key },
        });
      }
    }

    await audit.record({
      actorType: 'system',
      action: 'system.startup',
      metadata: { version: config.version, environment: config.nodeEnv },
    });
    logger.info('bot kernel started');
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const { logger, modules, adapters, audit, onShutdown } = this.options;
    logger.info('bot kernel stopping');

    for (const adapter of adapters) {
      try {
        await adapter.stop();
      } catch (error) {
        logger.warn({ err: error, adapter: adapter.key }, 'adapter stop failed');
      }
    }

    for (const module of [...modules].reverse()) {
      try {
        await module.onShutdown?.();
      } catch (error) {
        logger.warn({ err: error, module: module.key }, 'module shutdown failed');
      }
    }

    try {
      await audit.record({ actorType: 'system', action: 'system.shutdown' });
    } catch {
      // Audit store may already be gone during shutdown.
    }

    await onShutdown?.();
    logger.info('bot kernel stopped');
  }

  /** Wire SIGINT/SIGTERM and fatal error handlers for container-friendly shutdown. */
  installProcessHandlers(): void {
    const { logger } = this.options;

    const shutdown = (signal: string) => {
      logger.info({ signal }, 'shutdown signal received');
      const timeout = setTimeout(() => {
        logger.error('graceful shutdown timed out; forcing exit');
        process.exit(1);
      }, 10_000);
      timeout.unref();
      void this.stop().then(
        () => process.exit(0),
        (error) => {
          logger.error({ err: error }, 'shutdown failed');
          process.exit(1);
        }
      );
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      logger.fatal({ err: error }, 'uncaught exception');
      void this.stop().finally(() => process.exit(1));
    });
    process.on('unhandledRejection', (reason) => {
      logger.error({ err: reason }, 'unhandled promise rejection');
    });
  }
}
