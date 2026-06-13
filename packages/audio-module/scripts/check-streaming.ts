// End-to-end validation of the streaming providers against the REAL internet,
// using the actual provider + runner code. Run inside the container:
//   docker compose exec app bash -lc "cd packages/audio-module && pnpm exec tsx scripts/check-streaming.ts"
import { spawn } from 'node:child_process';
import { createLogger } from '@botplatform/logger';
import { createExecYtDlpRunner } from '../src/resolver/ytdlp-runner.js';
import { YtDlpAudioProvider } from '../src/resolver/providers/ytdlp-provider.js';
import { SpotifyAudioProvider } from '../src/resolver/providers/spotify-provider.js';

const logger = createLogger({ name: 'check-streaming', level: 'warn', pretty: true });
const runner = createExecYtDlpRunner('yt-dlp', logger);
const ctx = { allowedDomains: [] as string[], timeoutMs: 60_000, logger };
const limits = { maxTrackDurationSeconds: 3600 };

async function pipeFirstBytes(stream: NodeJS.ReadableStream, label: string): Promise<number> {
  // Transcode the yt-dlp output through ffmpeg to opus, exactly like the bot's
  // voice layer does, and count the produced bytes — proves the whole chain.
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 'opus', '-t', '3', 'pipe:1'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let bytes = 0;
    ff.stdout.on('data', (c: Buffer) => (bytes += c.length));
    ff.on('error', reject);
    ff.on('close', () => resolve(bytes));
    stream.on('error', reject);
    stream.pipe(ff.stdin).on('error', () => {
      /* ffmpeg may close stdin early after -t 3; ignore EPIPE */
    });
    void label;
  });
}

async function main() {
  let ok = true;

  console.log('available:', await runner.available());

  // 1. YouTube
  try {
    const yt = new YtDlpAudioProvider(runner, limits);
    const track = await yt.resolve('https://www.youtube.com/watch?v=dQw4w9WgXcQ', ctx);
    console.log('YouTube ->', track.metadata.title, `(${track.metadata.durationSeconds}s)`, track.metadata.provider);
    const stream = await track.source.createStream();
    const bytes = await pipeFirstBytes(stream, 'yt');
    console.log('  transcoded opus bytes:', bytes);
    if (bytes <= 0) { ok = false; console.error('  FAIL: no audio produced'); }
  } catch (e) {
    ok = false;
    console.error('YouTube FAIL:', e instanceof Error ? e.message : e);
  }

  // 2. SoundCloud (best-effort — depends on the track being public)
  try {
    const sc = new YtDlpAudioProvider(runner, limits);
    const track = await sc.resolve('https://soundcloud.com/octobersveryown/drake-hotline-bling', ctx);
    console.log('SoundCloud ->', track.metadata.title, track.metadata.provider);
  } catch (e) {
    console.warn('SoundCloud (non-fatal):', e instanceof Error ? e.message : e);
  }

  // 3. Spotify (oEmbed title -> YouTube search)
  try {
    const sp = new SpotifyAudioProvider(runner, limits);
    const track = await sp.resolve('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', ctx);
    console.log('Spotify ->', track.metadata.title, `(${track.metadata.durationSeconds}s)`, track.metadata.provider);
    const stream = await track.source.createStream();
    const bytes = await pipeFirstBytes(stream, 'sp');
    console.log('  transcoded opus bytes:', bytes);
    if (bytes <= 0) { ok = false; console.error('  FAIL: no audio produced'); }
  } catch (e) {
    ok = false;
    console.error('Spotify FAIL:', e instanceof Error ? e.message : e);
  }

  console.log(ok ? '\nSTREAMING SOURCES OK' : '\nSTREAMING SOURCES HAD FAILURES');
  process.exit(ok ? 0 : 1);
}

void main();
