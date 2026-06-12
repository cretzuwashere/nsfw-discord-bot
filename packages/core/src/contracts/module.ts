import type { AppConfig } from '@botplatform/config';
import type { Logger } from '@botplatform/logger';
import type { CommandDefinition } from './commands.js';
import type { AuditLogPort } from './ports.js';

export interface ModuleContext {
  logger: Logger;
  config: AppConfig;
  audit: AuditLogPort;
}

/**
 * A platform module: a cohesive feature set (audio player, moderation, …).
 * Modules are adapter-agnostic — they speak only in core contracts.
 */
export interface BotModule {
  /** Stable key, also used as the database row key (see MODULE_KEYS in shared). */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly commands: CommandDefinition[];
  onLoad?(ctx: ModuleContext): Promise<void> | void;
  onShutdown?(): Promise<void> | void;
}
