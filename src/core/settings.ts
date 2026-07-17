import { isLogLevel, type LogLevel } from './logger';

/**
 * Persistent user settings, backed by `chrome.storage.sync`.
 *
 * `sync` rather than `local` so preferences follow the user across machines —
 * the payload is a handful of booleans, nowhere near the quota, and someone who
 * uses their NAS from two computers should not configure it twice.
 *
 * Reads never fail: a corrupt or partial stored object falls back to defaults
 * field by field. Settings are not important enough to break startup over.
 */

export interface Settings {
  readonly logLevel: LogLevel;
  /** Keyed by plugin id. Absent means "use the plugin's `enabledByDefault`". */
  readonly plugins: Readonly<Record<string, boolean>>;
  /**
   * Per-plugin options, keyed by plugin id, and **opaque to the core** —
   * deliberately `unknown` rather than a union of every plugin's shape.
   *
   * The core storing `mapProvider: string` would mean the core knows a plugin
   * exists, which is the one thing it must never do. Each plugin parses its own
   * slice with its own guard, exactly as it would parse anything else it did
   * not author.
   */
  readonly options: Readonly<Record<string, unknown>>;
}

/** `warn` keeps the console usable for the site's own debugging. */
export const DEFAULT_SETTINGS: Settings = {
  logLevel: 'warn',
  plugins: {},
  options: {},
};

const STORAGE_KEY = 'settings';

/** The `chrome.storage.sync` surface we use. Narrowed so tests can fake it. */
export interface SettingsStorageArea {
  get(keys: string | readonly string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface SettingsStore {
  get(): Settings;
  /** Shallow-merges and persists. */
  patch(partial: Partial<Settings>): Promise<void>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  /** Falls back to `fallback` when the user has expressed no preference. */
  isPluginEnabled(id: string, fallback: boolean): boolean;
  /** This plugin's stored options, unparsed. Narrow them yourself. */
  getPluginOptions(id: string): unknown;
  setPluginOptions(id: string, options: unknown): Promise<void>;
  /** Fires on external changes too, e.g. the popup writing while a tab is open. */
  subscribe(listener: (settings: Settings) => void): () => void;
}

/** Field-by-field, so one bad value cannot discard the rest. */
export function parseSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;

  const record = value as Record<string, unknown>;
  const logLevel = isLogLevel(record['logLevel']) ? record['logLevel'] : DEFAULT_SETTINGS.logLevel;

  const plugins: Record<string, boolean> = {};
  const storedPlugins = record['plugins'];
  if (typeof storedPlugins === 'object' && storedPlugins !== null) {
    for (const [id, enabled] of Object.entries(storedPlugins)) {
      if (typeof enabled === 'boolean') plugins[id] = enabled;
    }
  }

  /* Passed through untouched: the core cannot validate what it does not
   * understand, and each plugin guards its own slice. */
  const storedOptions = record['options'];
  const options: Record<string, unknown> =
    typeof storedOptions === 'object' && storedOptions !== null
      ? { ...(storedOptions as Record<string, unknown>) }
      : {};

  return { logLevel, plugins, options };
}

export async function loadSettings(area: SettingsStorageArea): Promise<Settings> {
  try {
    const stored = await area.get(STORAGE_KEY);
    return parseSettings(stored[STORAGE_KEY]);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface SettingsStoreOptions {
  readonly area: SettingsStorageArea;
  readonly initial: Settings;
  /**
   * Subscribes to external writes. Injected rather than reaching for
   * `chrome.storage.onChanged` directly, which keeps this module testable in
   * plain Node.
   */
  readonly watch?: ((listener: (settings: Settings) => void) => () => void) | undefined;
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  let current = options.initial;
  const listeners = new Set<(settings: Settings) => void>();

  const publish = (next: Settings): void => {
    current = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        /* One bad subscriber must not stop the others from updating. */
      }
    }
  };

  options.watch?.((next) => {
    publish(next);
  });

  const persist = async (next: Settings): Promise<void> => {
    publish(next);
    await options.area.set({ [STORAGE_KEY]: next });
  };

  return {
    get: () => current,

    patch: (partial) => persist({ ...current, ...partial }),

    setPluginEnabled: (id, enabled) =>
      persist({ ...current, plugins: { ...current.plugins, [id]: enabled } }),

    isPluginEnabled: (id, fallback) => current.plugins[id] ?? fallback,

    getPluginOptions: (id) => current.options[id],

    setPluginOptions: (id, options) =>
      persist({ ...current, options: { ...current.options, [id]: options } }),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Bridges `chrome.storage.sync.onChanged` into `createSettingsStore`'s `watch`. */
export function watchChromeSettings(listener: (settings: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName !== 'sync') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    listener(parseSettings(change.newValue));
  };

  chrome.storage.onChanged.addListener(handler);
  return () => {
    chrome.storage.onChanged.removeListener(handler);
  };
}
