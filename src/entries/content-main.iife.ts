import { isWebApiUrl } from '@/api/synology';
import { installMainWorldBridge } from '@/bridge/mainWorld';

/**
 * MAIN world entry — runs at `document_start`, in the page's own context.
 *
 * This file is intentionally almost empty. All the logic lives in
 * `bridge/mainWorld.ts`, which takes its scope as a parameter and is therefore
 * unit-tested; an entry point can only ever be exercised in a real browser, so
 * the less it contains, the better.
 *
 * The `.iife` in the filename is not decoration: CRXJS reads it and emits a
 * self-executing bundle instead of an ES module. A module here would be
 * loaded asynchronously and arrive after the app has already made its first
 * requests — patching an XHR that has already been called observes nothing.
 *
 * Nothing here may touch `chrome.*`: this world does not have it. Everything
 * reaches the extension through `postMessage`.
 */

installMainWorldBridge(window, {
  /* Explicit target origin, never '*': the message would otherwise be readable
   * by any frame that happens to be listening. */
  post: (message) => {
    window.postMessage(message, window.location.origin);
  },

  /* Only Synology's own API traffic. Without this we would clone and serialise
   * every image, chunk and analytics beacon the page loads. */
  shouldCapture: isWebApiUrl,

  /* Not silent.
   *
   * This started out as a deliberate no-op — we run in the page's context at
   * document_start, before our logger or settings exist, and console noise here
   * lands in the user's own debugging session.
   *
   * That was the wrong trade. When the bridge failed, it failed without a word,
   * and the only symptom was an extension that did nothing for no visible
   * reason. A failure here means the extension is broken, which is exactly the
   * moment to speak up: `console.error` is the only channel this world has. It
   * only fires when something is already wrong, so it is never noise. */
  onError: (error) => {
    // eslint-disable-next-line no-console
    console.error('[spe:main-world] Network bridge error.', error);
  },
});
