import { openSafeHttpStream } from '@botplatform/security';
import type { TrackSummary } from '@botplatform/shared';
import type { ResolveContext, ResolvedTrack } from '../resolver/types.js';
import type { RadioStation } from './stations.js';

/**
 * Turn a radio station into a playable track. A radio stream is continuous and
 * has no duration, so the track is flagged `isLive` (exempt from the duration
 * watchdog) and rendered as `🔴 LIVE / streaming` by the now-playing panel.
 *
 * The stream is opened lazily through the same SSRF-safe HTTP opener as direct
 * links, so the station host is subject to ALLOWED_AUDIO_DOMAINS when that
 * allowlist is configured.
 */
export function buildRadioTrack(
  station: RadioStation,
  ctx: ResolveContext,
  requestedBy?: string
): ResolvedTrack {
  const metadata: TrackSummary = {
    title: station.name,
    // Prefer the human website for display; fall back to the stream URL.
    url: station.websiteUrl ?? station.streamUrl,
    provider: 'radio',
    requestedBy,
    // durationSeconds intentionally omitted → renders as LIVE.
  };

  return {
    metadata,
    isLive: true,
    source: {
      inputType: 'arbitrary',
      metadata,
      createStream: async () => {
        const result = await openSafeHttpStream(station.streamUrl, {
          allowedDomains: ctx.allowedDomains,
          timeoutMs: ctx.timeoutMs,
          requireAudioContentType: true,
        });
        return result.stream;
      },
    },
  };
}
