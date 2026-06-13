/**
 * Re-export the shared placeholder utilities so the cards module's public API
 * stays stable. The implementation lives in @botplatform/shared (used by
 * welcome, birthday, scheduled and custom-command modules too).
 */
export {
  applyPlaceholders,
  buildPlaceholderData,
  SUPPORTED_PLACEHOLDERS,
  type PlaceholderData,
} from '@botplatform/shared';
