import { RADIO_STATIONS, type RadioStation } from './stations.js';

/**
 * The single read interface over the configured radio stations. Command
 * handlers and the resolver depend on this — never on the raw station array —
 * so the underlying source (static file today, DB/admin later) can change
 * without touching callers.
 *
 * Stations with a malformed `streamUrl` are dropped at construction so a bad
 * entry can never reach playback.
 */
export class RadioRegistry {
  private readonly stations: RadioStation[];

  constructor(stations: readonly RadioStation[] = RADIO_STATIONS) {
    this.stations = stations
      .filter((station) => isValidStreamUrl(station.streamUrl))
      .slice()
      .sort((a, b) => a.category.localeCompare(b.category) || a.sort - b.sort || a.name.localeCompare(b.name));
  }

  /** Enabled stations, optionally filtered by (case-insensitive) category. */
  list(opts: { category?: string; includeDisabled?: boolean } = {}): RadioStation[] {
    const category = opts.category?.trim().toLowerCase();
    return this.stations.filter((station) => {
      if (!opts.includeDisabled && !station.enabled) return false;
      if (category && station.category.toLowerCase() !== category) return false;
      return true;
    });
  }

  /** Look up a single enabled station by exact id. */
  get(id: string): RadioStation | undefined {
    const wanted = id.trim().toLowerCase();
    return this.stations.find((station) => station.enabled && station.id.toLowerCase() === wanted);
  }

  /**
   * Resolve a user query to a station: exact id first, then a case-insensitive
   * name/contains match. Returns undefined when nothing matches.
   */
  findByQuery(query: string): RadioStation | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const enabled = this.stations.filter((station) => station.enabled);
    return (
      enabled.find((station) => station.id.toLowerCase() === q) ??
      enabled.find((station) => station.name.toLowerCase() === q) ??
      enabled.find((station) => station.name.toLowerCase().includes(q))
    );
  }

  /** Distinct categories that have at least one enabled station. */
  categories(): string[] {
    const seen = new Set<string>();
    for (const station of this.stations) {
      if (station.enabled) seen.add(station.category);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }
}

export function isValidStreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
