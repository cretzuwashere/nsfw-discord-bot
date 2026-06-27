import type { TrackSummary } from '@botplatform/shared';
import { UserFacingError } from '@botplatform/shared';
import type { AudioProvider, PlaylistResolution, ResolveContext, ResolvedTrack } from '../types.js';
import type { FlatPlaylistEntry, YtDlpRunner } from '../ytdlp-runner.js';

/**
 * Resolves YouTube and SoundCloud links (and other yt-dlp-supported sites)
 * to a streamed Opus/best-audio source.
 *
 * Design: metadata is fetched eagerly (cheap `-J` call → title/duration/
 * uploader, and duration is enforced BEFORE queueing); the actual audio
 * stream is opened lazily at playback time so queued items hold no
 * processes. yt-dlp pipes best audio to stdout; ffmpeg (in the voice layer)
 * transcodes it.
 */

const YOUTUBE_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
];
const SOUNDCLOUD_HOSTS = ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'];

interface YtDlpMetadata {
  title?: string;
  duration?: number;
  uploader?: string;
  webpage_url?: string;
  extractor_key?: string;
  is_live?: boolean;
}

export class YtDlpAudioProvider implements AudioProvider {
  readonly key = 'yt-dlp';

  constructor(
    private readonly runner: YtDlpRunner,
    private readonly options: { maxTrackDurationSeconds: number }
  ) {}

  canResolve(url: URL): boolean {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return (
      YOUTUBE_HOSTS.includes(url.hostname.toLowerCase()) ||
      SOUNDCLOUD_HOSTS.includes(url.hostname.toLowerCase()) ||
      host === 'youtube.com' ||
      host === 'youtu.be' ||
      host === 'soundcloud.com'
    );
  }

  async resolve(rawUrl: string, ctx: ResolveContext): Promise<ResolvedTrack> {
    const meta = (await this.runner.json(
      ['-J', '--', rawUrl],
      ctx.timeoutMs
    )) as YtDlpMetadata;

    if (meta.is_live) {
      throw new UserFacingError('AUDIO_RESOLVE_FAILED', 'Live streams are not supported.');
    }
    const durationSeconds =
      typeof meta.duration === 'number' && Number.isFinite(meta.duration)
        ? Math.round(meta.duration)
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
      title: meta.title?.trim() || 'Unknown track',
      url: meta.webpage_url ?? rawUrl,
      provider: providerLabel(meta.extractor_key),
      durationSeconds,
    };

    return { metadata, source: this.streamSource(metadata, rawUrl) };
  }

  /**
   * Expand a YouTube playlist into queueable tracks. Entries are flat-listed
   * once (no per-item extraction) and each becomes a track whose stream is
   * opened lazily — identical to single-video playback — when it reaches the
   * front of the queue.
   */
  async resolvePlaylist(
    rawUrl: string,
    ctx: ResolveContext,
    limit: number
  ): Promise<PlaylistResolution> {
    const playlist = await this.runner.flatPlaylist(rawUrl, ctx.timeoutMs, limit);
    const entries = playlist.entries ?? [];
    const max = this.options.maxTrackDurationSeconds;
    const tracks: ResolvedTrack[] = [];
    let skipped = 0;

    for (const entry of entries) {
      const url = entryUrl(entry);
      const durationSeconds =
        typeof entry.duration === 'number' && Number.isFinite(entry.duration)
          ? Math.round(entry.duration)
          : undefined;
      const tooLong = max > 0 && durationSeconds !== undefined && durationSeconds > max;
      if (!url || isUnavailable(entry) || tooLong) {
        skipped++;
        continue;
      }
      // Playable but beyond the cap: stop adding, but keep iterating so the
      // `skipped` count stays accurate (the caller derives the capped count).
      if (tracks.length >= limit) continue;

      const metadata: TrackSummary = {
        title: entry.title?.trim() || 'Unknown track',
        url,
        provider: 'youtube',
        durationSeconds,
      };
      tracks.push({ metadata, source: this.streamSource(metadata, url) });
    }

    return { tracks, total: entries.length, skipped, title: playlist.title };
  }

  private streamSource(metadata: TrackSummary, url: string): ResolvedTrack['source'] {
    return {
      inputType: 'arbitrary',
      metadata,
      // Lazy: the downloader starts only when playback begins.
      createStream: async () =>
        this.runner.stream([
          '-f',
          'bestaudio/best',
          '-o',
          '-', // stream to stdout
          '--',
          url,
        ]),
    };
  }
}

/** Build a playable URL from a flat-playlist entry (full URL or bare id). */
function entryUrl(entry: FlatPlaylistEntry): string | null {
  if (entry.webpage_url && /^https?:\/\//i.test(entry.webpage_url)) return entry.webpage_url;
  if (entry.url && /^https?:\/\//i.test(entry.url)) return entry.url;
  if (entry.id) return `https://www.youtube.com/watch?v=${entry.id}`;
  if (entry.url) return `https://www.youtube.com/watch?v=${entry.url}`;
  return null;
}

/** Drop private/deleted/region-locked entries that can never play. */
function isUnavailable(entry: FlatPlaylistEntry): boolean {
  const title = (entry.title ?? '').toLowerCase();
  if (
    title.includes('[private video]') ||
    title.includes('[deleted video]') ||
    title.includes('[unavailable video]')
  ) {
    return true;
  }
  const availability = entry.availability?.toLowerCase();
  if (availability && availability !== 'public' && availability !== 'unlisted') return true;
  return false;
}

function providerLabel(extractorKey: string | undefined): string {
  if (!extractorKey) return 'yt-dlp';
  const key = extractorKey.toLowerCase();
  if (key.startsWith('youtube')) return 'youtube';
  if (key.startsWith('soundcloud')) return 'soundcloud';
  return extractorKey.toLowerCase();
}
