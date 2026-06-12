import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Workspace packages are bundled; npm dependencies stay external and are
  // installed in the runtime image.
  noExternal: [/^@botplatform\//],
});
