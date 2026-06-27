import { describe, expect, it } from 'vitest';
import {
  buildPanelMessage,
  formatQueueLines,
  MODERATOR_ACTIONS,
  nextWaiting,
  panelCustomId,
  parsePanelCustomId,
  promotedPriority,
  sortWaiting,
  waitingPosition,
  type QueueEntryView,
} from './logic.js';

function entry(partial: Partial<QueueEntryView> & { userExternalId: string }): QueueEntryView {
  return {
    displayName: partial.userExternalId,
    status: 'waiting',
    priority: 0,
    raisedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partial,
  };
}

describe('sortWaiting', () => {
  it('orders by priority desc then earliest raisedAt', () => {
    const a = entry({ userExternalId: 'a', raisedAt: new Date(1000) });
    const b = entry({ userExternalId: 'b', raisedAt: new Date(2000) });
    const c = entry({ userExternalId: 'c', raisedAt: new Date(3000), priority: 5 });
    const ordered = sortWaiting([a, b, c]).map((e) => e.userExternalId);
    expect(ordered).toEqual(['c', 'a', 'b']);
  });

  it('excludes active and done entries', () => {
    const waiting = entry({ userExternalId: 'w' });
    const active = entry({ userExternalId: 'x', status: 'active' });
    const done = entry({ userExternalId: 'y', status: 'done' });
    expect(sortWaiting([waiting, active, done]).map((e) => e.userExternalId)).toEqual(['w']);
  });
});

describe('nextWaiting', () => {
  it('returns the front of the waiting list', () => {
    const a = entry({ userExternalId: 'a', raisedAt: new Date(2000) });
    const b = entry({ userExternalId: 'b', raisedAt: new Date(1000) });
    expect(nextWaiting([a, b])?.userExternalId).toBe('b');
  });
  it('returns null when no one is waiting', () => {
    expect(nextWaiting([entry({ userExternalId: 'x', status: 'active' })])).toBeNull();
  });
});

describe('promotedPriority', () => {
  it('is one above the current max waiting priority', () => {
    const entries = [
      entry({ userExternalId: 'a', priority: 0 }),
      entry({ userExternalId: 'b', priority: 3 }),
    ];
    expect(promotedPriority(entries)).toBe(4);
  });
  it('starts at 1 for an all-default queue', () => {
    expect(promotedPriority([entry({ userExternalId: 'a' })])).toBe(1);
  });
});

describe('waitingPosition', () => {
  it('is 1-based and respects ordering', () => {
    const a = entry({ userExternalId: 'a', raisedAt: new Date(1000) });
    const b = entry({ userExternalId: 'b', raisedAt: new Date(2000) });
    expect(waitingPosition([a, b], 'b')).toBe(2);
    expect(waitingPosition([a, b], 'a')).toBe(1);
  });
  it('is null for someone not waiting', () => {
    expect(waitingPosition([entry({ userExternalId: 'a' })], 'z')).toBeNull();
  });
});

describe('panel customId', () => {
  it('round-trips action + voice channel id', () => {
    const id = panelCustomId('next', '123456789');
    expect(id).toBe('rh:next:123456789');
    expect(parsePanelCustomId(id)).toEqual({ action: 'next', voiceChannelId: '123456789' });
  });
  it('rejects foreign or malformed ids', () => {
    expect(parsePanelCustomId('rolemenu:abc:def')).toBeNull();
    expect(parsePanelCustomId('rh:bogus:1')).toBeNull();
    expect(parsePanelCustomId('rh:next')).toBeNull();
  });
  it('marks next + clear as moderator actions', () => {
    expect(MODERATOR_ACTIONS.has('next')).toBe(true);
    expect(MODERATOR_ACTIONS.has('clear')).toBe(true);
    expect(MODERATOR_ACTIONS.has('raise')).toBe(false);
  });
});

describe('formatQueueLines', () => {
  it('shows the current speaker and ordered waiters', () => {
    const text = formatQueueLines([
      entry({ userExternalId: 'spk', displayName: 'Alice', status: 'active' }),
      entry({ userExternalId: 'w1', displayName: 'Bob', raisedAt: new Date(1000) }),
      entry({ userExternalId: 'w2', displayName: 'Carol', raisedAt: new Date(2000) }),
    ]);
    expect(text).toContain('Now speaking:** Alice');
    expect(text).toContain('**1.** Bob');
    expect(text).toContain('**2.** Carol');
  });
  it('reports an empty queue', () => {
    expect(formatQueueLines([])).toContain('empty');
  });
});

describe('buildPanelMessage', () => {
  it('emits five buttons whose customIds carry the voice channel id', () => {
    const msg = buildPanelMessage({ voiceChannelId: 'vc1', voiceChannelName: 'General', entries: [] });
    const ids = (msg.buttons ?? []).map((b) => b.customId);
    expect(ids).toEqual([
      'rh:raise:vc1',
      'rh:lower:vc1',
      'rh:show:vc1',
      'rh:next:vc1',
      'rh:clear:vc1',
    ]);
    expect(msg.allowMentions).toEqual({ everyone: false, roles: [], users: [] });
  });
});
