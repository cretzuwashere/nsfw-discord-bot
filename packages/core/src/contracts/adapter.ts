import type { AppConfig } from '@botplatform/config';
import type { Logger } from '@botplatform/logger';
import type { AdapterConnectionState } from '@botplatform/shared';
import type { CommandDefinition, CommandDispatcher } from './commands.js';
import type { EventDispatcher } from '../registry.js';
import type { AuditLogPort } from './ports.js';

export interface AdapterContext {
  logger: Logger;
  config: AppConfig;
  audit: AuditLogPort;
  /** All commands from registered modules, for registration with the platform. */
  commands: CommandDefinition[];
  /** Route an incoming invocation through the platform (enabled-checks, error boundary). */
  dispatch: CommandDispatcher;
  /** Route an adapter-neutral platform event to subscribed modules. */
  dispatchEvent: EventDispatcher;
}

export interface AdapterStatus {
  state: AdapterConnectionState;
  detail?: string | undefined;
  /** Bot identity on the platform (username). Never a token. */
  identity?: string | undefined;
  guildCount?: number | undefined;
}

/**
 * A channel adapter connects the platform to one outside system
 * (Discord today; Slack, Telegram, … tomorrow).
 */
export interface ChannelAdapter {
  readonly key: string;
  start(ctx: AdapterContext): Promise<void>;
  stop(): Promise<void>;
  getStatus(): AdapterStatus;
}
