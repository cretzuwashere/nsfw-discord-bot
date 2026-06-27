import type { GuildService, GuildServiceProvider, SentMessageRef } from '@botplatform/core';
import { createSilentLogger } from '@botplatform/logger';
import { describe, expect, it, vi } from 'vitest';
import { fakeTrack, FakeVoiceSession } from '../testing/fakes.js';
import { PlayerManager } from './manager.js';

const LIMITS = { maxQueueSize: 10, maxTrackDurationSeconds: 3600 };

function fakeGuildService() {
  const sent: Array<{ channelId: string }> = [];
  const deleted: string[] = [];
  let counter = 0;
  const guildService = {
    sendMessage: vi.fn(async (channelId: string): Promise<SentMessageRef> => {
      sent.push({ channelId });
      counter += 1;
      return { channelId, messageId: `m${counter}` };
    }),
    deleteMessage: vi.fn(async (_channelId: string, messageId: string) => {
      deleted.push(messageId);
    }),
  } as unknown as GuildService;
  return { guildService, sent, deleted };
}

describe('PlayerManager now-playing announce', () => {
  it('reposts the panel on track changes, deleting the previous one', async () => {
    const { guildService, sent, deleted } = fakeGuildService();
    const provider: GuildServiceProvider = { isReady: () => true, forGuild: () => guildService };
    const manager = new PlayerManager(LIMITS, null, createSilentLogger(), provider);

    const voice = new FakeVoiceSession();
    const session = manager.ensureSession('guild-1', voice);
    session.setTextChannel('text-1');
    await session.enqueueOrPlay(fakeTrack('A'));
    await session.enqueueOrPlay(fakeTrack('B'));
    await session.enqueueOrPlay(fakeTrack('C'));
    expect(sent).toHaveLength(0); // initial play does not auto-post

    voice.emitFinished(); // A → B (first auto-post, nothing to delete)
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.channelId).toBe('text-1');
    expect(deleted).toHaveLength(0);

    voice.emitFinished(); // B → C (delete the previous panel, post a new one)
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(deleted).toEqual(['m1']);
  });

  it('does nothing when the provider is not ready', async () => {
    const { guildService, sent } = fakeGuildService();
    const provider: GuildServiceProvider = { isReady: () => false, forGuild: () => guildService };
    const manager = new PlayerManager(LIMITS, null, createSilentLogger(), provider);
    const voice = new FakeVoiceSession();
    const session = manager.ensureSession('guild-1', voice);
    session.setTextChannel('text-1');
    await session.enqueueOrPlay(fakeTrack('A'));
    await session.enqueueOrPlay(fakeTrack('B'));
    voice.emitFinished();
    await vi.waitFor(() => expect(session.getSnapshot().nowPlaying?.title).toBe('B'));
    expect(sent).toHaveLength(0);
  });
});
