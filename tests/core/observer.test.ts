import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDomObserver, waitForElement } from '@/core/observer';

/**
 * A manual scheduler standing in for requestAnimationFrame, so batching is
 * asserted deterministically rather than by sleeping.
 */
function manualScheduler(): { schedule: (callback: () => void) => void; flush: () => void } {
  let queued: (() => void) | undefined;
  return {
    schedule: (callback) => {
      queued = callback;
    },
    flush: () => {
      const callback = queued;
      queued = undefined;
      callback?.();
    },
  };
}

/** MutationObserver delivers on a microtask; this lets those run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createDomObserver', () => {
  let observer: ReturnType<typeof createDomObserver> | undefined;

  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    observer?.disconnect();
    observer = undefined;
  });

  it('reports a mutation to subscribers', async () => {
    const scheduler = manualScheduler();
    observer = createDomObserver({ schedule: scheduler.schedule });
    const listener = vi.fn();
    observer.subscribe(listener);

    document.body.append(document.createElement('div'));
    await settle();
    scheduler.flush();

    expect(listener).toHaveBeenCalledOnce();
    const [records] = listener.mock.calls[0] as [readonly MutationRecord[]];
    expect(records.length).toBeGreaterThan(0);
  });

  it('coalesces a burst into a single batch', async () => {
    /* The point of the whole module. React rebuilds Synology's panels in bursts
     * of hundreds of records; one callback per record would make the page feel
     * broken. */
    const scheduler = manualScheduler();
    observer = createDomObserver({ schedule: scheduler.schedule });
    const listener = vi.fn();
    observer.subscribe(listener);

    for (let i = 0; i < 50; i += 1) document.body.append(document.createElement('div'));
    await settle();
    scheduler.flush();

    expect(listener).toHaveBeenCalledOnce();
    const [records] = listener.mock.calls[0] as [readonly MutationRecord[]];
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('does not schedule a second frame while one is pending', async () => {
    const schedule = vi.fn();
    observer = createDomObserver({ schedule });
    observer.subscribe(vi.fn());

    document.body.append(document.createElement('div'));
    document.body.append(document.createElement('span'));
    await settle();

    expect(schedule).toHaveBeenCalledOnce();
  });

  it('starts a fresh batch after a flush', async () => {
    const scheduler = manualScheduler();
    observer = createDomObserver({ schedule: scheduler.schedule });
    const listener = vi.fn();
    observer.subscribe(listener);

    document.body.append(document.createElement('div'));
    await settle();
    scheduler.flush();

    document.body.append(document.createElement('span'));
    await settle();
    scheduler.flush();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies every subscriber', async () => {
    const scheduler = manualScheduler();
    observer = createDomObserver({ schedule: scheduler.schedule });
    const first = vi.fn();
    const second = vi.fn();
    observer.subscribe(first);
    observer.subscribe(second);

    document.body.append(document.createElement('div'));
    await settle();
    scheduler.flush();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('a throwing subscriber does not stop the others', async () => {
    const scheduler = manualScheduler();
    observer = createDomObserver({ schedule: scheduler.schedule });
    const healthy = vi.fn();
    observer.subscribe(() => {
      throw new Error('boom');
    });
    observer.subscribe(healthy);

    document.body.append(document.createElement('div'));
    await settle();

    expect(() => {
      scheduler.flush();
    }).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops delivery', async () => {
    const scheduler = manualScheduler();
    observer = createDomObserver({ schedule: scheduler.schedule });
    const listener = vi.fn();
    const off = observer.subscribe(listener);
    off();

    document.body.append(document.createElement('div'));
    await settle();
    scheduler.flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('disconnect stops delivery and is idempotent', async () => {
    const scheduler = manualScheduler();
    const local = createDomObserver({ schedule: scheduler.schedule });
    const listener = vi.fn();
    local.subscribe(listener);

    local.disconnect();
    expect(() => {
      local.disconnect();
    }).not.toThrow();

    document.body.append(document.createElement('div'));
    await settle();
    scheduler.flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('observes a custom target', async () => {
    const scheduler = manualScheduler();
    const target = document.createElement('div');
    document.body.append(target);

    observer = createDomObserver({ target, schedule: scheduler.schedule });
    const listener = vi.fn();
    observer.subscribe(listener);

    target.append(document.createElement('span'));
    await settle();
    scheduler.flush();

    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('waitForElement', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('resolves immediately when the element is already there', async () => {
    const node = document.createElement('div');
    node.className = 'target';
    document.body.append(node);

    await expect(waitForElement('.target')).resolves.toBe(node);
  });

  it('resolves when the element appears later', async () => {
    /* This is the answer to `setTimeout(fn, 50)`: guessing a delay is a race
     * that passes locally and fails on a cold cache. */
    const promise = waitForElement('.late');

    setTimeout(() => {
      const node = document.createElement('div');
      node.className = 'late';
      document.body.append(node);
    }, 5);

    await expect(promise).resolves.toBeInstanceOf(HTMLElement);
  });

  it('rejects on timeout', async () => {
    await expect(waitForElement('.never', { timeout: 10 })).rejects.toThrow(/did not appear/);
  });

  it('rejects when the signal aborts', async () => {
    const controller = new AbortController();
    const promise = waitForElement('.never', { timeout: 0, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow(/Aborted/);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitForElement('.never', { signal: controller.signal })).rejects.toThrow(
      /Aborted/,
    );
  });

  it('resolves from an already-present element even with an aborted signal', async () => {
    /* Found is found: the fast path runs before the abort check, so a plugin
     * tearing down mid-wait still gets a coherent answer rather than a spurious
     * rejection. */
    const node = document.createElement('div');
    node.className = 'here';
    document.body.append(node);

    const controller = new AbortController();
    controller.abort();

    await expect(waitForElement('.here', { signal: controller.signal })).resolves.toBe(node);
  });

  it('searches within a custom root', async () => {
    const root = document.createElement('div');
    const child = document.createElement('span');
    child.className = 'scoped';
    root.append(child);
    document.body.append(root);

    await expect(waitForElement('.scoped', { root })).resolves.toBe(child);
  });
});
