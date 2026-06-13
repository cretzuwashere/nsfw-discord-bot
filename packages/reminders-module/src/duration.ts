/**
 * Parse a human duration like "30m", "2h", "1d 6h", "90" (minutes) into
 * seconds. Returns null when nothing parseable is found. Pure and testable.
 */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  m: 60,
  min: 60,
  h: 3600,
  hr: 3600,
  d: 86400,
  w: 604800,
};

const MAX_SECONDS = 365 * 86400; // one year

export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === '') return null;

  // Bare number → minutes.
  if (/^\d+$/.test(text)) {
    const minutes = Number(text);
    return clamp(minutes * 60);
  }

  const matches = [...text.matchAll(/(\d+)\s*(w|d|h|hr|m|min|s|sec)/g)];
  if (matches.length === 0) return null;
  let total = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    const unit = UNIT_SECONDS[match[2]!];
    if (unit) total += value * unit;
  }
  return total > 0 ? clamp(total) : null;
}

function clamp(seconds: number): number {
  return Math.min(Math.max(Math.round(seconds), 60), MAX_SECONDS);
}
