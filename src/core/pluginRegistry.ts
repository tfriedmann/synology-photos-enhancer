import type { Logger } from './logger';
import type { Plugin, PluginContext } from './plugin';

/**
 * Owns the plugin lifecycle: decide, set up, tear down.
 *
 * The single rule that shapes this file: **a broken plugin breaks only
 * itself.** We run inside an application the user actually needs. A plugin that
 * throws on setup, or hangs, or blows up on teardown, must never take down the
 * core, the page, or its neighbours. Every call into plugin code is therefore
 * individually contained, and setups run concurrently so one slow plugin does
 * not delay the rest.
 */

export interface PluginRegistryOptions {
  readonly plugins: readonly Plugin[];
  /**
   * Builds the per-plugin context, minus the signal.
   *
   * `signal` is excluded because the registry owns the `AbortController` — it
   * is what teardown aborts. Letting the caller supply one would mean it could
   * hand over a signal it also controls, and the lifecycle would have two
   * owners. The `Omit` makes that structural rather than a rule in a comment.
   */
  readonly createContext: (plugin: Plugin) => Omit<PluginContext, 'signal'>;
  /** Consulted per plugin; `enabledByDefault` is the fallback. */
  readonly isEnabled: (plugin: Plugin) => boolean;
  readonly logger: Logger;
}

export interface ActivePlugin {
  readonly plugin: Plugin;
  readonly controller: AbortController;
}

export interface PluginRegistry {
  setupAll(): Promise<void>;
  teardownAll(): Promise<void>;
  readonly active: readonly ActivePlugin[];
}

export function createPluginRegistry(options: PluginRegistryOptions): PluginRegistry {
  const { logger } = options;
  const active = new Map<string, ActivePlugin>();

  /* Duplicate ids would silently share a settings key and a log namespace,
   * and the second teardown would orphan the first plugin's listeners. */
  const seen = new Set<string>();
  const plugins = options.plugins.filter((plugin) => {
    if (seen.has(plugin.id)) {
      logger.error(`Duplicate plugin id "${plugin.id}" — ignoring the second one.`);
      return false;
    }
    seen.add(plugin.id);
    return true;
  });

  async function setupOne(plugin: Plugin): Promise<void> {
    if (active.has(plugin.id)) return;

    if (!options.isEnabled(plugin)) {
      logger.debug(`Plugin "${plugin.id}" is disabled — skipping.`);
      return;
    }

    const controller = new AbortController();
    const context = { ...options.createContext(plugin), signal: controller.signal };

    try {
      await plugin.setup(context);
      active.set(plugin.id, { plugin, controller });
      logger.debug(`Plugin "${plugin.id}" ready.`);
    } catch (error) {
      /* Abort so anything the plugin managed to register before failing is
       * retired; a half-initialised plugin is worse than an absent one. */
      controller.abort();
      logger.error(`Plugin "${plugin.id}" failed to set up and was disabled.`, error);
    }
  }

  async function teardownOne(entry: ActivePlugin): Promise<void> {
    const { plugin, controller } = entry;

    /* Abort first: even if teardown() throws below, every listener, timer and
     * pending waitForElement() tied to the signal is already gone. */
    controller.abort();

    try {
      await plugin.teardown?.();
    } catch (error) {
      logger.error(`Plugin "${plugin.id}" threw during teardown.`, error);
    } finally {
      active.delete(plugin.id);
    }
  }

  return {
    async setupAll() {
      /* Concurrent, and `setupOne` never rejects, so one plugin awaiting a DOM
       * node cannot hold up the others. */
      await Promise.all(plugins.map((plugin) => setupOne(plugin)));
    },

    async teardownAll() {
      await Promise.all([...active.values()].map((entry) => teardownOne(entry)));
    },

    get active() {
      return [...active.values()];
    },
  };
}
