/** Truncate a string for display, appending an ellipsis when cut. */
export function truncate(value: string, maxLength: number): string {
  if (maxLength <= 1) return value.slice(0, maxLength);
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

/** Format seconds as h:mm:ss or m:ss for display. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '?:??';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/** Parse JSON without throwing; returns fallback on failure. */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Comma-separated list → trimmed, lowercased, deduplicated string array. */
export function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
