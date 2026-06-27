import { openSafeHttpStream } from '@botplatform/security';
import type { TrackSummary } from '@botplatform/shared';
import { UserFacingError } from '@botplatform/shared';
import type { AudioProvider, ResolveContext, ResolvedTrack } from '../types.js';
import type { YtDlpRunner } from '../ytdlp-runner.js';

/**
 * Spotify streams are DRM-protected and cannot be played directly. The
 * universally-used self-hosted approach: read the track's public title +
 * artist from Spotify's oEmbed endpoint, then play the best audio match from
 * YouTube via yt-dlp's search (`ytsearch1:`).
 *
 * This handles single tracks only (not playlists/albums) in v1.
 */

const SPOTIFY_HOSTS = ['open.spotify.com', 'spotify.com', 'www.spotify.com'];
const OEMBED_ENDPOINT = 'https://open.spotify.com/oembed';

interface SpotifyOEmbed {
  title?: string;
  // oEmbed title is usually "Track — Artist"; we also accept just the title.
}

interface YtSearchResult {
  entries?: Array<{ title?: string; duration?: number; webpage_url?: string }>;
  title?: string;
  duration?: number;
  webpage_url?: string;
}

export class SpotifyAudioProvider implements AudioProvider {
  readonly key = 'spotify';

  constructor(
    private readonly runner: YtDlpRunner,
    private readonly options: { maxTrackDurationSeconds: number }
  ) {}

  canResolve(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    if (!SPOTIFY_HOSTS.includes(host)) return false;
    // Only single tracks; albums/playlists are out of scope for v1.
    return url.pathname.includes('/track/');
  }

  async resolve(rawUrl: string, ctx: ResolveContext): Promise<ResolvedTrack> {
    const query = await this.lookupSpotifyTitle(rawUrl, ctx);

    // Use yt-dlp's YouTube search; ytsearch1 returns the top single result.
    const searchResult = (await this.runner.json(
      ['-J', '--default-search', 'ytsearch', `ytsearch1:${query} audio`],
      ctx.timeoutMs
    )) as YtSearchResult;

    const best = searchResult.entries?.[0] ?? searchResult;
    const matchUrl = best.webpage_url;
    if (!matchUrl) {
      throw new UserFacingError(
        'AUDIO_RESOLVE_FAILED',
        'No playable source was found for that Spotify track.'
      );
    }

    const durationSeconds =
      typeof best.duration === 'number' && Number.isFinite(best.duration)
        ? Math.round(best.duration)
        : undefined;
    // A limit of 0 means "unlimited" — skip the up-front reject entirely.
    if (
      this.options.maxTrackDurationSeconds > 0 &&
      durationSeconds !== undefined &&
      durationSeconds > this.options.maxTrackDurationSeconds
    ) {
      throw new UserFacingError(
        'TRACK_TOO_LONG',
        `That track is too long (limit ${this.options.maxTrackDurationSeconds}s).`
      );
    }

    const metadata: TrackSummary = {
      title: query,
      url: rawUrl, // show the original Spotify link to the user
      provider: 'spotify',
      durationSeconds,
    };

    return {
      metadata,
      source: {
        inputType: 'arbitrary',
        metadata,
        createStream: async () =>
          this.runner.stream(['-f', 'bestaudio/best', '-o', '-', '--', matchUrl]),
      },
    };
  }

  /** Fetch "Title — Artist" from Spotify's public oEmbed (no auth needed). */
  private async lookupSpotifyTitle(rawUrl: string, ctx: ResolveContext): Promise<string> {
    const endpoint = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(rawUrl)}`;
    // Reuse the SSRF-safe fetch (oEmbed is on a public Spotify host).
    const result = await openSafeHttpStream(endpoint, {
      allowedDomains: ctx.allowedDomains,
      timeoutMs: ctx.timeoutMs,
      requireAudioContentType: false,
    }).catch(() => null);

    if (result) {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of result.stream) {
          chunks.push(chunk as Buffer);
          if (Buffer.concat(chunks).length > 64 * 1024) break; // tiny JSON; cap
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SpotifyOEmbed;
        const title = body.title?.trim();
        if (title) return title;
      } catch {
        // fall through to the error below
      }
    }
    throw new UserFacingError(
      'AUDIO_RESOLVE_FAILED',
      'That Spotify track could not be read (only public single tracks are supported).'
    );
  }
}
