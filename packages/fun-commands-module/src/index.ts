import type { BotModule } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildFunCommands, type FunCommandsDeps } from './commands.js';

export interface FunCommandsModuleOptions {
  logger: Logger;
  /** Test/customization hooks (rng, cooldown, clock). */
  deps?: FunCommandsDeps;
}

export interface FunCommandsModuleHandle {
  module: BotModule;
}

/**
 * Random fun slash commands (8-ball, dice, coin flip, chooser, rock-paper-scissors).
 * Stateless: no database, scheduler or events — just commands with a per-user cooldown.
 */
export function createFunCommandsModule(options: FunCommandsModuleOptions): FunCommandsModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.funCommands });

  const module: BotModule = {
    key: MODULE_KEYS.funCommands,
    name: 'Fun Commands',
    description:
      'Random fun slash commands: 8-ball, dice roller, coin flip, chooser and rock-paper-scissors.',
    metadata: {
      requiredPermissions: ['SendMessages'],
      requiredIntents: ['Guilds'],
    },
    commands: buildFunCommands(options.deps),
    onLoad() {
      logger.info('fun-commands module ready');
    },
  };

  return { module };
}

export * from './logic.js';
export { buildFunCommands } from './commands.js';
export type { FunCommandsDeps } from './commands.js';
