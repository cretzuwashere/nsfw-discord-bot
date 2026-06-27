import { describe, expect, it } from 'vitest';
import { fakeTrack } from '../testing/fakes.js';
import { PlaybackQueue } from './queue.js';

describe('PlaybackQueue', () => {
  it('preserves FIFO order with 1-based positions', () => {
    const queue = new PlaybackQueue(10);
    expect(queue.enqueue(fakeTrack('a'))).toEqual({ ok: true, position: 1 });
    expect(queue.enqueue(fakeTrack('b'))).toEqual({ ok: true, position: 2 });
    expect(queue.dequeue()?.metadata.title).toBe('a');
    expect(queue.dequeue()?.metadata.title).toBe('b');
    expect(queue.dequeue()).toBeUndefined();
  });

  it('rejects beyond the bound', () => {
    const queue = new PlaybackQueue(2);
    queue.enqueue(fakeTrack('a'));
    queue.enqueue(fakeTrack('b'));
    expect(queue.enqueue(fakeTrack('c'))).toEqual({ ok: false, reason: 'full' });
    expect(queue.size).toBe(2);
  });

  it('removeTail drops up to n tracks from the end', () => {
    const queue = new PlaybackQueue(10);
    ['a', 'b', 'c', 'd'].forEach((t) => queue.enqueue(fakeTrack(t)));
    expect(queue.removeTail(2)).toBe(2);
    expect(queue.peekAll().map((i) => i.metadata.title)).toEqual(['a', 'b']);
    expect(queue.removeTail(5)).toBe(2); // only 2 remain
    expect(queue.size).toBe(0);
    expect(queue.removeTail(3)).toBe(0);
  });

  it('clear() empties and reports the removed count', () => {
    const queue = new PlaybackQueue(5);
    queue.enqueue(fakeTrack('a'));
    queue.enqueue(fakeTrack('b'));
    expect(queue.clear()).toBe(2);
    expect(queue.size).toBe(0);
    expect(queue.peekAll()).toEqual([]);
  });
});
