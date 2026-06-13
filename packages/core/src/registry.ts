import type { Logger } from '@botplatform/logger';
import { PlatformError, toSafeUserMessage } from '@botplatform/shared';
import type { CommandContext, CommandDefinition, CommandDispatcher } from './contracts/commands.js';
import type { PlatformEvent } from './contracts/events.js';
import type { BotModule, ModuleEventHandler } from './contracts/module.js';
import type { AuditLogPort, ModuleStatePort } from './contracts/ports.js';

interface RegisteredCommand {
  module: BotModule;
  command: CommandDefinition;
}

interface RegisteredEvent {
  module: BotModule;
  handler: ModuleEventHandler;
}

/** Dispatches an adapter-neutral platform event to subscribed modules. */
export type EventDispatcher = (event: PlatformEvent) => Promise<void>;

/**
 * Holds all registered modules and routes command invocations to them,
 * wrapped in the platform error boundary:
 *  - disabled modules answer politely instead of executing
 *  - unexpected errors never leak raw messages to end users
 */
export class ModuleRegistry {
  private readonly modules = new Map<string, BotModule>();
  private readonly commands = new Map<string, RegisteredCommand>();
  private readonly events: RegisteredEvent[] = [];

  register(module: BotModule): void {
    if (this.modules.has(module.key)) {
      throw new PlatformError('INTERNAL', `Module '${module.key}' registered twice`);
    }
    this.modules.set(module.key, module);
    for (const command of module.commands) {
      if (this.commands.has(command.name)) {
        throw new PlatformError(
          'INTERNAL',
          `Command '${command.name}' from '${module.key}' conflicts with an existing command`
        );
      }
      this.commands.set(command.name, { module, command });
    }
    for (const handler of module.events ?? []) {
      this.events.push({ module, handler });
    }
  }

  list(): BotModule[] {
    return [...this.modules.values()];
  }

  get(key: string): BotModule | undefined {
    return this.modules.get(key);
  }

  allCommands(): CommandDefinition[] {
    return [...this.commands.values()].map((entry) => entry.command);
  }

  /**
   * Build an event dispatcher: routes a platform event to every subscribed
   * module whose module is enabled, isolating handler failures so one
   * module's error can't break others or the adapter.
   */
  createEventDispatcher(deps: {
    logger: Logger;
    moduleState: ModuleStatePort;
  }): EventDispatcher {
    const { logger, moduleState } = deps;
    return async (event: PlatformEvent): Promise<void> => {
      const handlers = this.events.filter((entry) => entry.handler.type === event.type);
      await Promise.all(
        handlers.map(async (entry) => {
          try {
            if (!(await moduleState.isEnabled(entry.module.key))) return;
            await entry.handler.handle(event as never);
          } catch (error) {
            logger.error(
              { err: error, module: entry.module.key, event: event.type },
              'module event handler failed'
            );
          }
        })
      );
    };
  }

  findCommand(name: string): RegisteredCommand | undefined {
    return this.commands.get(name);
  }

  createDispatcher(deps: {
    logger: Logger;
    moduleState: ModuleStatePort;
    audit: AuditLogPort;
  }): CommandDispatcher {
    const { logger, moduleState, audit } = deps;

    return async (ctx: CommandContext): Promise<void> => {
      const entry = this.commands.get(ctx.commandName);
      if (!entry) {
        await safeReply(ctx, 'Unknown command.', logger);
        return;
      }

      try {
        if (entry.command.guildOnly && !ctx.guildId) {
          await safeReply(ctx, 'This command only works inside a server.', logger);
          return;
        }

        const enabled = await moduleState.isEnabled(entry.module.key);
        if (!enabled) {
          await safeReply(
            ctx,
            `The ${entry.module.name} module is currently disabled.`,
            logger
          );
          return;
        }

        await entry.command.execute(ctx);

        await audit.record({
          actorType: 'platform_user',
          actorId: ctx.user.id,
          action: `${entry.module.key}.command.${ctx.commandName}`,
          guildId: ctx.guildId ?? undefined,
          metadata: { adapter: ctx.adapterKey },
        });
      } catch (error) {
        logger.error(
          { err: error, command: ctx.commandName, guildId: ctx.guildId },
          'command execution failed'
        );
        await audit.record({
          actorType: 'platform_user',
          actorId: ctx.user.id,
          action: `${entry.module.key}.command.${ctx.commandName}.error`,
          guildId: ctx.guildId ?? undefined,
          metadata: {
            adapter: ctx.adapterKey,
            // Safe message only — never raw error text into the audit trail.
            error: toSafeUserMessage(error),
          },
        });
        await safeReply(ctx, toSafeUserMessage(error), logger);
      }
    };
  }
}

async function safeReply(ctx: CommandContext, message: string, logger: Logger): Promise<void> {
  try {
    await ctx.reply({ content: message, ephemeral: true });
  } catch (error) {
    logger.warn({ err: error, command: ctx.commandName }, 'failed to deliver reply');
  }
}
