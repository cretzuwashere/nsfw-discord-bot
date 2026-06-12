import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Bundle ONLY workspace code; every npm package stays external and is
  // provided by the runtime image's node_modules (inlining CJS deps into an
  // ESM bundle breaks with "Dynamic require of ... is not supported").
  skipNodeModulesBundle: true,
  noExternal: [/^@botplatform\//],
});
