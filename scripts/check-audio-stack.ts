/* eslint-disable no-console */
// Verifies the voice/audio runtime inside the Linux container:
// opus encoder, encryption mode, and ffmpeg availability.
// Run: docker compose exec app pnpm exec tsx scripts/check-audio-stack.ts
import { generateDependencyReport } from '@discordjs/voice';

console.log(generateDependencyReport());

const report = generateDependencyReport();
const problems: string[] = [];
if (!/@discordjs\/opus/.test(report) || /@discordjs\/opus: not found/.test(report)) {
  problems.push('@discordjs/opus not loadable');
}
if (/FFmpeg[\s\S]*?not found/i.test(report)) {
  problems.push('ffmpeg not found');
}
if (problems.length > 0) {
  console.error('AUDIO STACK PROBLEMS:', problems.join('; '));
  process.exit(1);
}
console.log('audio stack OK');
