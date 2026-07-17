import { describe, expect, it, vi } from 'vitest';

import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  type SettingsStorageArea,
} from '@/core/settings';

function fakeArea(initial: Record<string, unknown> = {}): SettingsStorageArea & {
  written: Record<string, unknown>[];
} {
  const store = { ...initial };
  const written: Record<string, unknown>[] = [];

  return {
    written,
    get: (key) => {
      const name = typeof key === 'string' ? key : String(key);
      return Promise.resolve({ [name]: store[name] });
    },
    set: (items) => {
      written.push(items);
      Object.assign(store, items);
      return Promise.resolve();
    },
  };
}

describe('parseSettings', () => {
  it('returns defaults for anything unusable', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a valid object', () => {
    expect(parseSettings({ logLevel: 'debug', plugins: { 'dev-probe': true } })).toEqual({
      logLevel: 'debug',
      plugins: { 'dev-probe': true },
    });
  });

  it('recovers field by field rather than discarding everything', () => {
    /* Settings are not worth failing startup over: one bad field must not cost
     * the user their other preferences. */
    const settings = parseSettings({ logLevel: 'shouty', plugins: { 'dev-probe': true } });

    expect(settings.logLevel).toBe(DEFAULT_SETTINGS.logLevel);
    expect(settings.plugins).toEqual({ 'dev-probe': true });
  });

  it('drops non-boolean plugin flags but keeps the valid ones', () => {
    expect(parseSettings({ plugins: { a: true, b: 'yes', c: false } }).plugins).toEqual({
      a: true,
      c: false,
    });
  });

  it('tolerates a plugins value that is not an object', () => {
    expect(parseSettings({ plugins: 'nope' }).plugins).toEqual({});
  });

  it('defaults the log level to warn', () => {
    /* Silent when healthy: a chatty extension makes the user's own console
     * useless for debugging their app. */
    expect(DEFAULT_SETTINGS.logLevel).toBe('warn');
  });
});

describe('loadSettings', () => {
  it('reads stored settings', async () => {
    const area = fakeArea({ settings: { logLevel: 'debug', plugins: {} } });
    await expect(loadSettings(area)).resolves.toEqual({ logLevel: 'debug', plugins: {} });
  });

  it('returns defaults when nothing is stored', async () => {
    await expect(loadSettings(fakeArea())).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when storage throws', async () => {
    /* chrome.storage can fail (quota, a profile mid-sync). Never a reason to
     * take down the extension. */
    const area: SettingsStorageArea = {
      get: () => Promise.reject(new Error('storage unavailable')),
      set: () => Promise.resolve(),
    };
    await expect(loadSettings(area)).resolves.toEqual(DEFAULT_SETTINGS);
  });
});

describe('createSettingsStore', () => {
  it('exposes the initial settings', () => {
    const store = createSettingsStore({ area: fakeArea(), initial: DEFAULT_SETTINGS });
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('patch merges, persists and notifies', async () => {
    const area = fakeArea();
    const store = createSettingsStore({ area, initial: DEFAULT_SETTINGS });
    const listener = vi.fn();
    store.subscribe(listener);

    await store.patch({ logLevel: 'debug' });

    expect(store.get().logLevel).toBe('debug');
    expect(store.get().plugins).toEqual({});
    expect(area.written[0]).toEqual({ settings: { logLevel: 'debug', plugins: {} } });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('setPluginEnabled keeps the other plugins', async () => {
    const store = createSettingsStore({
      area: fakeArea(),
      initial: { logLevel: 'warn', plugins: { a: true } },
    });

    await store.setPluginEnabled('b', false);

    expect(store.get().plugins).toEqual({ a: true, b: false });
  });

  it('isPluginEnabled falls back when the user has no stored preference', () => {
    const store = createSettingsStore({
      area: fakeArea(),
      initial: { logLevel: 'warn', plugins: { stored: false } },
    });

    expect(store.isPluginEnabled('stored', true)).toBe(false);
    expect(store.isPluginEnabled('unknown', true)).toBe(true);
    expect(store.isPluginEnabled('unknown', false)).toBe(false);
  });

  it('applies an external change, e.g. the popup writing while a tab is open', () => {
    let publish: ((settings: typeof DEFAULT_SETTINGS) => void) | undefined;
    const store = createSettingsStore({
      area: fakeArea(),
      initial: DEFAULT_SETTINGS,
      watch: (listener) => {
        publish = listener;
        return () => undefined;
      },
    });
    const listener = vi.fn();
    store.subscribe(listener);

    publish?.({ logLevel: 'silent', plugins: { a: true } });

    expect(store.get().logLevel).toBe('silent');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops notifications', async () => {
    const store = createSettingsStore({ area: fakeArea(), initial: DEFAULT_SETTINGS });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();

    await store.patch({ logLevel: 'debug' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing subscriber does not stop the others', async () => {
    const store = createSettingsStore({ area: fakeArea(), initial: DEFAULT_SETTINGS });
    const healthy = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(healthy);

    await expect(store.patch({ logLevel: 'debug' })).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledOnce();
  });
});
