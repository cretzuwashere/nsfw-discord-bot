import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/register-commands.ts', 'src/migrate.ts', 'src/seed.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Workspace packages are bundled into dist; npm dependencies (including
  // the native @discordjs/opus) stay external and live in the runtime image.
  noExternal: [/^@botplatform\//],
});
