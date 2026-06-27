import { PlatformError } from '@botplatform/shared';
import { parseCsvList } from '@botplatform/shared';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  DISCORD_TOKEN: z.string().optional().default(''),
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_GUILD_ID: z.string().optional().default(''),
  DISCORD_ENABLE_MESSAGE_CONTENT: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  DISCORD_ENABLE_GUILD_MEMBERS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  ADMIN_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_ADMIN_URL: z.string().default('http://localhost:3000'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  ADMIN_EMAIL: z.string().optional().default(''),
  ADMIN_PASSWORD: z.string().optional().default(''),

  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  INTERNAL_API_TOKEN: z.string().min(8, 'INTERNAL_API_TOKEN must be at least 8 characters'),
  BOT_INTERNAL_URL: z.string().default('http://bot:8081'),

  ALLOWED_AUDIO_DOMAINS: z.string().optional().default(''),
  MAX_QUEUE_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
  /** Max number of items pulled from a single YouTube playlist. */
  MAX_PLAYLIST_ITEMS: z.coerce.number().int().min(1).max(1000).default(100),
  /** Per-track duration cap in seconds. 0 = unlimited (allow multi-hour tracks). */
  MAX_TRACK_DURATION_SECONDS: z.coerce.number().int().min(0).default(3600),
  AUDIO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(15000),
  AUDIO_ENABLE_STREAMING_SOURCES: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  YTDLP_PATH: z.string().optional().default('yt-dlp'),
  /**
   * Path to a Netscape-format cookies.txt mounted into the bot container.
   * Required to play PRIVATE / age-restricted YouTube videos (unlisted
   * videos play without it). Empty = no cookies.
   */
  YTDLP_COOKIES_FILE: z.string().optional().default(''),

  /** Directory for uploaded card assets (a persistent Docker volume). */
  UPLOADS_DIR: z.string().optional().default('/workspace/uploads'),

  BUILD_VERSION: z.string().optional().default('0.1.0'),
});

export type LogLevel = (typeof LOG_LEVELS)[number];
export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  version: string;
  database: {
    url: string;
  };
  discord: {
    /** True only when both token and client id are present. */
    enabled: boolean;
    token: string;
    clientId: string;
    guildId: string;
    /** Privileged MessageContent intent — required by content-based automod. */
    enableMessageContent: boolean;
    /** Privileged GuildMembers intent — required by member-based modules
     * (welcome/leave, birthdays-on-join). Off = bot connects with no
     * privileged intents (audio-only path needs nothing toggled). */
    enableGuildMembers: boolean;
  };
  admin: {
    port: number;
    publicUrl: string;
    sessionSecret: string;
    cookieSecure: boolean;
    bootstrapEmail: string;
    bootstrapPassword: string;
  };
  bot: {
    healthPort: number;
    internalApiToken: string;
    internalUrl: string;
  };
  audio: {
    /** Lowercased domain allowlist; empty array = any public domain allowed. */
    allowedDomains: string[];
    maxQueueSize: number;
    /** Max items pulled from a single YouTube playlist. */
    maxPlaylistItems: number;
    /** Per-track duration cap in seconds; 0 = unlimited. */
    maxTrackDurationSeconds: number;
    requestTimeoutMs: number;
    /** YouTube/SoundCloud/Spotify providers (yt-dlp based). */
    enableStreamingSources: boolean;
    ytdlpPath: string;
    /** Cookies file for private/age-restricted YouTube videos ('' = none). */
    ytdlpCookiesFile: string;
  };
  /** Filesystem paths (persistent volumes). */
  storage: {
    uploadsDir: string;
  };
}

/**
 * Parse and validate configuration from environment variables.
 * Throws PlatformError(CONFIG_INVALID) with a readable list of problems.
 * Never include secret VALUES in error messages — only variable names.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new PlatformError('CONFIG_INVALID', `Invalid configuration — ${problems}`);
  }
  const e = parsed.data;

  return {
    nodeEnv: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    version: e.BUILD_VERSION,
    database: { url: e.DATABASE_URL },
    discord: {
      enabled: e.DISCORD_TOKEN.length > 0 && e.DISCORD_CLIENT_ID.length > 0,
      token: e.DISCORD_TOKEN,
      clientId: e.DISCORD_CLIENT_ID,
      guildId: e.DISCORD_GUILD_ID,
      enableMessageContent: e.DISCORD_ENABLE_MESSAGE_CONTENT,
      enableGuildMembers: e.DISCORD_ENABLE_GUILD_MEMBERS,
    },
    admin: {
      port: e.ADMIN_PORT,
      publicUrl: e.PUBLIC_ADMIN_URL,
      sessionSecret: e.SESSION_SECRET,
      cookieSecure: e.COOKIE_SECURE,
      bootstrapEmail: e.ADMIN_EMAIL,
      bootstrapPassword: e.ADMIN_PASSWORD,
    },
    bot: {
      healthPort: e.HEALTH_PORT,
      internalApiToken: e.INTERNAL_API_TOKEN,
      internalUrl: e.BOT_INTERNAL_URL,
    },
    audio: {
      allowedDomains: parseCsvList(e.ALLOWED_AUDIO_DOMAINS),
      maxQueueSize: e.MAX_QUEUE_SIZE,
      maxPlaylistItems: e.MAX_PLAYLIST_ITEMS,
      maxTrackDurationSeconds: e.MAX_TRACK_DURATION_SECONDS,
      requestTimeoutMs: e.AUDIO_REQUEST_TIMEOUT_MS,
      enableStreamingSources: e.AUDIO_ENABLE_STREAMING_SOURCES,
      ytdlpPath: e.YTDLP_PATH,
      ytdlpCookiesFile: e.YTDLP_COOKIES_FILE,
    },
    storage: {
      uploadsDir: e.UPLOADS_DIR,
    },
  };
}

/** Minimal valid env for tests; override fields as needed. */
export function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://botplatform:test@localhost:5432/botplatform_test',
    SESSION_SECRET: 'test-session-secret-test-session-secret',
    INTERNAL_API_TOKEN: 'test-internal-token',
    ...overrides,
  };
}
