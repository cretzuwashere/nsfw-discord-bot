import type { AppConfig } from '@botplatform/config';
import type { Logger } from '@botplatform/logger';
import type { CommandDefinition } from './commands.js';
import type { PlatformEvent, PlatformEventType } from './events.js';
import type { AuditLogPort } from './ports.js';

export interface ModuleContext {
  logger: Logger;
  config: AppConfig;
  audit: AuditLogPort;
}

/** One field in a module's admin-panel configuration schema. */
export interface ConfigFieldSchema {
  key: string;
  label: string;
  type: 'string' | 'text' | 'boolean' | 'number' | 'channel' | 'role' | 'roles' | 'select';
  description?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

/** Declarative metadata used by the admin panel and health/status views. */
export interface ModuleMetadata {
  /** Discord permission names the module needs to function (display + checks). */
  requiredPermissions?: string[];
  /** Gateway intents the module needs (e.g. 'GuildMembers', 'MessageContent'). */
  requiredIntents?: string[];
  /** Admin-panel configuration field descriptors. */
  configSchema?: ConfigFieldSchema[];
  /** Audit action keys this module can emit (for documentation/filtering). */
  auditEvents?: string[];
}

/** A module's subscription to a platform (adapter-neutral) event. */
export interface ModuleEventHandler<T extends PlatformEventType = PlatformEventType> {
  type: T;
  handle(event: Extract<PlatformEvent, { type: T }>): Promise<void> | void;
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
  /** Declarative metadata for the admin panel (optional). */
  readonly metadata?: ModuleMetadata;
  /** Platform event subscriptions (member join/leave, component interactions…). */
  readonly events?: ModuleEventHandler[];
  onLoad?(ctx: ModuleContext): Promise<void> | void;
  onShutdown?(): Promise<void> | void;
}
