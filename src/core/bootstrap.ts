import { installIsolatedReceiver } from '@/bridge/isolatedReceiver';
import type { AppEventMap } from '@/types/events';
import { createShadowHost, type ShadowHost } from '@/ui/shadowHost';

import { createEventBus, type EventBus } from './eventBus';
import { createLogger, type Logger } from './logger';
import { createDomObserver } from './observer';
import { createPhotoContext } from './photoContext';
import type { Plugin, PluginContext } from './plugin';
import { createPluginRegistry, type PluginRegistry } from './pluginRegistry';
import { createRouter, type Router } from './router';
import {
  createSettingsStore,
  loadSettings,
  watchChromeSettings,
  type SettingsStore,
} from './settings';

/**
 * Wires the core together and starts the plugins.
 *
 * This is the composition root: the one place that knows how the pieces fit.
 * Everything it builds is passed by parameter, never imported by the consumer —
 * which is what keeps `eventBus`, `router` and the rest independently testable.
 *
 * Note what it does *not* import: any plugin. The list arrives as an argument
 * from `entries/content-isolated.ts`, so the core compiles and ships with no
 * knowledge that `plugins/` exists. ESLint enforces it; this signature is what
 * makes it possible.
 */

export interface BootstrapOptions {
  /** Injected by the entry point. The core never reaches for these itself. */
  readonly plugins: readonly Plugin[];
  readonly css: string;
}

export interface App {
  readonly bus: EventBus<AppEventMap>;
  readonly logger: Logger;
  readonly router: Router;
  readonly settings: SettingsStore;
  readonly host: ShadowHost;
  readonly registry: PluginRegistry;
  /** Tears down every plugin and removes all traces from the page. */
  dispose(): Promise<void>;
}

export async function bootstrap(options: BootstrapOptions): Promise<App> {
  /* Settings first: the log level comes from them, and we want it applied
   * before anything has a chance to log. */
  const settings = createSettingsStore({
    area: chrome.storage.sync,
    initial: await loadSettings(chrome.storage.sync),
    watch: watchChromeSettings,
  });

  const logger = createLogger('spe', settings.get().logLevel);
  settings.subscribe((next) => {
    logger.setLevel(next.logLevel);
  });

  const bus = createEventBus<AppEventMap>({
    onListenerError: (error, event) => {
      /* Contained here rather than at each call site: a plugin listener that
       * throws is a bug in that plugin, not a reason for the emitter to care. */
      logger.error(`A listener for "${event}" threw.`, error);
    },
  });

  const host = createShadowHost({ css: options.css });

  // ------------------------------------------------------------- signals
  const router = createRouter({
    onChange: (route, previous) => {
      logger.debug('route:changed', route.raw);
      bus.emit('route:changed', { route, previous });
    },
  });

  /* pushState/replaceState fire no event, so the MAIN world tells us and the
   * router re-reads location. Without this, SPA navigation is invisible. */
  installIsolatedReceiver({
    bus,
    onHistoryChanged: () => {
      router.refresh();
    },
  });

  const observer = createDomObserver();
  observer.subscribe((mutations) => {
    bus.emit('dom:mutation', { mutations });
  });

  const photos = createPhotoContext({ bus, logger: logger.child('photos') });

  // ------------------------------------------------------------- plugins
  const registry = createPluginRegistry({
    plugins: options.plugins,
    logger: logger.child('plugins'),
    isEnabled: (plugin) => settings.isPluginEnabled(plugin.id, plugin.enabledByDefault),
    /* No `signal` here: the registry owns each plugin's AbortController, since
     * it is what teardown aborts. */
    createContext: (plugin): Omit<PluginContext, 'signal'> => ({
      bus,
      log: logger.child(plugin.id),
      settings,
      router,
      photos,
      ui: {
        container: host.container(plugin.id),
        addStyles: (css) => {
          host.addStyles(css);
        },
      },
    }),
  });

  await registry.setupAll();

  logger.info(
    `Ready — ${String(registry.active.length)}/${String(options.plugins.length)} plugin(s) active.`,
  );

  return {
    bus,
    logger,
    router,
    settings,
    host,
    registry,
    async dispose() {
      await registry.teardownAll();
      observer.disconnect();
      bus.clear();
      host.dispose();
    },
  };
}
