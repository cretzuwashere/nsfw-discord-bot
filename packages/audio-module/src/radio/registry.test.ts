import { describe, expect, it } from 'vitest';
import { isValidStreamUrl, RadioRegistry } from './registry.js';
import type { RadioStation } from './stations.js';

const STATIONS: RadioStation[] = [
  { id: 'a', name: 'Alpha FM', category: 'Rock', streamUrl: 'https://h/a', enabled: true, sort: 2 },
  { id: 'b', name: 'Beta Beats', category: 'Electronic', streamUrl: 'https://h/b', enabled: true, sort: 1 },
  { id: 'c', name: 'Gamma Off', category: 'Rock', streamUrl: 'https://h/c', enabled: false, sort: 1 },
  { id: 'd', name: 'Delta Bad', category: 'Jazz', streamUrl: 'not-a-url', enabled: true, sort: 1 },
];

describe('RadioRegistry', () => {
  it('drops stations with an invalid stream URL at construction', () => {
    expect(new RadioRegistry(STATIONS).get('d')).toBeUndefined();
  });

  it('lists only enabled stations, sorted by category', () => {
    expect(new RadioRegistry(STATIONS).list().map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('includes disabled stations when asked', () => {
    expect(
      new RadioRegistry(STATIONS)
        .list({ includeDisabled: true })
        .map((s) => s.id)
        .sort()
    ).toEqual(['a', 'b', 'c']);
  });

  it('filters by category, case-insensitively', () => {
    expect(new RadioRegistry(STATIONS).list({ category: 'rock' }).map((s) => s.id)).toEqual(['a']);
  });

  it('get() returns enabled stations only', () => {
    const reg = new RadioRegistry(STATIONS);
    expect(reg.get('a')?.name).toBe('Alpha FM');
    expect(reg.get('c')).toBeUndefined();
  });

  it('findByQuery matches exact id, then exact name, then contains', () => {
    const reg = new RadioRegistry(STATIONS);
    expect(reg.findByQuery('a')?.id).toBe('a');
    expect(reg.findByQuery('Beta Beats')?.id).toBe('b');
    expect(reg.findByQuery('beta')?.id).toBe('b');
    expect(reg.findByQuery('zzz')).toBeUndefined();
  });

  it('lists distinct enabled categories, sorted', () => {
    expect(new RadioRegistry(STATIONS).categories()).toEqual(['Electronic', 'Rock']);
  });
});

describe('isValidStreamUrl', () => {
  it('accepts http(s) only', () => {
    expect(isValidStreamUrl('https://x/y')).toBe(true);
    expect(isValidStreamUrl('http://x/y')).toBe(true);
    expect(isValidStreamUrl('ftp://x/y')).toBe(false);
    expect(isValidStreamUrl('nope')).toBe(false);
  });
});

describe('default station set', () => {
  it('ships at least one station, all with valid direct stream URLs', () => {
    const reg = new RadioRegistry();
    const stations = reg.list();
    expect(stations.length).toBeGreaterThan(0);
    for (const station of stations) {
      expect(isValidStreamUrl(station.streamUrl)).toBe(true);
      // Direct stream, not a playlist file.
      expect(station.streamUrl).not.toMatch(/\.(pls|m3u8?|asx)$/i);
    }
  });
});
