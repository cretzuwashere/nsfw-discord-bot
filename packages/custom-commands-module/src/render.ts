import type { OutgoingMessage } from '@botplatform/core';
import { applyPlaceholders, type PlaceholderData } from '@botplatform/shared';
import type { CustomCommandRow } from './repo.js';

export interface CustomResponseConfig {
  /** text/link */
  text?: string;
  /** embed */
  title?: string;
  description?: string;
  color?: number;
  /** link/button */
  url?: string;
  label?: string;
  /** random: list of text responses */
  choices?: string[];
}

/**
 * Render a custom command's stored response into an adapter-neutral message.
 * `pickIndex` selects a deterministic choice for 'random' (tests pass a fixed
 * index; runtime passes a varying one).
 */
export function renderCustomResponse(
  command: CustomCommandRow,
  data: PlaceholderData,
  pickIndex = 0
): OutgoingMessage {
  const config = (command.response ?? {}) as CustomResponseConfig;
  const noMentions = { everyone: false, roles: [] as string[], users: [] as string[] };

  switch (command.responseType) {
    case 'embed':
      return {
        embed: {
          title: config.title ? applyPlaceholders(config.title, data) : undefined,
          description: config.description ? applyPlaceholders(config.description, data) : undefined,
          color: typeof config.color === 'number' ? config.color : 0x4f8cff,
        },
        allowMentions: noMentions,
      };
    case 'random': {
      const choices = config.choices ?? [];
      const chosen = choices.length > 0 ? choices[pickIndex % choices.length]! : '';
      return { content: applyPlaceholders(chosen, data) || '(empty)', allowMentions: noMentions };
    }
    case 'link':
      return {
        content: config.text ? applyPlaceholders(config.text, data) : undefined,
        buttons: config.url ? [{ label: config.label || 'Open', style: 'link', url: config.url }] : undefined,
        allowMentions: noMentions,
      };
    case 'text':
    default:
      return {
        content: applyPlaceholders(config.text ?? '', data) || '(empty)',
        allowMentions: noMentions,
      };
  }
}

/** Validate a custom command name: lowercase, 1-32 chars, [a-z0-9_-]. */
export function isValidCommandName(name: string): boolean {
  return /^[a-z0-9_-]{1,32}$/.test(name);
}
