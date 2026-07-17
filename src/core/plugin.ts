import type { AppEventMap } from '@/types/events';

import type { EventBus } from './eventBus';
import type { Logger } from './logger';
import type { PhotoContext } from './photoContext';
import type { Router } from './router';
import type { SettingsStore } from './settings';

/**
 * The plugin contract.
 *
 * This lives in the **core**, not in `plugins/`, and that is deliberate: it
 * makes the dependency arrow point one way, permanently. Plugins import the
 * core to implement this interface; the core never imports a plugin to learn
 * what it is. Putting this file under `plugins/` would force the core to reach
 * into the plugin folder for a type and quietly invert the whole thing.
 *
 * The only place the two ever meet is `src/entries/content-isolated.ts`, which
 * hands `bootstrap()` a list. ESLint enforces the rest (see `eslint.config.js`).
 */

/** Everything a plugin is given. There is no other way in — no globals, no singletons. */
export interface PluginContext {
  /** The only channel to the rest of the world. Plugins never call each other. */
  readonly bus: EventBus<AppEventMap>;
  /** Pre-namespaced to this plugin's id. */
  readonly log: Logger;
  readonly settings: SettingsStore;
  readonly router: Router;
  /** The photo currently open, for plugins that start after the user does. */
  readonly photos: PhotoContext;
  /** A private container inside the extension's shadow root. Styles cannot leak. */
  readonly ui: PluginUi;
  /**
   * Aborted on teardown.
   *
   * Pass it to every listener, timer and `waitForElement()` you create and
   * cleanup becomes automatic — which is why `teardown()` is optional. Anything
   * you register without it, you own forever.
   */
  readonly signal: AbortSignal;
}

export interface PluginUi {
  /** This plugin's own element inside the shared shadow root. */
  readonly container: HTMLElement;
  /** Adds plugin-specific CSS to the shadow root, scoped to it. */
  addStyles(css: string): void;
}

export interface Plugin {
  /** Stable, kebab-case, unique. Used for settings keys and log namespaces — renaming it resets a user's preference. */
  readonly id: string;
  /** Shown in the popup. */
  readonly name: string;
  readonly description: string;
  /**
   * Whether the plugin runs when a user has never expressed a preference.
   *
   * Anything that changes what Synology Photos looks like should default to
   * `true` (that is why the user installed us); anything noisy or diagnostic
   * should default to `false`.
   */
  readonly enabledByDefault: boolean;
  /** Called once, if enabled. Throwing here disables this plugin and nothing else. */
  setup(context: PluginContext): void | Promise<void>;
  /** Only needed for cleanup that `context.signal` cannot express. */
  teardown?(): void | Promise<void>;
}

/**
 * Identity helper that pins the type at the definition site.
 *
 * Without it, a typo in a field name surfaces as a confusing error at the
 * registry; with it, the error lands on the plugin, where the fix is.
 *
 * @example
 * export default definePlugin({
 *   id: 'google-maps',
 *   name: 'Google Maps',
 *   description: 'Opens the photo location in Google Maps.',
 *   enabledByDefault: true,
 *   setup({ bus, signal }) {
 *     bus.on('photo:changed', ({ gps }) => { ... }, { signal });
 *   },
 * });
 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
