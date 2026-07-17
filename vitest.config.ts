import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Deliberately separate from `vite.config.ts`: the CRXJS plugin rewrites the
 * manifest and emits extension bundles, which has no business running during a
 * unit-test pass. Keeping the configs apart also means tests never depend on
 * extension build state.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      /* Entry points are thin wiring over tested units and can only be
       * exercised in a real browser; excluding them keeps the coverage signal
       * honest instead of padding it. */
      exclude: ['src/entries/**', 'src/types/**'],
    },
  },
});
