import type { EventBus } from '@/core/eventBus';
import type { AppEventMap } from '@/types/events';

import { readBridgeMessage, type BridgeMessage } from './protocol';

/**
 * The ISOLATED-world end of the bridge: validates what the MAIN world posted
 * and republishes it on the EventBus.
 *
 * This is where untrusted page data becomes a typed application event. It is
 * intentionally the thinnest possible layer — validate, translate, emit — so
 * that plugins never touch `postMessage` and the trust boundary stays in one
 * reviewable place.
 */

export interface IsolatedReceiverOptions {
  readonly bus: EventBus<AppEventMap>;
  /** Called on a `history:changed` message, so the router can re-read location. */
  readonly onHistoryChanged: (href: string) => void;
  readonly signal?: AbortSignal | undefined;
  /** Injected for tests; defaults to the real `window`. */
  readonly scope?: Window | undefined;
}

export function installIsolatedReceiver(options: IsolatedReceiverOptions): void {
  const scope = options.scope ?? window;

  const handle = (message: BridgeMessage): void => {
    switch (message.type) {
      case 'api:response':
        options.bus.emit('api:response', {
          url: message.url,
          method: message.method,
          status: message.status,
          body: message.body,
        });
        return;
      case 'history:changed':
        options.onHistoryChanged(message.href);
        return;
    }
  };

  scope.addEventListener(
    'message',
    (event: MessageEvent) => {
      const message = readBridgeMessage(event, scope);
      if (!message) return;
      handle(message);
    },
    options.signal ? { signal: options.signal } : undefined,
  );
}
