import { pino, type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  name: string;
  level?: string | undefined;
  /** Pretty-print for local development; JSON lines otherwise. */
  pretty?: boolean | undefined;
}

/**
 * Secret-bearing fields are redacted at any nesting depth.
 * Never log raw config objects or HTTP headers outside these guards.
 */
const REDACT_PATHS = [
  '*.token',
  '*.password',
  '*.secret',
  '*.sessionSecret',
  '*.internalApiToken',
  'token',
  'password',
  'secret',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

export function createLogger(options: LoggerOptions): Logger {
  return pino({
    name: options.name,
    level: options.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

/** A logger that discards everything — for tests. */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
