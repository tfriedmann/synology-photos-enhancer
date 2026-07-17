import {
  createApiResponseMessage,
  createHistoryChangedMessage,
  type BridgeMessage,
} from './protocol';

/**
 * Patches the page's network and history APIs, and reports what they do.
 *
 * This runs in the MAIN world at `document_start`, and it is the reason the
 * extension can know anything at all: the data plugins need — GPS, and the
 * `cache_key` that thumbnails require — appears in API responses and nowhere in
 * the DOM or the URL.
 *
 * ## Rules this module lives by
 *
 * We are monkey-patching globals inside an application we do not own, before it
 * has even started. Every rule below exists because breaking it would break
 * Synology Photos itself, not just us:
 *
 * - **Never change observable behaviour.** Originals are called with the
 *   original `this` and arguments, and their return value is passed through
 *   untouched.
 * - **Never block.** Responses are read from a clone, after the fact. The page
 *   never waits on us.
 * - **Never throw into the page.** Any failure of ours is swallowed and
 *   reported through `onError`; the page must not see an exception it cannot
 *   explain.
 * - **Never touch the instance.** Per-request state lives in a `WeakMap`, not
 *   on the object. Assigning `xhr._url` (the obvious shortcut) risks colliding
 *   with the app's own fields and leaks memory.
 *
 * The whole module takes its scope as a parameter, so it is exercised by unit
 * tests against fakes rather than only in a live browser.
 */

/** The globals we patch. Narrowed to what we touch, so tests can fake it. */
export interface MainWorldScope {
  XMLHttpRequest: typeof XMLHttpRequest;
  fetch: typeof fetch;
  readonly history: History;
  readonly location: Pick<Location, 'href'>;
}

export interface MainWorldBridgeOptions {
  readonly post: (message: BridgeMessage) => void;
  /**
   * Gate on the request URL. Everything else on the page is ignored — without
   * this we would clone and serialise every image and chunk the app loads.
   */
  readonly shouldCapture: (url: string) => boolean;
  readonly onError?: ((error: unknown) => void) | undefined;
}

/** Restores every patched global. */
export type UninstallBridge = () => void;

type XhrSendArgs = Parameters<XMLHttpRequest['send']>;

interface XhrMeta {
  readonly method: string;
  readonly url: string;
}

/**
 * Reads an XHR body without ever throwing.
 *
 * `responseText` throws outright when `responseType` is `blob`/`arraybuffer`,
 * so the type is checked before the access, not after.
 */
export function readXhrBody(
  xhr: Pick<XMLHttpRequest, 'responseType' | 'response' | 'responseText'>,
): unknown {
  try {
    if (xhr.responseType === 'json') return xhr.response;

    if (xhr.responseType === '' || xhr.responseType === 'text') {
      const text = xhr.responseText;
      try {
        return JSON.parse(text);
      } catch {
        /* Not JSON — the raw text is still the honest answer. */
        return text;
      }
    }

    /* blob / arraybuffer / document: never a webapi payload. */
    return undefined;
  } catch {
    return undefined;
  }
}

/** Normalises the many things `fetch` accepts into a URL string. */
export function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function readRequestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method !== undefined) return init.method;
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method;
  return 'GET';
}

export function installMainWorldBridge(
  scope: MainWorldScope,
  options: MainWorldBridgeOptions,
): UninstallBridge {
  const { post, shouldCapture } = options;
  const onError = options.onError ?? ((): void => undefined);

  /* Guarded so every failure inside our own callbacks stays inside them. */
  const safely = (fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      onError(error);
    }
  };

  // ---------------------------------------------------------------- XHR
  const xhrProto = scope.XMLHttpRequest.prototype;
  const originalOpen = xhrProto.open;
  const originalSend = xhrProto.send;

  /* Keyed by request, so entries vanish with the XHR object itself. */
  const meta = new WeakMap<XMLHttpRequest, XhrMeta>();

  /* `open` is overloaded: (method, url) and (method, url, async, user, pass).
   * `async ?? true` reproduces the spec default for the short form, so both
   * calls reach the browser exactly as the page made them — a wrapper that
   * quietly turned a request synchronous would be a miserable bug to trace back
   * to an extension. */
  xhrProto.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    safely(() => {
      meta.set(this, { method, url: String(url) });
    });

    originalOpen.call(this, method, url, async ?? true, username, password);
  };

  xhrProto.send = function patchedSend(this: XMLHttpRequest, ...args: XhrSendArgs): void {
    safely(() => {
      const info = meta.get(this);
      if (!info || !shouldCapture(info.url)) return;

      this.addEventListener(
        'load',
        () => {
          safely(() => {
            post(
              createApiResponseMessage({
                url: info.url,
                method: info.method,
                status: this.status,
                body: readXhrBody(this),
              }),
            );
          });
        },
        { once: true },
      );
    });
    originalSend.apply(this, args);
  };

  // -------------------------------------------------------------- fetch
  /* Synology's DSM library uses XHR, but the Photos app is a separate React
   * bundle that may well use fetch. Patching both is cheap; guessing wrong and
   * seeing nothing is not. */
  const originalFetch = scope.fetch;

  /** Reads a clone of the response and reports it. Never touches the original. */
  const captureResponse = async (
    response: Response,
    url: string,
    method: string,
  ): Promise<void> => {
    /* The clone is what keeps this safe: consuming the real body would leave
     * the page with an already-read stream — a failure mode nobody would think
     * to blame on an extension. */
    const text = await response.clone().text();

    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Not JSON; the raw text is still the honest answer. */
    }

    post(createApiResponseMessage({ url, method, status: response.status, body }));
  };

  scope.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const promise = originalFetch.call(scope, input, init);

    safely(() => {
      const url = readRequestUrl(input);
      if (!shouldCapture(url)) return;

      const method = readRequestMethod(input, init);

      /* Never await before returning: the page's promise must resolve on its
       * own schedule, not ours. */
      void promise.then(
        (response) => {
          void captureResponse(response, url, method).catch(onError);
        },
        () => {
          /* The page's fetch rejected — its problem to handle, not ours to
           * report. Swallowing here also avoids attaching an unhandled
           * rejection to a promise the page already owns. */
        },
      );
    });

    return promise;
  };

  // ------------------------------------------------------------ history
  /* `pushState`/`replaceState` fire no event, so a SPA can navigate without the
   * ISOLATED world ever noticing. */
  const { history } = scope;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  const notifyHistory = (): void => {
    safely(() => {
      post(createHistoryChangedMessage(scope.location.href));
    });
  };

  history.pushState = function patchedPushState(
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    originalPushState.apply(this, args);
    notifyHistory();
  };

  history.replaceState = function patchedReplaceState(
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    originalReplaceState.apply(this, args);
    notifyHistory();
  };

  return function uninstall(): void {
    xhrProto.open = originalOpen;
    xhrProto.send = originalSend;
    scope.fetch = originalFetch;
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  };
}
