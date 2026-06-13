import type { Logger } from '@botplatform/logger';
import type { VoiceCapability } from './voice.js';

export interface CommandOptionDef {
  name: string;
  description: string;
  type: 'string' | 'integer' | 'boolean';
  required?: boolean;
}

export type ReplyPayload = string | { content: string; ephemeral?: boolean };

export interface CommandUser {
  id: string;
  displayName: string;
}

/**
 * Adapter-agnostic view of one command invocation.
 * Built by a channel adapter, consumed by module command handlers.
 */
export interface CommandContext {
  readonly commandName: string;
  /** Invoked subcommand name, or null for a flat command. */
  readonly subcommand: string | null;
  readonly adapterKey: string;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly user: CommandUser;
  readonly options: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly logger: Logger;
  /** Null when the adapter has no voice support or the command is not in a guild. */
  readonly voice: VoiceCapability | null;
  /** Acknowledge now, reply later (for slow work). Idempotent. */
  defer(): Promise<void>;
  /** Send the reply (or edit the deferred acknowledgement). */
  reply(payload: ReplyPayload): Promise<void>;
}

/** A subcommand of a parent command (e.g. `/announcement send`). */
export interface SubcommandDefinition {
  name: string;
  description: string;
  options?: CommandOptionDef[];
  execute(ctx: CommandContext): Promise<void>;
}

/** A command contributed by a module, in adapter-neutral form. */
export interface CommandDefinition {
  name: string;
  description: string;
  options?: CommandOptionDef[];
  /** When present, the command groups subcommands and `execute` is optional. */
  subcommands?: SubcommandDefinition[];
  /** True when the command only makes sense inside a guild/server. */
  guildOnly?: boolean;
  execute?(ctx: CommandContext): Promise<void>;
}

export type CommandDispatcher = (ctx: CommandContext) => Promise<void>;
