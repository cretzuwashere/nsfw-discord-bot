/**
 * Pure YouTube URL classification — no I/O. Lets the command layer decide
 * whether a link should play a single video or expand a playlist, without
 * touching extraction logic.
 */

export type YouTubeUrlKind = 'video' | 'playlist' | 'video-in-playlist' | 'not-youtube';

export interface YouTubeUrlInfo {
  kind: YouTubeUrlKind;
  videoId?: string | undefined;
  listId?: string | undefined;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

/**
 * Auto-generated mixes/radios (`list=RD…`, `UL…`) are endless and per-viewer —
 * expanding them makes no sense, so they are treated as a plain video.
 */
function isAutoMix(listId: string): boolean {
  return /^(RD|UL|RDMM|RDCLAK|RDEM)/i.test(listId);
}

function videoIdFrom(url: URL): string | undefined {
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0] || undefined;
  if (url.pathname === '/watch') return url.searchParams.get('v') ?? undefined;
  if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] || undefined;
  if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || undefined;
  if (url.pathname.startsWith('/live/')) return url.pathname.split('/')[2] || undefined;
  return undefined;
}

export function classifyYouTubeUrl(url: URL): YouTubeUrlInfo {
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return { kind: 'not-youtube' };

  const rawList = url.searchParams.get('list') ?? undefined;
  const listId = rawList && !isAutoMix(rawList) ? rawList : undefined;
  const videoId = videoIdFrom(url);
  const isPlaylistPath = url.pathname === '/playlist';

  if (listId && videoId) return { kind: 'video-in-playlist', videoId, listId };
  if (listId && (isPlaylistPath || !videoId)) return { kind: 'playlist', listId };
  if (videoId) return { kind: 'video', videoId };
  // A YouTube link we don't specifically parse (channel, etc.) — treat as a
  // single resolve and let yt-dlp decide.
  return { kind: 'video' };
}
