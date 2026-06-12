import type { VoiceSession } from '@botplatform/core';
import type { PlaybackRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { InternalActionResult, QueueSnapshot } from '@botplatform/shared';
import { GuildPlaybackSession, type SessionLimits } from './session.js';

/**
 * Holds one GuildPlaybackSession per guild. Also the entry point for admin
 * actions arriving over the bot's internal API (no command context there).
 */
export class PlayerManager {
  private readonly sessions = new Map<string, GuildPlaybackSession>();

  constructor(
    private readonly limits: SessionLimits,
    private readonly playback: PlaybackRepo | null,
    private readonly logger: Logger
  ) {}

  /** Bind (or re-bind after a channel move) a guild's session to a voice connection. */
  ensureSession(guildExternalId: string, voice: VoiceSession): GuildPlaybackSession {
    const existing = this.sessions.get(guildExternalId);
    if (existing) {
      if (existing.voice !== voice) existing.attachVoice(voice);
      return existing;
    }
    const session = new GuildPlaybackSession(
      guildExternalId,
      voice,
      this.limits,
      this.playback,
      this.logger.child({ guildId: guildExternalId })
    );
    this.sessions.set(guildExternalId, session);
    return session;
  }

  get(guildExternalId: string): GuildPlaybackSession | undefined {
    return this.sessions.get(guildExternalId);
  }

  async destroySession(guildExternalId: string): Promise<boolean> {
    const session = this.sessions.get(guildExternalId);
    if (!session) return false;
    this.sessions.delete(guildExternalId);
    await session.destroy();
    return true;
  }

  async destroyAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((session) => session.destroy()));
  }

  getSnapshots(): QueueSnapshot[] {
    return [...this.sessions.values()].map((session) => session.getSnapshot());
  }

  async skip(guildExternalId: string): Promise<InternalActionResult> {
    const session = this.sessions.get(guildExternalId);
    if (!session || !session.isActive) {
      return { ok: false, message: 'No active playback in that server.' };
    }
    const result = await session.skip();
    return {
      ok: true,
      message: result.next
        ? `Skipped — now playing: ${result.next.title}`
        : 'Skipped — the queue is empty.',
    };
  }

  async stop(guildExternalId: string): Promise<InternalActionResult> {
    const session = this.sessions.get(guildExternalId);
    if (!session) {
      return { ok: false, message: 'No active playback in that server.' };
    }
    const result = session.stop();
    return {
      ok: true,
      message: result.stoppedTrack
        ? `Stopped playback and cleared ${result.clearedCount} queued track(s).`
        : 'Nothing was playing; cleared the queue.',
    };
  }

  async clearQueue(guildExternalId: string): Promise<InternalActionResult> {
    const session = this.sessions.get(guildExternalId);
    if (!session) {
      return { ok: false, message: 'No active playback in that server.' };
    }
    const cleared = session.clearQueue();
    return { ok: true, message: `Cleared ${cleared} queued track(s).` };
  }
}
