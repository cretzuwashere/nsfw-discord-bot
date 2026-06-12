import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/register-commands.ts', 'src/migrate.ts', 'src/seed.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle ONLY workspace code. Every npm package (pg, discord.js, fastify,
  // the native @discordjs/opus, …) stays external and is provided by the
  // runtime image's node_modules — inlining CJS deps into an ESM bundle
  // breaks with "Dynamic require of ... is not supported".
  skipNodeModulesBundle: true,
  noExternal: [/^@botplatform\//],
});
