import type { ComponentInteractionEvent } from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import type { QueueSnapshot } from '@botplatform/shared';
import { describe, expect, it } from 'vitest';
import { buildAudioComponentHandler } from './commands.js';
import { PlayerManager } from './engine/manager.js';
import {
  audioButtonId,
  buildNowPlayingPanel,
  parseAudioButton,
  progressBar,
} from './now-playing.js';
import { fakeTrack, FakeVoiceSession } from './testing/fakes.js';

describe('progressBar', () => {
  it('fills proportionally and shows elapsed/total', () => {
    const bar = progressBar(60, 120, 10);
    expect(bar).toContain('1:00 / 2:00');
    expect(bar).toMatch(/█{5}▒{5}/); // 50%
  });
  it('handles unknown duration as a live/streaming indicator', () => {
    expect(progressBar(42, undefined)).toMatch(/LIVE|streaming/i);
  });
  it('clamps overflow to full', () => {
    expect(progressBar(999, 100, 8)).toMatch(/█{8}/);
  });
});

describe('audio button id round-trip', () => {
  it('encodes and parses controls', () => {
    expect(parseAudioButton(audioButtonId('pause'))).toBe('pause');
    expect(parseAudioButton(audioButtonId('leave'))).toBe('leave');
    expect(parseAudioButton('rolemenu:x:y')).toBeNull();
    expect(parseAudioButton('audio:bogus')).toBeNull();
  });
});

describe('buildNowPlayingPanel', () => {
  it('renders an idle panel', () => {
    const panel = buildNowPlayingPanel(undefined);
    expect(panel.embed?.title).toMatch(/idle/i);
    expect(panel.buttons?.some((b) => b.customId === 'audio:leave')).toBe(true);
  });

  it('renders a playing panel with progress + pause control', () => {
    const snapshot: QueueSnapshot = {
      guildId: 'g',
      channelName: 'music',
      status: 'playing',
      nowPlaying: { title: 'Song', url: 'https://x/y', provider: 'youtube', durationSeconds: 200, requestedBy: 'Ada' },
      queue: [{ title: 'Next', url: 'u', provider: 'youtube' }],
      maxQueueSize: 50,
      elapsedSeconds: 50,
    };
    const panel = buildNowPlayingPanel(snapshot);
    expect(panel.embed?.title).toMatch(/Now Playing/i);
    expect(panel.embed?.description).toContain('Song');
    expect(panel.buttons?.some((b) => b.customId === 'audio:pause')).toBe(true);
    expect(panel.buttons?.some((b) => b.customId === 'audio:resume')).toBe(false);
    // Has an "Up next" field.
    expect(panel.embed?.fields?.some((f) => /Up next/.test(f.name))).toBe(true);
  });

  it('shows a resume control when paused', () => {
    const panel = buildNowPlayingPanel({
      guildId: 'g',
      status: 'paused',
      nowPlaying: { title: 'Song', url: 'u', provider: 'youtube' },
      queue: [],
      maxQueueSize: 50,
    });
    expect(panel.embed?.title).toMatch(/Paused/i);
    expect(panel.buttons?.some((b) => b.customId === 'audio:resume')).toBe(true);
  });
});

describe('buildAudioComponentHandler', () => {
  function setup() {
    const manager = new PlayerManager(
      { maxQueueSize: 5, maxTrackDurationSeconds: 3600 },
      null,
      createSilentLogger()
    );
    const voice = new FakeVoiceSession('guild-1', 'chan-1', 'music');
    const session = manager.ensureSession('guild-1', voice);
    return { manager, voice, session };
  }

  function event(customId: string): ComponentInteractionEvent & { updates: unknown[]; replies: string[] } {
    const updates: unknown[] = [];
    const replies: string[] = [];
    return {
      type: 'component.interaction',
      adapterKey: 'discord',
      guild: { id: null, externalId: 'guild-1', name: 'G' },
      channelId: 'chan-1',
      customId,
      values: [],
      user: { externalId: 'u1', username: 'Ada', displayName: 'Ada' },
      userRoleIds: [],
      updates,
      replies,
      reply: async (c: string) => void replies.push(c),
      update: async (m) => void updates.push(m),
    };
  }

  it('ignores non-audio component ids', async () => {
    const { manager } = setup();
    const handle = buildAudioComponentHandler(manager);
    const e = event('rolemenu:abc:def');
    await handle(e);
    expect(e.updates).toHaveLength(0);
    expect(e.replies).toHaveLength(0);
  });

  it('pauses then refreshes the panel in place', async () => {
    const { manager, session } = setup();
    await session.enqueueOrPlay(fakeTrack('song'));
    const handle = buildAudioComponentHandler(manager);
    const e = event('audio:pause');
    await handle(e);
    expect(session.getSnapshot().status).toBe('paused');
    expect(e.updates).toHaveLength(1);
  });

  it('leave destroys the session and refreshes to idle', async () => {
    const { manager, session } = setup();
    await session.enqueueOrPlay(fakeTrack('song'));
    const handle = buildAudioComponentHandler(manager);
    await handle(event('audio:leave'));
    expect(manager.get('guild-1')).toBeUndefined();
  });
});
