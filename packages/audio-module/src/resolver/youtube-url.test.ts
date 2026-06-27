import { describe, expect, it } from 'vitest';
import { classifyYouTubeUrl } from './youtube-url.js';

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

  it('treats auto-generated mixes (RD…) as a plain video, not a playlist', () => {
    expect(classify('https://www.youtube.com/watch?v=abc&list=RDabc').kind).toBe('video');
  });

  it('returns not-youtube for other hosts', () => {
    expect(classify('https://example.com/a.mp3').kind).toBe('not-youtube');
    expect(classify('https://soundcloud.com/a/b').kind).toBe('not-youtube');
  });
});
