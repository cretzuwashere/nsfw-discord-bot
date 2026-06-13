/** Pure validation for announcement input — unit-tested directly. */

export type MentionMode = 'none' | 'here' | 'everyone' | 'roles';

export interface AnnouncementInput {
  title: string;
  body: string;
  format: 'plain' | 'embed';
  targetChannelId: string;
  mentionMode: MentionMode;
  mentionRoleIds: string[];
  embedColor?: string | undefined;
  footer?: string | undefined;
  imageUrl?: string | undefined;
}

export type AnnouncementValidation =
  | { ok: true; value: AnnouncementInput; warnings: string[] }
  | { ok: false; errors: string[] };

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;
const MAX_TITLE = 256;
const MAX_BODY = 4000;

export interface RawAnnouncement {
  title?: unknown;
  body?: unknown;
  format?: unknown;
  targetChannelId?: unknown;
  mentionMode?: unknown;
  mentionRoleIds?: unknown;
  embedColor?: unknown;
  footer?: unknown;
  imageUrl?: unknown;
  /** Must be 'on'/'true' to permit @everyone or @here. */
  confirmMassMention?: unknown;
}

/**
 * Validate and normalize an announcement. Mass mentions (@everyone/@here) are
 * REJECTED unless `confirmMassMention` is explicitly set — the core
 * accidental-ping guard.
 */
export function validateAnnouncement(raw: RawAnnouncement): AnnouncementValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const title = str(raw.title);
  const body = str(raw.body);
  const format = raw.format === 'embed' ? 'embed' : 'plain';
  const targetChannelId = str(raw.targetChannelId);
  const mentionMode = normalizeMentionMode(raw.mentionMode);

  if (title.length > MAX_TITLE) errors.push(`Title must be at most ${MAX_TITLE} characters.`);
  if (!body && !title) errors.push('An announcement needs a title or a body.');
  if (body.length > MAX_BODY) errors.push(`Body must be at most ${MAX_BODY} characters.`);
  if (!targetChannelId) errors.push('A target channel is required.');

  const mentionRoleIds = Array.isArray(raw.mentionRoleIds)
    ? raw.mentionRoleIds.map(String).filter(Boolean)
    : typeof raw.mentionRoleIds === 'string'
      ? raw.mentionRoleIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  if (mentionMode === 'roles' && mentionRoleIds.length === 0) {
    errors.push('Role mention mode requires at least one role.');
  }

  if (mentionMode === 'everyone' || mentionMode === 'here') {
    const confirmed = raw.confirmMassMention === 'on' || raw.confirmMassMention === 'true' || raw.confirmMassMention === true;
    if (!confirmed) {
      errors.push(
        `Mentioning @${mentionMode} pings many members — re-submit with the confirmation checkbox ticked.`
      );
    } else {
      warnings.push(`This announcement will ping @${mentionMode}.`);
    }
  }

  let embedColor: string | undefined;
  if (raw.embedColor !== undefined && raw.embedColor !== null && str(raw.embedColor) !== '') {
    const color = str(raw.embedColor);
    if (!HEX_COLOR.test(color)) errors.push('Embed color must be a 6-digit hex value.');
    else embedColor = color.startsWith('#') ? color : `#${color}`;
  }

  const imageUrl = optionalUrl(raw.imageUrl, errors);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    value: {
      title,
      body,
      format,
      targetChannelId,
      mentionMode,
      mentionRoleIds,
      embedColor,
      footer: str(raw.footer) || undefined,
      imageUrl,
    },
  };
}

/** Convert a hex color string to the integer Discord embeds expect. */
export function hexColorToInt(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return undefined;
  return Number.parseInt(clean, 16);
}

function normalizeMentionMode(value: unknown): MentionMode {
  return value === 'here' || value === 'everyone' || value === 'roles' ? value : 'none';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalUrl(value: unknown, errors: string[]): string | undefined {
  const url = str(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.push('Image URL must be http(s).');
      return undefined;
    }
    return url;
  } catch {
    errors.push('Image URL is not a valid link.');
    return undefined;
  }
}
