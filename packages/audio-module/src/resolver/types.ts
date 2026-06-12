import type { AudioStreamSource } from '@botplatform/core';
import type { Logger } from '@botplatform/logger';
import type { TrackSummary } from '@botplatform/shared';

export interface ResolveContext {
  /** Lowercased domain allowlist; empty = any public domain. */
  allowedDomains: string[];
  /** Network timeout for metadata/stream setup. */
  timeoutMs: number;
  logger: Logger;
}

/** A track ready for playback: display metadata + a lazily-opened source. */
export interface ResolvedTrack {
  metadata: TrackSummary;
  source: AudioStreamSource;
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
}
