import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installMainWorldBridge,
  readRequestUrl,
  readXhrBody,
  type MainWorldScope,
  type UninstallBridge,
} from '@/bridge/mainWorld';
import type { BridgeMessage } from '@/bridge/protocol';

/**
 * A fake XMLHttpRequest, small enough to drive by hand.
 *
 * happy-dom ships a real one, but it would need a live server to exercise; the
 * point here is the *patching* — that originals are preserved, called with the
 * right `this`, and that our listener reads the response — not that XHR works.
 */
class FakeXhr {
  static instances: FakeXhr[] = [];

  openCalls: unknown[][] = [];
  sendCalls: unknown[][] = [];
  responseType: XMLHttpRequest['responseType'] = 'json';
  response: unknown = undefined;
  responseText = '';
  status = 200;

  private listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(...args: unknown[]): void {
    this.openCalls.push(args);
  }

  send(...args: unknown[]): void {
    this.sendCalls.push(args);
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  /** Simulates the response arriving. */
  fireLoad(): void {
    for (const listener of [...(this.listeners.get('load') ?? [])]) listener();
  }
}

function makeScope(): {
  scope: MainWorldScope;
  posted: BridgeMessage[];
  originalFetch: ReturnType<typeof vi.fn>;
  pushCalls: unknown[][];
} {
  const posted: BridgeMessage[] = [];
  const pushCalls: unknown[][] = [];

  const originalFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response('{"success":true}', { status: 200 })),
  );

  const history = {
    pushState(...args: unknown[]) {
      pushCalls.push(args);
    },
    replaceState(...args: unknown[]) {
      pushCalls.push(args);
    },
  } as unknown as History;

  const scope: MainWorldScope = {
    XMLHttpRequest: FakeXhr as unknown as typeof XMLHttpRequest,
    fetch: originalFetch,
    history,
    location: { href: 'https://nas:5001/photo/#/personal_space/timeline' },
  };

  return { scope, posted, originalFetch, pushCalls };
}

const captureAll = (): boolean => true;
let uninstall: UninstallBridge | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  FakeXhr.instances = [];
});

describe('readXhrBody', () => {
  it('returns the parsed response when responseType is json', () => {
    expect(readXhrBody({ responseType: 'json', response: { a: 1 }, responseText: '' })).toEqual({
      a: 1,
    });
  });

  it('parses JSON text when responseType is text or empty', () => {
    expect(readXhrBody({ responseType: '', response: null, responseText: '{"a":1}' })).toEqual({
      a: 1,
    });
    expect(readXhrBody({ responseType: 'text', response: null, responseText: '{"a":1}' })).toEqual({
      a: 1,
    });
  });

  it('falls back to raw text when the body is not JSON', () => {
    expect(readXhrBody({ responseType: '', response: null, responseText: 'hello' })).toBe('hello');
  });

  it('returns undefined for binary response types', () => {
    /* Reading `responseText` on a blob response throws outright — the reason
     * the type is checked before the access, not after. */
    expect(
      readXhrBody({ responseType: 'blob', response: new Blob(), responseText: '' }),
    ).toBeUndefined();
  });

  it('returns undefined instead of throwing when the accessor throws', () => {
    const hostile = {
      responseType: '' as const,
      response: null,
      get responseText(): string {
        throw new Error('InvalidStateError');
      },
    };
    expect(readXhrBody(hostile)).toBeUndefined();
  });
});

describe('readRequestUrl', () => {
  it('handles a string', () => {
    expect(readRequestUrl('/webapi/entry.cgi')).toBe('/webapi/entry.cgi');
  });

  it('handles a URL', () => {
    expect(readRequestUrl(new URL('https://nas:5001/webapi/entry.cgi'))).toBe(
      'https://nas:5001/webapi/entry.cgi',
    );
  });

  it('handles a Request', () => {
    expect(readRequestUrl(new Request('https://nas:5001/webapi/entry.cgi'))).toBe(
      'https://nas:5001/webapi/entry.cgi',
    );
  });
});

describe('installMainWorldBridge — XHR', () => {
  it('reports a captured response', () => {
    const { scope, posted } = makeScope();
    uninstall = installMainWorldBridge(scope, {
      post: (message) => posted.push(message),
      shouldCapture: captureAll,
    });

    const xhr = new scope.XMLHttpRequest();
    xhr.open('GET', 'https://nas:5001/webapi/entry.cgi?api=SYNO.FotoTeam.Browse.Item');
    xhr.send();

    const instance = FakeXhr.instances[0];
    if (!instance) throw new Error('the bridge did not construct an XHR');
    instance.response = { success: true, data: { list: [{ id: 1 }] } };
    instance.fireLoad();

    expect(posted).toHaveLength(1);
    const message = posted[0];
    expect(message?.type).toBe('api:response');
    if (message?.type !== 'api:response') throw new Error('unreachable');
    expect(message.method).toBe('GET');
    expect(message.status).toBe(200);
    expect(message.body).toEqual({ success: true, data: { list: [{ id: 1 }] } });
  });

  it('ignores traffic that shouldCapture rejects', () => {
    /* Without this gate we would clone and serialise every image and JS chunk
     * the app loads. */
    const { scope, posted } = makeScope();
    uninstall = installMainWorldBridge(scope, {
      post: (message) => posted.push(message),
      shouldCapture: (url) => url.includes('/webapi/'),
    });

    const xhr = new scope.XMLHttpRequest();
    xhr.open('GET', 'https://nas:5001/photo/chunk.js');
    xhr.send();
    FakeXhr.instances[0]?.fireLoad();

    expect(posted).toHaveLength(0);
  });

  describe('never breaking the page', () => {
    /* We patch globals inside an app we do not own. Every one of these is a way
     * a careless hook takes Synology Photos down with it. */

    it('always calls the original open with the original arguments', () => {
      const { scope } = makeScope();
      uninstall = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });

      const xhr = new scope.XMLHttpRequest();
      xhr.open('POST', '/webapi/entry.cgi', true, 'user', 'pass');

      expect(FakeXhr.instances[0]?.openCalls[0]).toEqual([
        'POST',
        '/webapi/entry.cgi',
        true,
        'user',
        'pass',
      ]);
    });

    it('always calls the original send with its body', () => {
      const { scope } = makeScope();
      uninstall = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });

      const xhr = new scope.XMLHttpRequest();
      xhr.open('POST', '/webapi/entry.cgi');
      xhr.send('api=SYNO.Foto.Browse.Item');

      expect(FakeXhr.instances[0]?.sendCalls[0]).toEqual(['api=SYNO.Foto.Browse.Item']);
    });

    it('still sends when our post callback throws', () => {
      const { scope } = makeScope();
      const onError = vi.fn();
      uninstall = installMainWorldBridge(scope, {
        post: () => {
          throw new Error('boom');
        },
        shouldCapture: captureAll,
        onError,
      });

      const xhr = new scope.XMLHttpRequest();
      xhr.open('GET', '/webapi/entry.cgi');

      expect(() => {
        xhr.send();
      }).not.toThrow();
      expect(() => {
        FakeXhr.instances[0]?.fireLoad();
      }).not.toThrow();
      expect(onError).toHaveBeenCalled();
      expect(FakeXhr.instances[0]?.sendCalls).toHaveLength(1);
    });

    it('still sends when shouldCapture throws', () => {
      const { scope } = makeScope();
      const onError = vi.fn();
      uninstall = installMainWorldBridge(scope, {
        post: vi.fn(),
        shouldCapture: () => {
          throw new Error('boom');
        },
        onError,
      });

      const xhr = new scope.XMLHttpRequest();
      xhr.open('GET', '/webapi/entry.cgi');
      expect(() => {
        xhr.send();
      }).not.toThrow();
      expect(FakeXhr.instances[0]?.sendCalls).toHaveLength(1);
      expect(onError).toHaveBeenCalled();
    });

    it('sends even if send() is called without open() first', () => {
      const { scope, posted } = makeScope();
      uninstall = installMainWorldBridge(scope, {
        post: (message) => posted.push(message),
        shouldCapture: captureAll,
      });

      const xhr = new scope.XMLHttpRequest();
      expect(() => {
        xhr.send();
      }).not.toThrow();
      expect(posted).toHaveLength(0);
    });
  });

  it('uninstall restores the original methods', () => {
    const { scope } = makeScope();
    const originalOpen = FakeXhr.prototype.open;
    const originalSend = FakeXhr.prototype.send;

    const restore = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });
    expect(FakeXhr.prototype.open).not.toBe(originalOpen);

    restore();

    expect(FakeXhr.prototype.open).toBe(originalOpen);
    expect(FakeXhr.prototype.send).toBe(originalSend);
  });
});

describe('installMainWorldBridge — fetch', () => {
  it('reports a captured response', async () => {
    const { scope, posted } = makeScope();
    uninstall = installMainWorldBridge(scope, {
      post: (message) => posted.push(message),
      shouldCapture: captureAll,
    });

    await scope.fetch('https://nas:5001/webapi/entry.cgi?api=SYNO.Foto.Browse.Item');
    /* The clone is read asynchronously; let those microtasks settle. */
    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });

    const message = posted[0];
    if (message?.type !== 'api:response') throw new Error('expected an api:response');
    expect(message.body).toEqual({ success: true });
    expect(message.status).toBe(200);
  });

  it('leaves the response body readable by the page', async () => {
    /* The whole reason we read a clone: consuming the real body would break the
     * app in the most baffling way possible. */
    const { scope } = makeScope();
    uninstall = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });

    const response = await scope.fetch('/webapi/entry.cgi');

    expect(response.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it('passes the original arguments through', () => {
    const { scope, originalFetch } = makeScope();
    uninstall = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });

    const init: RequestInit = { method: 'POST', body: 'api=X' };
    void scope.fetch('/webapi/entry.cgi', init);

    expect(originalFetch).toHaveBeenCalledExactlyOnceWith('/webapi/entry.cgi', init);
  });

  it('reads the method from init', async () => {
    const { scope, posted } = makeScope();
    uninstall = installMainWorldBridge(scope, {
      post: (message) => posted.push(message),
      shouldCapture: captureAll,
    });

    await scope.fetch('/webapi/entry.cgi', { method: 'POST' });
    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });

    const message = posted[0];
    if (message?.type !== 'api:response') throw new Error('expected an api:response');
    expect(message.method).toBe('POST');
  });

  it('does not swallow a rejection the page is expecting', async () => {
    const { scope } = makeScope();
    scope.fetch = vi.fn(() => Promise.reject(new Error('network down')));
    uninstall = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });

    await expect(scope.fetch('/webapi/entry.cgi')).rejects.toThrow('network down');
  });

  it('uninstall restores the original fetch', () => {
    const { scope, originalFetch } = makeScope();
    const restore = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });
    expect(scope.fetch).not.toBe(originalFetch);

    restore();

    expect(scope.fetch).toBe(originalFetch);
  });
});

describe('installMainWorldBridge — history', () => {
  it('reports pushState, which fires no event of its own', () => {
    const { scope, posted } = makeScope();
    uninstall = installMainWorldBridge(scope, {
      post: (message) => posted.push(message),
      shouldCapture: captureAll,
    });

    scope.history.pushState({}, '', '/photo/#/shared_space/folder/1901');

    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('history:changed');
  });

  it('reports replaceState', () => {
    const { scope, posted } = makeScope();
    uninstall = installMainWorldBridge(scope, {
      post: (message) => posted.push(message),
      shouldCapture: captureAll,
    });

    scope.history.replaceState({}, '', '/photo/#/x');

    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('history:changed');
  });

  it('calls the original history methods with their arguments', () => {
    const { scope, pushCalls } = makeScope();
    uninstall = installMainWorldBridge(scope, { post: vi.fn(), shouldCapture: captureAll });

    const state = { page: 1 };
    scope.history.pushState(state, '', '/x');

    expect(pushCalls[0]).toEqual([state, '', '/x']);
  });

  it('navigates even when our post throws', () => {
    const { scope, pushCalls } = makeScope();
    uninstall = installMainWorldBridge(scope, {
      post: () => {
        throw new Error('boom');
      },
      shouldCapture: captureAll,
      onError: vi.fn(),
    });

    expect(() => {
      scope.history.pushState({}, '', '/x');
    }).not.toThrow();
    expect(pushCalls).toHaveLength(1);
  });
});
