import { execFile, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { Logger } from '@botplatform/logger';
import { UserFacingError } from '@botplatform/shared';

/**
 * Thin, injectable wrapper around the yt-dlp binary so providers are fully
 * unit-testable without spawning processes.
 *
 * yt-dlp is the actively-maintained standard for self-hosted bots: JS
 * extractor libraries (ytdl-core, play-dl) break whenever YouTube rotates
 * its player code. The binary ships in the Docker images — nothing is
 * installed on the host.
 */
/** A single flat-playlist entry (no per-item extraction was performed). */
export interface FlatPlaylistEntry {
  id?: string;
  title?: string;
  /** Often a full URL, but some extractors emit a bare video id here. */
  url?: string;
  webpage_url?: string;
  duration?: number;
  ie_key?: string;
  availability?: string;
  live_status?: string;
}

export interface FlatPlaylist {
  title?: string;
  entries: FlatPlaylistEntry[];
}

export interface YtDlpRunner {
  /** Run yt-dlp with `-J` style args and parse the JSON output. */
  json(args: string[], timeoutMs: number): Promise<unknown>;
  /**
   * Flat-list a playlist's entries WITHOUT fetching each item's full metadata
   * (cheap, scales to large playlists). Overrides the global `--no-playlist`.
   */
  flatPlaylist(url: string, timeoutMs: number): Promise<FlatPlaylist>;
  /** Spawn yt-dlp streaming media to stdout; killing the stream kills the process. */
  stream(args: string[]): Readable;
  /** One-shot availability probe (binary present and runnable). */
  available(): Promise<boolean>;
}

const MAX_JSON_BYTES = 20 * 1024 * 1024; // playlists can be large; cap hard

/** Flags applied to every invocation: quiet, no playlists, no surprises. */
const COMMON_ARGS = ['--no-playlist', '--no-warnings', '--no-progress', '--no-cache-dir'];

/**
 * Extra resilience for the streaming path only (not metadata). Long, multi-hour
 * downloads must survive transient network hiccups; retries are FINITE so a
 * genuinely dead source still terminates instead of hanging forever.
 */
const STREAM_ROBUSTNESS_ARGS = [
  '--retries',
  '10',
  '--fragment-retries',
  '10',
  '--retry-sleep',
  '3',
];

export interface YtDlpRunnerOptions {
  /**
   * Path to a Netscape cookies.txt. When set, `--cookies <file>` is added to
   * every invocation so PRIVATE / age-restricted YouTube videos resolve and
   * play. Unlisted videos work without it.
   */
  cookiesFile?: string | undefined;
}

export function createExecYtDlpRunner(
  binaryPath: string,
  logger: Logger,
  options: YtDlpRunnerOptions = {}
): YtDlpRunner {
  const baseArgs = options.cookiesFile
    ? [...COMMON_ARGS, '--cookies', options.cookiesFile]
    : COMMON_ARGS;

  return {
    json(args: string[], timeoutMs: number): Promise<unknown> {
      return new Promise((resolve, reject) => {
        execFile(
          binaryPath,
          [...baseArgs, ...args],
          { timeout: timeoutMs, maxBuffer: MAX_JSON_BYTES, windowsHide: true },
          (error, stdout, stderr) => {
            if (error) {
              logger.warn(
                { err: error, stderr: truncate(stderr, 400) },
                'yt-dlp metadata extraction failed'
              );
              reject(
                new UserFacingError('AUDIO_RESOLVE_FAILED', 'That link could not be resolved.', {
                  cause: error,
                })
              );
              return;
            }
            try {
              resolve(JSON.parse(stdout));
            } catch (parseError) {
              reject(
                new UserFacingError('AUDIO_RESOLVE_FAILED', 'That link could not be resolved.', {
                  cause: parseError,
                })
              );
            }
          }
        );
      });
    },

    flatPlaylist(url: string, timeoutMs: number): Promise<FlatPlaylist> {
      return new Promise((resolve, reject) => {
        execFile(
          binaryPath,
          // `--yes-playlist` overrides the `--no-playlist` in baseArgs (last
          // flag wins); `--flat-playlist` avoids per-item extraction.
          [...baseArgs, '--yes-playlist', '--flat-playlist', '-J', '--', url],
          { timeout: timeoutMs, maxBuffer: MAX_JSON_BYTES, windowsHide: true },
          (error, stdout, stderr) => {
            if (error) {
              logger.warn(
                { err: error, stderr: truncate(stderr, 400) },
                'yt-dlp playlist extraction failed'
              );
              reject(
                new UserFacingError('AUDIO_RESOLVE_FAILED', 'That playlist could not be resolved.', {
                  cause: error,
                })
              );
              return;
            }
            try {
              const parsed = JSON.parse(stdout) as Partial<FlatPlaylist>;
              resolve({ title: parsed.title, entries: parsed.entries ?? [] });
            } catch (parseError) {
              reject(
                new UserFacingError('AUDIO_RESOLVE_FAILED', 'That playlist could not be resolved.', {
                  cause: parseError,
                })
              );
            }
          }
        );
      });
    },

    stream(args: string[]): Readable {
      const child = spawn(binaryPath, [...baseArgs, ...STREAM_ROBUSTNESS_ARGS, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderrTail = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-400);
      });
      child.on('error', (error) => {
        logger.warn({ err: error }, 'yt-dlp spawn failed');
        child.stdout.destroy(
          new UserFacingError('AUDIO_PLAYBACK_FAILED', 'That audio could not be played.', {
            cause: error,
          })
        );
      });
      child.on('close', (code) => {
        if (code !== 0 && code !== null) {
          logger.warn({ code, stderr: stderrTail }, 'yt-dlp exited with an error');
        }
      });

      // When the consumer is done (track finished, skipped, stopped), make
      // sure the downloader dies with it.
      child.stdout.once('close', () => {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
      });

      return child.stdout;
    },

    available(): Promise<boolean> {
      return new Promise((resolve) => {
        execFile(binaryPath, ['--version'], { timeout: 10_000, windowsHide: true }, (error) => {
          resolve(!error);
        });
      });
    },
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
