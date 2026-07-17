/**
 * A small, typed publish/subscribe bus.
 *
 * This is the only channel through which plugins observe the world, and the
 * reason they never need to know about each other.
 *
 * Three design choices worth stating, since they are the ones that keep this
 * from rotting:
 *
 * - **Unsubscribe via `AbortSignal`.** Rather than inventing a disposal
 *   dialect, `on()` takes the same `{ signal }` option as `addEventListener`.
 *   One `AbortController` per plugin then tears down every listener it ever
 *   registered, with no bookkeeping. Standard beats clever.
 * - **A throwing handler is contained.** We run inside someone else's page; one
 *   broken plugin must not stop the others from being notified.
 * - **`emit` is synchronous and iterates a snapshot**, so subscribing or
 *   unsubscribing from inside a handler is safe and does not affect the
 *   delivery in flight.
 */

/**
 * Constraint for an event map: an object type of event name → payload.
 *
 * Deliberately `object` and not `Record<string, unknown>`. TypeScript gives
 * *interfaces* no implicit index signature (only type aliases get one), so the
 * stricter constraint would reject `AppEventMap` — declared as an interface so
 * that it can be documented and extended. The real safety comes from
 * `K extends keyof M & string` on each method, which pins every event name to
 * the map and every payload to its name.
 */
export type EventMapConstraint = object;

export type Unsubscribe = () => void;

export type Listener<T> = (payload: T) => void;

export interface OnOptions {
  /** Removes the listener when aborted. One controller can retire many listeners. */
  readonly signal?: AbortSignal | undefined;
}

export interface EventBusOptions {
  /**
   * Called when a listener throws. Injected rather than imported so the bus
   * stays dependency-free and trivially testable.
   */
  readonly onListenerError?: ((error: unknown, event: string) => void) | undefined;
}

export interface EventBus<M extends EventMapConstraint> {
  on<K extends keyof M & string>(
    event: K,
    listener: Listener<M[K]>,
    options?: OnOptions,
  ): Unsubscribe;
  once<K extends keyof M & string>(
    event: K,
    listener: Listener<M[K]>,
    options?: OnOptions,
  ): Unsubscribe;
  emit<K extends keyof M & string>(event: K, payload: M[K]): void;
  /** Number of active listeners; for tests and diagnostics. */
  listenerCount(event?: keyof M & string): number;
  clear(): void;
}

export function createEventBus<M extends EventMapConstraint>(
  options: EventBusOptions = {},
): EventBus<M> {
  /* `Listener<never>` is the honest type for a heterogeneous store: the public
   * signatures enforce the name↔payload pairing, and this is the one spot where
   * the map has to be erased. It keeps the erasure to a single line instead of
   * leaking `any` into the API. */
  const listeners = new Map<string, Set<Listener<never>>>();

  function on<K extends keyof M & string>(
    event: K,
    listener: Listener<M[K]>,
    onOptions: OnOptions = {},
  ): Unsubscribe {
    const { signal } = onOptions;

    /* Already-aborted signals must not register anything, mirroring
     * addEventListener. Returning a no-op keeps the caller branch-free. */
    if (signal?.aborted === true) return () => undefined;

    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }

    const stored = listener as Listener<never>;
    set.add(stored);

    let removed = false;
    const off: Unsubscribe = () => {
      if (removed) return;
      removed = true;
      const current = listeners.get(event);
      if (!current) return;
      current.delete(stored);
      if (current.size === 0) listeners.delete(event);
    };

    signal?.addEventListener('abort', off, { once: true });

    return off;
  }

  function once<K extends keyof M & string>(
    event: K,
    listener: Listener<M[K]>,
    onOptions: OnOptions = {},
  ): Unsubscribe {
    const off = on(
      event,
      (payload) => {
        off();
        listener(payload);
      },
      onOptions,
    );
    return off;
  }

  function emit<K extends keyof M & string>(event: K, payload: M[K]): void {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;

    /* Snapshot: a listener may unsubscribe itself or add another mid-delivery. */
    for (const listener of [...set]) {
      try {
        (listener as Listener<M[K]>)(payload);
      } catch (error) {
        options.onListenerError?.(error, event);
      }
    }
  }

  function listenerCount(event?: keyof M & string): number {
    if (event !== undefined) return listeners.get(event)?.size ?? 0;
    let total = 0;
    for (const set of listeners.values()) total += set.size;
    return total;
  }

  function clear(): void {
    listeners.clear();
  }

  return { on, once, emit, listenerCount, clear };
}
