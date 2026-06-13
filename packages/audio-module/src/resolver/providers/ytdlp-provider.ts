import type { TrackSummary } from '@botplatform/shared';
import { UserFacingError } from '@botplatform/shared';
import type { AudioProvider, ResolveContext, ResolvedTrack } from '../types.js';
import type { YtDlpRunner } from '../ytdlp-runner.js';

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
    if (durationSeconds !== undefined && durationSeconds > this.options.maxTrackDurationSeconds) {
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

    return {
      metadata,
      source: {
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
            rawUrl,
          ]),
      },
    };
  }
}

function providerLabel(extractorKey: string | undefined): string {
  if (!extractorKey) return 'yt-dlp';
  const key = extractorKey.toLowerCase();
  if (key.startsWith('youtube')) return 'youtube';
  if (key.startsWith('soundcloud')) return 'soundcloud';
  return extractorKey.toLowerCase();
}
