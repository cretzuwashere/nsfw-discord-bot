/**
 * Error types shared across the platform.
 *
 * The golden rule: raw internal errors must never reach end users (Discord
 * replies, admin UI). `UserFacingError.safeMessage` is the ONLY error text
 * allowed to cross that boundary.
 */

export type PlatformErrorCode =
  | 'CONFIG_INVALID'
  | 'DATABASE_ERROR'
  | 'ADAPTER_ERROR'
  | 'MODULE_DISABLED'
  | 'COMMAND_NOT_FOUND'
  | 'VOICE_UNAVAILABLE'
  | 'URL_INVALID'
  | 'URL_BLOCKED'
  | 'URL_UNSUPPORTED'
  | 'AUDIO_RESOLVE_FAILED'
  | 'AUDIO_PLAYBACK_FAILED'
  | 'QUEUE_FULL'
  | 'TRACK_TOO_LONG'
  | 'AUTH_FAILED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'INTERNAL';

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PlatformError';
    this.code = code;
  }
}

/**
 * An error whose `safeMessage` may be shown to end users verbatim.
 * Anything else must be replaced by a generic message at the boundary.
 */
export class UserFacingError extends PlatformError {
  readonly safeMessage: string;

  constructor(code: PlatformErrorCode, safeMessage: string, options?: { cause?: unknown }) {
    super(code, safeMessage, options);
    this.name = 'UserFacingError';
    this.safeMessage = safeMessage;
  }
}

export const GENERIC_USER_ERROR = 'Something went wrong while handling that. Please try again.';

/** Extract a message that is safe to show to an end user. */
export function toSafeUserMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.safeMessage;
  return GENERIC_USER_ERROR;
}
