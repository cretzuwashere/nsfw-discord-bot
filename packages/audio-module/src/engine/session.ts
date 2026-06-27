import type { PlaybackEvent, VoiceSession } from '@botplatform/core';
import type { PlaybackRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { QueueSnapshot, TrackSummary } from '@botplatform/shared';
import { UserFacingError } from '@botplatform/shared';
import type { ResolvedTrack } from '../resolver/types.js';
import { PlaybackQueue } from './queue.js';

export interface SessionLimits {
  maxQueueSize: number;
  maxTrackDurationSeconds: number;
}

export type PauseResult = 'paused' | 'already-paused' | 'not-playing';
export type ResumeResult = 'resumed' | 'not-paused';

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Playback state for one guild: a voice session, a bounded queue and
 * now-playing bookkeeping. Persists history + a queue mirror best-effort —
 * a database hiccup must never interrupt audio.
 */
export class GuildPlaybackSession {
  private readonly queue: PlaybackQueue;
  private nowPlaying: ResolvedTrack | null = null;
  private historyId = -1;
  private consecutiveFailures = 0;
  private durationTimer: NodeJS.Timeout | null = null;
  /** Set before an intentional stop so the resulting 'finished' event is ignored. */
  private suppressNextFinish = false;
  /** Elapsed-time tracking for the now-playing panel (pause-aware). */
  private elapsedBeforePauseMs = 0;
  private playingSinceMs: number | null = null;

  /** Whole seconds elapsed in the current track, accounting for pauses. */
  getElapsedSeconds(): number {
    const liveMs = this.playingSinceMs ? Date.now() - this.playingSinceMs : 0;
    const total = Math.floor((this.elapsedBeforePauseMs + liveMs) / 1000);
    const duration = this.nowPlaying?.metadata.durationSeconds;
    return duration ? Math.min(total, duration) : total;
  }

  constructor(
    readonly guildExternalId: string,
    private voiceRef: VoiceSession,
    private readonly limits: SessionLimits,
    private readonly playback: PlaybackRepo | null,
    private readonly logger: Logger
  ) {
    this.queue = new PlaybackQueue(limits.maxQueueSize);
  }

  get voice(): VoiceSession {
    return this.voiceRef;
  }

  /** Swap the underlying voice connection (e.g. after moving channels). */
  attachVoice(voice: VoiceSession): void {
    this.voiceRef = voice;
  }

  get isActive(): boolean {
    return this.nowPlaying !== null;
  }

  async enqueueOrPlay(
    track: ResolvedTrack
  ): Promise<{ status: 'playing' } | { status: 'queued'; position: number }> {
    if (!this.nowPlaying) {
      await this.playNow(track);
      return { status: 'playing' };
    }
    const result = this.queue.enqueue(track);
    if (!result.ok) {
      throw new UserFacingError('QUEUE_FULL', `The queue is full (max ${this.limits.maxQueueSize}).`);
    }
    this.persistQueue();
    return { status: 'queued', position: result.position };
  }

  /**
   * Enqueue a batch (e.g. a playlist). Starts playback with the first track if
   * idle; the rest fill the queue up to its bound. `accepted` is how many of
   * the batch were taken in (played or queued); `rejected` is how many were
   * dropped because the queue was full.
   */
  async enqueueMany(
    tracks: readonly ResolvedTrack[]
  ): Promise<{ startedPlaying: boolean; accepted: number; rejected: number }> {
    const { accepted, rejected } = this.queue.enqueueMany(tracks);
    this.persistQueue();
    let startedPlaying = false;
    if (!this.nowPlaying && this.queue.size > 0) {
      const first = this.queue.dequeue();
      this.persistQueue();
      if (first) {
        try {
          await this.playNow(first);
          startedPlaying = true;
        } catch {
          // playNow recorded the failure; try to keep going with the rest.
          void this.advance();
        }
      }
    }
    return { startedPlaying, accepted, rejected };
  }

  /** Skip the current track; starts the next one when available. */
  async skip(): Promise<{ hadTrack: boolean; next: TrackSummary | null }> {
    if (!this.nowPlaying) return { hadTrack: false, next: null };

    this.finishHistory('skipped');
    this.beginIntentionalStop();
    this.nowPlaying = null;

    const next = this.queue.dequeue();
    this.persistQueue();
    if (!next) return { hadTrack: true, next: null };

    try {
      await this.playNow(next);
      return { hadTrack: true, next: next.metadata };
    } catch {
      // playNow recorded the failure; try to keep going.
      void this.advance();
      return { hadTrack: true, next: next.metadata };
    }
  }

  /** Stop playback and clear the queue; the voice connection stays. */
  stop(): { stoppedTrack: boolean; clearedCount: number } {
    const stoppedTrack = this.nowPlaying !== null;
    if (stoppedTrack) {
      this.finishHistory('stopped');
      this.beginIntentionalStop();
      this.nowPlaying = null;
    }
    const clearedCount = this.queue.clear();
    this.persistQueue();
    this.consecutiveFailures = 0;
    return { stoppedTrack, clearedCount };
  }

  /** Clear upcoming tracks only; the current one keeps playing. */
  clearQueue(): number {
    const cleared = this.queue.clear();
    this.persistQueue();
    return cleared;
  }

  pause(): PauseResult {
    if (!this.nowPlaying) return 'not-playing';
    if (this.voiceRef.status === 'paused') return 'already-paused';
    if (!this.voiceRef.pause()) return 'not-playing';
    // Freeze the elapsed clock at the pause point.
    if (this.playingSinceMs) {
      this.elapsedBeforePauseMs += Date.now() - this.playingSinceMs;
      this.playingSinceMs = null;
    }
    return 'paused';
  }

  resume(): ResumeResult {
    if (this.voiceRef.status !== 'paused') return 'not-paused';
    if (!this.voiceRef.resume()) return 'not-paused';
    this.playingSinceMs = Date.now();
    return 'resumed';
  }

  getSnapshot(): QueueSnapshot {
    return {
      guildId: this.guildExternalId,
      channelName: this.voiceRef.channelName,
      status: this.voiceRef.status,
      nowPlaying: this.nowPlaying?.metadata ?? null,
      queue: this.queue.peekAll().map((item) => item.metadata),
      maxQueueSize: this.limits.maxQueueSize,
      elapsedSeconds: this.nowPlaying ? this.getElapsedSeconds() : undefined,
    };
  }

  /** Stop everything and release the voice connection. */
  async destroy(): Promise<void> {
    this.clearDurationTimer();
    if (this.nowPlaying) {
      this.finishHistory('stopped');
      this.beginIntentionalStop();
      this.nowPlaying = null;
    }
    this.queue.clear();
    this.persistQueue();
    if (!this.voiceRef.destroyed) {
      try {
        this.voiceRef.stop();
        await this.voiceRef.disconnect();
      } catch (error) {
        this.logger.warn({ err: error }, 'voice disconnect failed');
      }
    }
  }

  // -------------------------------------------------------------------------

  private async playNow(track: ResolvedTrack): Promise<void> {
    this.nowPlaying = track;
    this.historyId = -1;
    if (this.playback) {
      try {
        this.historyId = await this.playback.startHistoryEntry({
          guildExternalId: this.guildExternalId,
          track: track.metadata,
        });
      } catch (error) {
        this.logger.warn({ err: error }, 'playback history write failed');
      }
    }

    try {
      await this.voiceRef.play(track.source, (event) => this.handleEvent(event));
      // NOTE: the failure counter only resets when a track FINISHES
      // successfully — merely starting must not defeat the error cutoff.
      this.elapsedBeforePauseMs = 0;
      this.playingSinceMs = Date.now();
      this.armDurationTimer();
    } catch (error) {
      this.finishHistory('failed', safeErrorSummary(error));
      this.nowPlaying = null;
      this.consecutiveFailures++;
      throw error;
    }
  }

  private handleEvent(event: PlaybackEvent): void {
    if (event.type === 'started') return;

    if (this.suppressNextFinish) {
      this.suppressNextFinish = false;
      return;
    }

    this.clearDurationTimer();

    if (event.type === 'finished') {
      this.finishHistory('completed');
      this.consecutiveFailures = 0;
      this.nowPlaying = null;
      void this.advance();
      return;
    }

    // event.type === 'error'
    this.logger.warn({ err: event.error, guildId: this.guildExternalId }, 'playback error');
    this.finishHistory('failed', safeErrorSummary(event.error));
    this.nowPlaying = null;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.logger.error(
        { guildId: this.guildExternalId },
        'too many consecutive playback failures — stopping and clearing the queue'
      );
      this.queue.clear();
      this.persistQueue();
      return;
    }
    void this.advance();
  }

  private async advance(): Promise<void> {
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.queue.clear();
      this.persistQueue();
      return;
    }
    const next = this.queue.dequeue();
    this.persistQueue();
    if (!next) return;
    try {
      await this.playNow(next);
    } catch {
      await this.advance();
    }
  }

  private beginIntentionalStop(): void {
    this.clearDurationTimer();
    if (this.voiceRef.status !== 'idle' && !this.voiceRef.destroyed) {
      this.suppressNextFinish = true;
      this.voiceRef.stop();
    }
  }

  private armDurationTimer(): void {
    this.clearDurationTimer();
    // 0 = unlimited, and live sources (radio) run indefinitely — no watchdog.
    if (this.limits.maxTrackDurationSeconds <= 0 || this.nowPlaying?.isLive) {
      return;
    }
    const ms = this.limits.maxTrackDurationSeconds * 1000;
    this.durationTimer = setTimeout(() => {
      this.logger.info(
        { guildId: this.guildExternalId, maxSeconds: this.limits.maxTrackDurationSeconds },
        'track exceeded the maximum duration — skipping'
      );
      void this.skip();
    }, ms);
    this.durationTimer.unref?.();
  }

  private clearDurationTimer(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
  }

  private finishHistory(
    status: 'completed' | 'skipped' | 'failed' | 'stopped',
    errorMessage?: string
  ): void {
    if (!this.playback || this.historyId < 0) return;
    const id = this.historyId;
    this.historyId = -1;
    void this.playback.finishHistoryEntry(id, status, errorMessage).catch((error) => {
      this.logger.warn({ err: error }, 'playback history update failed');
    });
  }

  private persistQueue(): void {
    if (!this.playback) return;
    const tracks = this.queue.peekAll().map((item) => item.metadata);
    void this.playback.replaceQueue(this.guildExternalId, tracks).catch((error) => {
      this.logger.warn({ err: error }, 'queue mirror write failed');
    });
  }
}

/** Short, user-safe error summary for history rows — never raw stacks. */
function safeErrorSummary(error: unknown): string {
  if (error instanceof UserFacingError) return error.safeMessage;
  return 'Playback failed.';
}
