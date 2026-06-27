import type { AudioStreamSource } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import type { TrackSummary } from '@botplatform/shared';

export interface ResolveContext {
  /** Lowercased domain allowlist; empty = any public domain. */
  allowedDomains: string[];
  /** Network timeout for metadata/stream setup. */
  timeoutMs: number;
  /** Tracks with known metadata longer than this are rejected up front. */
  maxTrackDurationSeconds?: number | undefined;
  logger: Logger;
}

/** A track ready for playback: display metadata + a lazily-opened source. */
export interface ResolvedTrack {
  metadata: TrackSummary;
  source: AudioStreamSource;
  /**
   * Continuous/live source (online radio, livestream). Live tracks have no
   * meaningful duration and are exempt from the per-track duration watchdog
   * in the playback session.
   */
  isLive?: boolean;
}

/**
 * Result of expanding a playlist URL into queueable tracks. `total` is the raw
 * number of entries the playlist reported; `skipped` counts entries dropped as
 * unavailable/private/deleted/too-long. Entries that are playable but beyond
 * the requested cap are neither in `tracks` nor in `skipped` — the caller can
 * derive that count as `total - skipped - tracks.length`.
 */
export interface PlaylistResolution {
  tracks: ResolvedTrack[];
  total: number;
  skipped: number;
  title?: string | undefined;
}

/**
 * A pluggable audio source provider. Future providers (e.g. a YouTube
 * resolver service) implement this interface and register AHEAD of the
 * direct-HTTP catch-all. Video playback is explicitly out of scope for v1.
 */
export interface AudioProvider {
  readonly key: string;
  /** Cheap synchronous check against an already-validated URL. */
  canResolve(url: URL): boolean;
  /** Produce metadata + a lazy stream source. Must not open sockets eagerly. */
  resolve(rawUrl: string, ctx: ResolveContext): Promise<ResolvedTrack>;
  /**
   * Optional: expand a playlist URL into many tracks (lazy per-item streams).
   * Only providers that understand playlists implement this; the resolver
   * routes playlist requests to the first claiming provider that has it.
   */
  resolvePlaylist?(rawUrl: string, ctx: ResolveContext, limit: number): Promise<PlaylistResolution>;
}
