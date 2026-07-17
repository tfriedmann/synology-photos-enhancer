import { fileURLToPath } from 'node:url';

import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';

import manifest from './manifest.config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [crx({ manifest })],
  build: {
    /* Chrome 116 is our floor (see `minimum_chrome_version`), so there is no
     * reason to down-level past it. */
    target: 'chrome116',
    sourcemap: true,
    emptyOutDir: true,
  },
  server: {
    /* CRXJS needs a stable HMR port: the extension pages are loaded from a
     * chrome-extension:// origin and cannot use Vite's default port discovery. */
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
