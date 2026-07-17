import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '@/core/logger';
import type { Plugin, PluginContext } from '@/core/plugin';
import { createPluginRegistry } from '@/core/pluginRegistry';

function fakePlugin(overrides: Partial<Plugin> & Pick<Plugin, 'id'>): Plugin {
  return {
    name: overrides.id,
    description: '',
    enabledByDefault: true,
    setup: vi.fn(),
    ...overrides,
  };
}

function makeRegistry(
  plugins: readonly Plugin[],
  isEnabled: (plugin: Plugin) => boolean = () => true,
) {
  const contexts = new Map<string, PluginContext>();

  const registry = createPluginRegistry({
    plugins,
    isEnabled,
    logger: createLogger('test', 'silent'),
    createContext: (plugin) => {
      const context = { id: plugin.id } as unknown as PluginContext;
      contexts.set(plugin.id, context);
      return context;
    },
  });

  return { registry, contexts };
}

describe('createPluginRegistry', () => {
  it('sets up an enabled plugin', async () => {
    const setup = vi.fn();
    const { registry } = makeRegistry([fakePlugin({ id: 'a', setup })]);

    await registry.setupAll();

    expect(setup).toHaveBeenCalledOnce();
    expect(registry.active).toHaveLength(1);
  });

  it('skips a disabled plugin', async () => {
    const setup = vi.fn();
    const { registry } = makeRegistry([fakePlugin({ id: 'a', setup })], () => false);

    await registry.setupAll();

    expect(setup).not.toHaveBeenCalled();
    expect(registry.active).toHaveLength(0);
  });

  it('awaits an async setup', async () => {
    let done = false;
    const { registry } = makeRegistry([
      fakePlugin({
        id: 'a',
        setup: async () => {
          await Promise.resolve();
          done = true;
        },
      }),
    ]);

    await registry.setupAll();

    expect(done).toBe(true);
  });

  describe('fault isolation', () => {
    /* The rule this whole module exists to enforce: a broken plugin breaks only
     * itself. We are a guest in an app the user actually needs. */

    it('a plugin that throws does not stop the others', async () => {
      const healthy = vi.fn();
      const { registry } = makeRegistry([
        fakePlugin({
          id: 'broken',
          setup: () => {
            throw new Error('boom');
          },
        }),
        fakePlugin({ id: 'healthy', setup: healthy }),
      ]);

      await expect(registry.setupAll()).resolves.toBeUndefined();
      expect(healthy).toHaveBeenCalledOnce();
      expect(registry.active.map((entry) => entry.plugin.id)).toEqual(['healthy']);
    });

    it('a rejected async setup is contained too', async () => {
      const healthy = vi.fn();
      const { registry } = makeRegistry([
        fakePlugin({ id: 'broken', setup: () => Promise.reject(new Error('boom')) }),
        fakePlugin({ id: 'healthy', setup: healthy }),
      ]);

      await registry.setupAll();

      expect(healthy).toHaveBeenCalledOnce();
      expect(registry.active).toHaveLength(1);
    });

    it('aborts the signal of a plugin that failed to set up', async () => {
      /* A half-initialised plugin is worse than an absent one: whatever it
       * registered before throwing would keep running with no owner. */
      let captured: AbortSignal | undefined;
      const { registry } = makeRegistry([
        fakePlugin({
          id: 'broken',
          setup: (context) => {
            captured = context.signal;
            throw new Error('boom');
          },
        }),
      ]);

      await registry.setupAll();

      expect(captured?.aborted).toBe(true);
    });

    it('a plugin that throws on teardown does not stop the others', async () => {
      const otherTeardown = vi.fn();
      const { registry } = makeRegistry([
        fakePlugin({
          id: 'broken',
          teardown: () => {
            throw new Error('boom');
          },
        }),
        fakePlugin({ id: 'healthy', teardown: otherTeardown }),
      ]);

      await registry.setupAll();
      await expect(registry.teardownAll()).resolves.toBeUndefined();

      expect(otherTeardown).toHaveBeenCalledOnce();
      expect(registry.active).toHaveLength(0);
    });
  });

  describe('teardown', () => {
    it('aborts the signal and calls teardown', async () => {
      const teardown = vi.fn();
      let captured: AbortSignal | undefined;
      const { registry } = makeRegistry([
        fakePlugin({
          id: 'a',
          setup: (context) => {
            captured = context.signal;
          },
          teardown,
        }),
      ]);

      await registry.setupAll();
      expect(captured?.aborted).toBe(false);

      await registry.teardownAll();

      expect(captured?.aborted).toBe(true);
      expect(teardown).toHaveBeenCalledOnce();
      expect(registry.active).toHaveLength(0);
    });

    it('aborts even when teardown throws', async () => {
      /* Abort first, then teardown: listeners must go regardless. */
      let captured: AbortSignal | undefined;
      const { registry } = makeRegistry([
        fakePlugin({
          id: 'a',
          setup: (context) => {
            captured = context.signal;
          },
          teardown: () => {
            throw new Error('boom');
          },
        }),
      ]);

      await registry.setupAll();
      await registry.teardownAll();

      expect(captured?.aborted).toBe(true);
    });

    it('a plugin without teardown is fine', async () => {
      const { registry } = makeRegistry([fakePlugin({ id: 'a' })]);

      await registry.setupAll();
      await expect(registry.teardownAll()).resolves.toBeUndefined();
    });
  });

  describe('duplicate ids', () => {
    it('keeps the first and ignores the second', async () => {
      /* Two plugins sharing an id would share a settings key and a log
       * namespace, and the first teardown would orphan the second's listeners. */
      const first = vi.fn();
      const second = vi.fn();
      const { registry } = makeRegistry([
        fakePlugin({ id: 'dup', setup: first }),
        fakePlugin({ id: 'dup', setup: second }),
      ]);

      await registry.setupAll();

      expect(first).toHaveBeenCalledOnce();
      expect(second).not.toHaveBeenCalled();
      expect(registry.active).toHaveLength(1);
    });
  });

  it('setupAll twice does not set a plugin up twice', async () => {
    const setup = vi.fn();
    const { registry } = makeRegistry([fakePlugin({ id: 'a', setup })]);

    await registry.setupAll();
    await registry.setupAll();

    expect(setup).toHaveBeenCalledOnce();
  });

  it('gives each plugin its own signal', async () => {
    const signals: AbortSignal[] = [];
    const capture = (context: PluginContext): void => {
      signals.push(context.signal);
    };
    const { registry } = makeRegistry([
      fakePlugin({ id: 'a', setup: capture }),
      fakePlugin({ id: 'b', setup: capture }),
    ]);

    await registry.setupAll();

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('sets plugins up concurrently, so a slow one does not block the rest', async () => {
    /* A plugin awaiting waitForElement() could otherwise hold every other
     * plugin hostage until its timeout. */
    const order: string[] = [];
    const { registry } = makeRegistry([
      fakePlugin({
        id: 'slow',
        setup: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push('slow');
        },
      }),
      fakePlugin({
        id: 'fast',
        setup: () => {
          order.push('fast');
        },
      }),
    ]);

    await registry.setupAll();

    expect(order).toEqual(['fast', 'slow']);
    expect(registry.active).toHaveLength(2);
  });
});
