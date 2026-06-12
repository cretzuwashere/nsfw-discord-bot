/**
 * Ports implemented by the database layer (or mocks in tests).
 * Core depends only on these interfaces, never on a concrete database.
 */

export type AuditActorType = 'admin' | 'system' | 'adapter' | 'platform_user';

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | undefined;
  /** Dotted action key, e.g. 'audio.command.play', 'admin.login', 'system.startup'. */
  action: string;
  guildId?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  /** Must never contain secrets or raw error stacks. */
  metadata?: Record<string, unknown> | undefined;
}

export interface AuditLogPort {
  /** Implementations must never throw — audit failure must not break features. */
  record(entry: AuditEntry): Promise<void>;
}

export interface ModuleStatePort {
  isEnabled(moduleKey: string): Promise<boolean>;
}

export interface HealthIndicator {
  name: string;
  check(): Promise<{ status: 'ok' | 'error'; detail?: string | undefined }>;
}
