import { describe, expect, it, vi } from 'vitest';

import { createEventBus } from '@/core/eventBus';

interface TestEvents {
  ping: { readonly n: number };
  pong: { readonly ok: boolean };
}

describe('createEventBus', () => {
  it('delivers a payload to a subscriber of the same event', () => {
    const bus = createEventBus<TestEvents>();
    const listener = vi.fn();

    bus.on('ping', listener);
    bus.emit('ping', { n: 1 });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ n: 1 });
  });

  it('does not deliver to subscribers of other events', () => {
    const bus = createEventBus<TestEvents>();
    const listener = vi.fn();

    bus.on('pong', listener);
    bus.emit('ping', { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const bus = createEventBus<TestEvents>();
    const listener = vi.fn();

    const off = bus.on('ping', listener);
    off();
    bus.emit('ping', { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('tolerates unsubscribing twice', () => {
    const bus = createEventBus<TestEvents>();
    const off = bus.on('ping', vi.fn());

    off();
    expect(() => {
      off();
    }).not.toThrow();
    expect(bus.listenerCount()).toBe(0);
  });

  it('once() delivers a single time', () => {
    const bus = createEventBus<TestEvents>();
    const listener = vi.fn();

    bus.once('ping', listener);
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ n: 1 });
    expect(bus.listenerCount('ping')).toBe(0);
  });

  describe('error isolation', () => {
    /* The reason this exists: one broken plugin must never stop the others from
     * being notified. */
    it('still notifies later listeners when an earlier one throws', () => {
      const bus = createEventBus<TestEvents>();
      const after = vi.fn();

      bus.on('ping', () => {
        throw new Error('boom');
      });
      bus.on('ping', after);

      expect(() => {
        bus.emit('ping', { n: 1 });
      }).not.toThrow();
      expect(after).toHaveBeenCalledOnce();
    });

    it('reports the failure through onListenerError', () => {
      const onListenerError = vi.fn();
      const bus = createEventBus<TestEvents>({ onListenerError });
      const error = new Error('boom');

      bus.on('ping', () => {
        throw error;
      });
      bus.emit('ping', { n: 1 });

      expect(onListenerError).toHaveBeenCalledExactlyOnceWith(error, 'ping');
    });
  });

  describe('AbortSignal', () => {
    it('removes the listener when the signal aborts', () => {
      const bus = createEventBus<TestEvents>();
      const controller = new AbortController();
      const listener = vi.fn();

      bus.on('ping', listener, { signal: controller.signal });
      controller.abort();
      bus.emit('ping', { n: 1 });

      expect(listener).not.toHaveBeenCalled();
      expect(bus.listenerCount()).toBe(0);
    });

    it('never registers when the signal is already aborted', () => {
      const bus = createEventBus<TestEvents>();
      const controller = new AbortController();
      controller.abort();

      bus.on('ping', vi.fn(), { signal: controller.signal });

      expect(bus.listenerCount()).toBe(0);
    });

    /* One controller per plugin retires everything it registered — the property
     * that makes teardown() optional. */
    it('retires every listener sharing a controller', () => {
      const bus = createEventBus<TestEvents>();
      const controller = new AbortController();

      bus.on('ping', vi.fn(), { signal: controller.signal });
      bus.on('pong', vi.fn(), { signal: controller.signal });
      expect(bus.listenerCount()).toBe(2);

      controller.abort();
      expect(bus.listenerCount()).toBe(0);
    });
  });

  describe('re-entrancy', () => {
    it('does not deliver to a listener added during the same emit', () => {
      const bus = createEventBus<TestEvents>();
      const late = vi.fn();

      bus.on('ping', () => {
        bus.on('ping', late);
      });
      bus.emit('ping', { n: 1 });

      expect(late).not.toHaveBeenCalled();
      bus.emit('ping', { n: 2 });
      expect(late).toHaveBeenCalledOnce();
    });

    it('still delivers to a listener removed earlier in the same emit', () => {
      /* Snapshot semantics: a delivery in flight completes as it started.
       * Iterating the live Set instead would make "does my listener run?"
       * depend on registration order — a genuinely horrible bug to chase. */
      const bus = createEventBus<TestEvents>();
      const second = vi.fn();

      let offSecond: (() => void) | undefined;
      bus.on('ping', () => {
        offSecond?.();
      });
      offSecond = bus.on('ping', second);

      bus.emit('ping', { n: 1 });
      expect(second).toHaveBeenCalledOnce();

      /* Gone for good from the next emit onwards. */
      bus.emit('ping', { n: 2 });
      expect(second).toHaveBeenCalledOnce();
    });
  });

  it('listenerCount reports per event and in total', () => {
    const bus = createEventBus<TestEvents>();
    bus.on('ping', vi.fn());
    bus.on('ping', vi.fn());
    bus.on('pong', vi.fn());

    expect(bus.listenerCount('ping')).toBe(2);
    expect(bus.listenerCount('pong')).toBe(1);
    expect(bus.listenerCount()).toBe(3);
  });

  it('clear() removes everything', () => {
    const bus = createEventBus<TestEvents>();
    bus.on('ping', vi.fn());
    bus.clear();

    expect(bus.listenerCount()).toBe(0);
  });

  it('emitting an event with no listeners is a no-op', () => {
    const bus = createEventBus<TestEvents>();
    expect(() => {
      bus.emit('ping', { n: 1 });
    }).not.toThrow();
  });
});
