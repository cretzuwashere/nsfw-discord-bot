import type { AppConfig } from '@botplatform/config';
import type { BotModule } from '@botplatform/core';
import type { PlaybackRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import type { InternalActionResult, QueueSnapshot } from '@botplatform/shared';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildAudioCommands, buildAudioComponentHandler } from './commands.js';
import { PlayerManager } from './engine/manager.js';
import { DirectHttpAudioProvider } from './resolver/providers/direct-http.js';
import { SpotifyAudioProvider } from './resolver/providers/spotify-provider.js';
import { YtDlpAudioProvider } from './resolver/providers/ytdlp-provider.js';
import { AudioResolver } from './resolver/resolver.js';
import type { AudioProvider } from './resolver/types.js';
import { createExecYtDlpRunner } from './resolver/ytdlp-runner.js';

export interface AudioModuleOptions {
  config: AppConfig;
  logger: Logger;
  /** Null disables persistence (history/queue mirror) — test convenience. */
  playback: PlaybackRepo | null;
}

export interface AudioModuleHandle {
  module: BotModule;
  getSnapshots(): QueueSnapshot[];
  skip(guildExternalId: string): Promise<InternalActionResult>;
  stop(guildExternalId: string): Promise<InternalActionResult>;
  clearQueue(guildExternalId: string): Promise<InternalActionResult>;
}

export function createAudioModule(options: AudioModuleOptions): AudioModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.audioPlayer });

  // Provider order matters: platform resolvers (YouTube/SoundCloud/Spotify)
  // claim their hosts first; the direct-HTTP catch-all handles everything
  // else. Streaming providers are added only when enabled.
  const providers: AudioProvider[] = [];
  let ytdlpRunner: ReturnType<typeof createExecYtDlpRunner> | null = null;
  if (options.config.audio.enableStreamingSources) {
    ytdlpRunner = createExecYtDlpRunner(options.config.audio.ytdlpPath, logger, {
      cookiesFile: options.config.audio.ytdlpCookiesFile || undefined,
    });
    const limits = { maxTrackDurationSeconds: options.config.audio.maxTrackDurationSeconds };
    providers.push(
      new YtDlpAudioProvider(ytdlpRunner, limits),
      new SpotifyAudioProvider(ytdlpRunner, limits)
    );
  }
  providers.push(new DirectHttpAudioProvider());
  const resolver = new AudioResolver(providers);
  const manager = new PlayerManager(
    {
      maxQueueSize: options.config.audio.maxQueueSize,
      maxTrackDurationSeconds: options.config.audio.maxTrackDurationSeconds,
    },
    options.playback,
    logger
  );

  const module: BotModule = {
    key: MODULE_KEYS.audioPlayer,
    name: 'Audio Player',
    description: 'Voice channel audio playback with queue management.',
    commands: buildAudioCommands({
      manager,
      resolver,
      resolveCtx: {
        allowedDomains: options.config.audio.allowedDomains,
        timeoutMs: options.config.audio.requestTimeoutMs,
        logger,
      },
    }),
    // The now-playing panel's control buttons route back here.
    events: [{ type: 'component.interaction', handle: buildAudioComponentHandler(manager) }],
    async onLoad(ctx) {
      let streamingReady = false;
      if (ytdlpRunner) {
        streamingReady = await ytdlpRunner.available().catch(() => false);
        if (!streamingReady) {
          ctx.logger.warn(
            'streaming sources are enabled but yt-dlp is not available — YouTube/SoundCloud/Spotify links will fail. Install yt-dlp in the runtime image or set AUDIO_ENABLE_STREAMING_SOURCES=false.'
          );
        }
      }
      ctx.logger.info(
        {
          maxQueueSize: options.config.audio.maxQueueSize,
          maxTrackDurationSeconds: options.config.audio.maxTrackDurationSeconds,
          allowedDomains: options.config.audio.allowedDomains.length || 'any public domain',
          streamingSources: ytdlpRunner ? (streamingReady ? 'ready' : 'unavailable') : 'disabled',
        },
        'audio player ready'
      );
    },
    async onShutdown() {
      await manager.destroyAll();
    },
  };

  return {
    module,
    getSnapshots: () => manager.getSnapshots(),
    skip: (guildExternalId) => manager.skip(guildExternalId),
    stop: (guildExternalId) => manager.stop(guildExternalId),
    clearQueue: (guildExternalId) => manager.clearQueue(guildExternalId),
  };
}

export { PlaybackQueue } from './engine/queue.js';
export { GuildPlaybackSession } from './engine/session.js';
export { PlayerManager } from './engine/manager.js';
export { AudioResolver } from './resolver/resolver.js';
export { DirectHttpAudioProvider } from './resolver/providers/direct-http.js';
export { YtDlpAudioProvider } from './resolver/providers/ytdlp-provider.js';
export { SpotifyAudioProvider } from './resolver/providers/spotify-provider.js';
export { createExecYtDlpRunner } from './resolver/ytdlp-runner.js';
export type { YtDlpRunner } from './resolver/ytdlp-runner.js';
export type { AudioProvider, ResolveContext, ResolvedTrack } from './resolver/types.js';
export {
  buildNowPlayingPanel,
  progressBar,
  audioButtonId,
  parseAudioButton,
  AUDIO_BUTTON_PREFIX,
} from './now-playing.js';
export { buildAudioComponentHandler } from './commands.js';
