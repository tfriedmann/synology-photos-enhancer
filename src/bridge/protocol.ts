import { isFiniteNumber, isRecord, isString } from '@/utils/guards';

/**
 * The wire contract between the MAIN world and the ISOLATED world.
 *
 * ## Why a bridge exists at all
 *
 * Two worlds, because Chrome gives us no choice:
 *
 * - Patching `XMLHttpRequest` means patching the *page's* `window`, which only
 *   a MAIN world script can reach. (This is what a Tampermonkey `@grant none`
 *   script gets for free.)
 * - Calling `chrome.*` requires the ISOLATED world, which cannot see the page's
 *   globals.
 *
 * A content script in the ISOLATED world sees a different `XMLHttpRequest`
 * object than the page does, so hooking from there observes nothing.
 * `window.postMessage` is the only channel between the two.
 *
 * ## Trust
 *
 * `postMessage` on a page is a public channel: the host page can read our
 * messages and can forge them, marker and all. That is unavoidable — the MAIN
 * world *is* the page — so this protocol makes no attempt to authenticate.
 * Instead:
 *
 * - `body` stays `unknown` and is narrowed by `src/api/synology.ts` guards.
 * - `readBridgeMessage()` rejects anything not sent by this window at this
 *   origin, which stops cross-frame and cross-origin noise.
 *
 * Nothing here is a secret, and nothing acts on the payload without validating
 * it, so forgery buys an attacker only what they could already do to their own
 * page.
 */

/** Distinguishes our traffic from the page's own `postMessage` chatter. */
export const BRIDGE_MARKER = 'synology-photos-enhancer';

/** Bumped on any breaking payload change; mismatches are dropped, not guessed at. */
export const BRIDGE_VERSION = 1;

interface BridgeEnvelope {
  readonly __spe__: typeof BRIDGE_MARKER;
  readonly v: typeof BRIDGE_VERSION;
}

/** A `/webapi/` call the page made and completed. */
export interface ApiResponseMessage extends BridgeEnvelope {
  readonly type: 'api:response';
  readonly url: string;
  readonly method: string;
  readonly status: number;
  /** Parsed JSON when possible, raw text otherwise, `undefined` if unreadable. */
  readonly body: unknown;
}

/**
 * The page called `pushState`/`replaceState`.
 *
 * Neither fires an event, so without this the ISOLATED world would miss every
 * navigation that does not touch the hash.
 */
export interface HistoryChangedMessage extends BridgeEnvelope {
  readonly type: 'history:changed';
  readonly href: string;
}

export type BridgeMessage = ApiResponseMessage | HistoryChangedMessage;

export function createApiResponseMessage(
  payload: Omit<ApiResponseMessage, '__spe__' | 'v' | 'type'>,
): ApiResponseMessage {
  return { __spe__: BRIDGE_MARKER, v: BRIDGE_VERSION, type: 'api:response', ...payload };
}

export function createHistoryChangedMessage(href: string): HistoryChangedMessage {
  return { __spe__: BRIDGE_MARKER, v: BRIDGE_VERSION, type: 'history:changed', href };
}

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!isRecord(value)) return false;
  if (value['__spe__'] !== BRIDGE_MARKER) return false;
  if (value['v'] !== BRIDGE_VERSION) return false;

  switch (value['type']) {
    case 'api:response':
      return isString(value['url']) && isString(value['method']) && isFiniteNumber(value['status']);
    case 'history:changed':
      return isString(value['href']);
    default:
      return false;
  }
}

/**
 * Validates an incoming `message` event and returns the payload, or `null`.
 *
 * Rejects anything that did not come from this exact window at this exact
 * origin — iframes, other extensions, and cross-origin frames all fail here.
 *
 * @param scope Injected for tests; the real caller passes `window`.
 */
export function readBridgeMessage(event: MessageEvent, scope: Window): BridgeMessage | null {
  /* Same window: a message from an iframe is not ours, even at the same origin. */
  if (event.source !== scope) return null;

  /* Same origin. MAIN world scripts post with an explicit target origin, so a
   * mismatch means the message did not come from our bridge. */
  if (event.origin !== scope.location.origin) return null;

  return isBridgeMessage(event.data) ? event.data : null;
}
