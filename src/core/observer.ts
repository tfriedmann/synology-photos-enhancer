/**
 * DOM observation primitives.
 *
 * Synology Photos is React-driven: it tears down and rebuilds panels
 * constantly, and anything we inject is wiped with them. Observing the DOM is
 * therefore not optional — but a naive `MutationObserver` on `document.body`
 * with `subtree: true` fires in bursts of hundreds during a scroll, and running
 * plugin work on each record is how an extension makes a page feel broken.
 *
 * So every record is coalesced into a single animation frame. Plugins see one
 * batch per frame at most, aligned with paint, and the cost is shared across
 * all of them: one observer for the whole extension, not one per plugin.
 */

export interface DomObserverOptions {
  /** Defaults to `document.body`. */
  readonly target?: Node | undefined;
  readonly init?: MutationObserverInit | undefined;
  /** Injected for tests; defaults to `requestAnimationFrame`. */
  readonly schedule?: ((callback: () => void) => void) | undefined;
}

export interface DomObserver {
  subscribe(listener: (mutations: readonly MutationRecord[]) => void): () => void;
  /** Idempotent. */
  disconnect(): void;
}

const DEFAULT_INIT: MutationObserverInit = { childList: true, subtree: true };

export function createDomObserver(options: DomObserverOptions = {}): DomObserver {
  const target = options.target ?? document.body;
  const init = options.init ?? DEFAULT_INIT;
  const schedule =
    options.schedule ??
    ((callback: () => void) => {
      requestAnimationFrame(callback);
    });

  const listeners = new Set<(mutations: readonly MutationRecord[]) => void>();
  let pending: MutationRecord[] = [];
  let frameQueued = false;
  let disconnected = false;

  const flush = (): void => {
    frameQueued = false;
    if (pending.length === 0 || listeners.size === 0) {
      pending = [];
      return;
    }

    const batch = pending;
    pending = [];

    for (const listener of [...listeners]) {
      try {
        listener(batch);
      } catch {
        /* A subscriber that throws must not abort delivery to the others, and
         * must not kill the observer. The core reports it via the bus's
         * onListenerError; here we simply keep going. */
      }
    }
  };

  const observer = new MutationObserver((records) => {
    pending.push(...records);
    if (frameQueued) return;
    frameQueued = true;
    schedule(flush);
  });

  observer.observe(target, init);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      observer.disconnect();
      listeners.clear();
      pending = [];
    },
  };
}

export interface WaitForElementOptions {
  readonly root?: ParentNode | undefined;
  /** Rejects after this many ms. `0` waits forever. */
  readonly timeout?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Resolves once `selector` matches, or rejects on timeout/abort.
 *
 * This is the answer to the `setTimeout(fn, 50)` reflex: guessing a delay is a
 * race that passes on your machine and fails on someone's cold cache. Await the
 * node instead.
 *
 * @example
 * const block = await waitForElement('.synofoto-lightbox-info-block', { signal });
 */
export function waitForElement<E extends Element = Element>(
  selector: string,
  options: WaitForElementOptions = {},
): Promise<E> {
  const root = options.root ?? document;
  const timeout = options.timeout ?? 10_000;
  const { signal } = options;

  return new Promise<E>((resolve, reject) => {
    const existing = root.querySelector<E>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    if (signal?.aborted === true) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const observer = new MutationObserver(() => {
      const found = root.querySelector<E>(selector);
      if (!found) return;
      cleanup();
      resolve(found);
    });

    /* MutationObserver cannot observe a Document, so a document root becomes
     * its <html> element. */
    const observeRoot = root instanceof Document ? root.documentElement : root;
    observer.observe(observeRoot, { childList: true, subtree: true });

    signal?.addEventListener('abort', onAbort, { once: true });

    if (timeout > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(`waitForElement: "${selector}" did not appear within ${String(timeout)}ms`),
        );
      }, timeout);
    }
  });
}
