/** Pure input validation for guild settings forms (unit-tested directly). */

export interface GuildSettingsValues {
  allowedAudioDomains: string[];
  maxQueueSize: number | null;
  maxTrackDurationSeconds: number | null;
}

export type GuildSettingsValidation =
  | { ok: true; values: GuildSettingsValues }
  | { ok: false; errors: string[] };

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;
const MAX_DOMAINS = 50;

export function validateGuildSettingsInput(
  body: Record<string, unknown>
): GuildSettingsValidation {
  const errors: string[] = [];

  const rawDomains = typeof body['allowedAudioDomains'] === 'string'
    ? body['allowedAudioDomains']
    : '';
  const domains = [
    ...new Set(
      rawDomains
        .split(/[\n,]/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (domains.length > MAX_DOMAINS) {
    errors.push(`At most ${MAX_DOMAINS} domains are allowed.`);
  }
  for (const domain of domains) {
    if (domain.includes('/') || domain.includes(':')) {
      errors.push(`'${domain}' must be a bare domain (no scheme, path or port).`);
    } else if (!DOMAIN_PATTERN.test(domain)) {
      errors.push(`'${domain}' is not a valid domain name.`);
    }
  }

  const maxQueueSize = parseOptionalInt(body['maxQueueSize'], 1, 1000, 'Max queue size', errors);
  const maxTrackDurationSeconds = parseOptionalInt(
    body['maxTrackDurationSeconds'],
    1,
    86_400,
    'Max track duration',
    errors
  );

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { allowedAudioDomains: domains, maxQueueSize, maxTrackDurationSeconds },
  };
}

/** Empty string means "inherit the global default" (stored as null). */
function parseOptionalInt(
  raw: unknown,
  min: number,
  max: number,
  label: string,
  errors: string[]
): number | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${label} must be a whole number between ${min} and ${max}.`);
    return null;
  }
  return value;
}
