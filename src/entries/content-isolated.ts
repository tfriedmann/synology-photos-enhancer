import { bootstrap } from '@/core/bootstrap';
import { plugins } from '@/plugins';
import css from '@/styles/main.css?inline';

/**
 * ISOLATED world entry — the composition root of the page-side extension.
 *
 * This is the **only** file in the codebase where the core and the plugins
 * meet. `bootstrap()` receives the plugin list as an argument, so `core/` never
 * imports `plugins/` and the dependency arrow stays one-way (ESLint enforces
 * it; see `eslint.config.js`).
 *
 * `?inline` gives us the stylesheet as a string so it can be adopted into the
 * shadow root. Letting Vite inject a `<link>` would put our CSS in Synology's
 * cascade — the exact thing the shadow root exists to prevent.
 */

void bootstrap({ plugins, css }).catch((error: unknown) => {
  /* The last resort. If bootstrap itself failed there is no logger to report
   * with, and staying silent would leave a user with an extension that does
   * nothing and says nothing. */
  // eslint-disable-next-line no-console
  console.error('[spe] Failed to start.', error);
});
