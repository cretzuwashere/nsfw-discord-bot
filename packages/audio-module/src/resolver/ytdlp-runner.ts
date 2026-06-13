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
export interface YtDlpRunner {
  /** Run yt-dlp with `-J` style args and parse the JSON output. */
  json(args: string[], timeoutMs: number): Promise<unknown>;
  /** Spawn yt-dlp streaming media to stdout; killing the stream kills the process. */
  stream(args: string[]): Readable;
  /** One-shot availability probe (binary present and runnable). */
  available(): Promise<boolean>;
}

const MAX_JSON_BYTES = 20 * 1024 * 1024; // playlists can be large; cap hard

/** Flags applied to every invocation: quiet, no playlists, no surprises. */
const COMMON_ARGS = ['--no-playlist', '--no-warnings', '--no-progress', '--no-cache-dir'];

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

    stream(args: string[]): Readable {
      const child = spawn(binaryPath, [...baseArgs, ...args], {
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
