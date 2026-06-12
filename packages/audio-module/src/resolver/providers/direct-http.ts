import { openSafeHttpStream } from '@botplatform/security';
import type { TrackSummary } from '@botplatform/shared';
import type { AudioProvider, ResolveContext, ResolvedTrack } from '../types.js';

/**
 * Catch-all provider for direct links to audio files (mp3/ogg/wav/m4a/…).
 * The stream is opened lazily at playback time — queued items must not hold
 * sockets — and is transcoded by the adapter via ffmpeg ('arbitrary' input).
 */
export class DirectHttpAudioProvider implements AudioProvider {
  readonly key = 'direct-http';

  canResolve(url: URL): boolean {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  async resolve(rawUrl: string, ctx: ResolveContext): Promise<ResolvedTrack> {
    const url = new URL(rawUrl);
    const metadata: TrackSummary = {
      title: titleFromUrl(url),
      url: rawUrl,
      provider: this.key,
    };

    return {
      metadata,
      source: {
        inputType: 'arbitrary',
        metadata,
        createStream: async () => {
          const result = await openSafeHttpStream(rawUrl, {
            allowedDomains: ctx.allowedDomains,
            timeoutMs: ctx.timeoutMs,
            requireAudioContentType: true,
          });
          return result.stream;
        },
      },
    };
  }
}

function titleFromUrl(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return url.hostname;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
