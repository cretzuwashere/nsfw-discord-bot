import { describe, expect, it } from 'vitest';
import { classifyYouTubeUrl, isMixList } from './youtube-url.js';

const classify = (url: string) => classifyYouTubeUrl(new URL(url));

describe('classifyYouTubeUrl', () => {
  it('classifies a single video', () => {
    expect(classify('https://www.youtube.com/watch?v=abc').kind).toBe('video');
    expect(classify('https://youtu.be/abc').kind).toBe('video');
    expect(classify('https://music.youtube.com/watch?v=abc').kind).toBe('video');
    expect(classify('https://www.youtube.com/shorts/abc').kind).toBe('video');
  });

  it('classifies a pure playlist', () => {
    const info = classify('https://www.youtube.com/playlist?list=PL123');
    expect(info.kind).toBe('playlist');
    expect(info.listId).toBe('PL123');
  });

  it('classifies a video inside a playlist', () => {
    const info = classify('https://www.youtube.com/watch?v=abc&list=PL123');
    expect(info.kind).toBe('video-in-playlist');
    expect(info.videoId).toBe('abc');
    expect(info.listId).toBe('PL123');
  });

  it('treats an RD mix/radio as an expandable playlist (video-in-playlist)', () => {
    const info = classify('https://www.youtube.com/watch?v=abc&list=RDabc');
    expect(info.kind).toBe('video-in-playlist');
    expect(info.videoId).toBe('abc');
    expect(info.listId).toBe('RDabc');
  });

  it('treats an album list (OLAK…) as a playlist', () => {
    expect(classify('https://www.youtube.com/playlist?list=OLAK5uy_abc').kind).toBe('playlist');
  });

  it('returns not-youtube for other hosts', () => {
    expect(classify('https://example.com/a.mp3').kind).toBe('not-youtube');
    expect(classify('https://soundcloud.com/a/b').kind).toBe('not-youtube');
  });
});

describe('isMixList', () => {
  it('detects RD-family mix/radio lists', () => {
    expect(isMixList('RDVLKqKUJSCv4')).toBe(true);
    expect(isMixList('RDMMabc')).toBe(true);
    expect(isMixList('RDCLAK5uy_abc')).toBe(true);
  });
  it('rejects normal playlists, albums, and empties', () => {
    expect(isMixList('PL123')).toBe(false);
    expect(isMixList('OLAK5uy_abc')).toBe(false);
    expect(isMixList(undefined)).toBe(false);
    expect(isMixList('')).toBe(false);
  });
});
