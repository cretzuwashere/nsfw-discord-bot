import type {
  GuildService,
  GuildServiceProvider,
  SentMessageRef,
  VoiceSession,
} from '@botplatform/core';
import type { PlaybackRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { InternalActionResult, QueueSnapshot } from '@botplatform/shared';
import { buildNowPlayingPanel } from '../now-playing.js';
import { GuildPlaybackSession, type SessionLimits } from './session.js';

/**
 * Holds one GuildPlaybackSession per guild. Also the entry point for admin
 * actions arriving over the bot's internal API (no command context there).
 */
export class PlayerManager {
  private readonly sessions = new Map<string, GuildPlaybackSession>();
  /** The last now-playing panel posted per guild (deleted + reposted on change). */
  private readonly lastPanel = new Map<string, SentMessageRef>();
  /** Serializes panel reposts per guild so rapid track changes can't race. */
  private readonly panelChain = new Map<string, Promise<void>>();

  constructor(
    private readonly limits: SessionLimits,
    private readonly playback: PlaybackRepo | null,
    private readonly logger: Logger,
    /** Optional: lets the manager (re)post the now-playing panel to channels. */
    private readonly guildServiceProvider: GuildServiceProvider | null = null
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
      this.logger.child({ guildId: guildExternalId }),
      (channelId, snapshot) => this.announceNowPlaying(guildExternalId, channelId, snapshot)
    );
    this.sessions.set(guildExternalId, session);
    return session;
  }

  /** Build + (re)post the now-playing panel; deletes the previous one first.
   * Reposts are serialized per guild so concurrent track changes can't orphan
   * panels or corrupt `lastPanel`. */
  private announceNowPlaying(
    guildExternalId: string,
    channelId: string,
    snapshot: QueueSnapshot
  ): void {
    const provider = this.guildServiceProvider;
    if (!provider || !provider.isReady()) return;
    const guildService = provider.forGuild(guildExternalId);
    if (!guildService) return;
    const prev = this.panelChain.get(guildExternalId) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.repostPanel(guildService, guildExternalId, channelId, snapshot));
    this.panelChain.set(guildExternalId, next);
  }

  private async repostPanel(
    guildService: GuildService,
    guildExternalId: string,
    channelId: string,
    snapshot: QueueSnapshot
  ): Promise<void> {
    const prev = this.lastPanel.get(guildExternalId);
    this.lastPanel.delete(guildExternalId);
    if (prev) await guildService.deleteMessage(prev.channelId, prev.messageId).catch(() => {});
    try {
      const ref = await guildService.sendMessage(channelId, buildNowPlayingPanel(snapshot));
      // The session may have been torn down (e.g. /leave) while we were posting;
      // if so, don't track a panel for a dead guild — delete what we just sent.
      if (!this.sessions.has(guildExternalId)) {
        await guildService.deleteMessage(ref.channelId, ref.messageId).catch(() => {});
        return;
      }
      this.lastPanel.set(guildExternalId, ref);
    } catch (error) {
      this.logger.warn({ err: error }, 'failed to (re)post the now-playing panel');
    }
  }

  get(guildExternalId: string): GuildPlaybackSession | undefined {
    return this.sessions.get(guildExternalId);
  }

  async destroySession(guildExternalId: string): Promise<boolean> {
    const session = this.sessions.get(guildExternalId);
    if (!session) return false;
    this.sessions.delete(guildExternalId);
    this.panelChain.delete(guildExternalId);
    this.removeLastPanel(guildExternalId);
    await session.destroy();
    return true;
  }

  async destroyAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    this.lastPanel.clear();
    this.panelChain.clear();
    await Promise.all(all.map((session) => session.destroy()));
  }

  /** Best-effort delete of the lingering now-playing panel for a guild. */
  private removeLastPanel(guildExternalId: string): void {
    const prev = this.lastPanel.get(guildExternalId);
    if (!prev) return;
    this.lastPanel.delete(guildExternalId);
    const guildService = this.guildServiceProvider?.forGuild(guildExternalId);
    if (guildService) void guildService.deleteMessage(prev.channelId, prev.messageId).catch(() => {});
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

  pause(guildExternalId: string): InternalActionResult {
    const result = this.sessions.get(guildExternalId)?.pause() ?? 'not-playing';
    return result === 'paused'
      ? { ok: true, message: 'Paused.' }
      : { ok: false, message: result === 'already-paused' ? 'Already paused.' : 'Nothing is playing.' };
  }

  resume(guildExternalId: string): InternalActionResult {
    const result = this.sessions.get(guildExternalId)?.resume() ?? 'not-paused';
    return result === 'resumed'
      ? { ok: true, message: 'Resumed.' }
      : { ok: false, message: 'Nothing is paused.' };
  }
}
