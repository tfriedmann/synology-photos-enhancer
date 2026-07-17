import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json' with { type: 'json' };

/**
 * MV3 manifest, derived from `package.json` so the version is never duplicated.
 *
 * Two deliberate absences, both load-bearing:
 *
 * 1. **No `content_scripts`.** Synology NAS hostnames are arbitrary — a custom
 *    port, a bare LAN hostname, a DDNS name, QuickConnect with a rotating
 *    regional prefix, or a reverse proxy on a personal domain. No static match
 *    pattern can cover that, so scripts are registered at runtime by the
 *    service worker once the user grants their own origin. See
 *    `docs/ARCHITECTURE.md`.
 *
 * 2. **No `host_permissions`.** Everything is optional, so a fresh install asks
 *    for nothing at all.
 */
export default defineManifest((env) => ({
  manifest_version: 3,
  name: env.mode === 'development' ? '[dev] Synology Photos Enhancer' : 'Synology Photos Enhancer',
  description: 'Adds extra features to the Synology Photos web app. No NAS-side changes.',
  version: pkg.version,
  minimum_chrome_version: '116',

  /* `scripting` powers runtime content-script registration; `storage` persists
   * settings.
   *
   * `activeTab` resolves a chicken-and-egg problem: with no host permission,
   * Chrome hides `tab.url` from us entirely — but the popup needs that URL to
   * know which origin to *ask* for. `activeTab` grants temporary access to the
   * current tab at the moment the user invokes the extension (clicking the
   * icon), which is exactly when the popup needs it.
   *
   * Crucially it costs nothing: `activeTab` shows **no install-time warning**,
   * so a fresh install still asks for nothing. The lazy alternative, `"tabs"`,
   * would grant every tab's URL forever and display "Read your browsing
   * history" — for a NAS extension, an absurd trade. */
  permissions: ['scripting', 'storage', 'activeTab'],

  /* Broad *optional* pattern, never requested up front. The user grants exactly
   * one origin — their NAS — from the popup, via a user gesture. */
  optional_host_permissions: ['*://*/*'],

  action: {
    default_popup: 'src/entries/popup/index.html',
    default_title: 'Synology Photos Enhancer',
  },

  background: {
    service_worker: 'src/entries/background.ts',
    type: 'module',
  },

  /* Under `src/`, not `public/`: Vite copies `public/` to the dist root as-is
   * while CRXJS also resolves these paths as build assets, so icons kept there
   * are emitted twice under two different paths. Regenerate with
   * `node scripts/generate-icons.mjs`. */
  icons: {
    16: 'src/assets/icons/icon-16.png',
    32: 'src/assets/icons/icon-32.png',
    48: 'src/assets/icons/icon-48.png',
    128: 'src/assets/icons/icon-128.png',
  },
}));
