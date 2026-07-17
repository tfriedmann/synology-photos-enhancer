/**
 * Origin handling, shared by the popup and the service worker.
 *
 * It lives in `utils/` rather than next to its main consumer in
 * `background.ts` for a concrete reason: importing it from the popup would drag
 * the whole service worker module in — its `chrome.runtime.onInstalled`
 * listeners, its `?iife` script imports and all — into the popup bundle, and
 * run those side effects in the wrong context. A pure function with no imports
 * cannot do that to anyone.
 */

/**
 * Converts a tab URL into the match pattern Chrome's permission APIs expect.
 *
 * Deliberately narrow: exactly one origin, never a wildcard host. The user
 * grants access to their NAS, not to a domain we guessed at.
 *
 * @returns `undefined` for anything not grantable — `chrome://`, `file://`,
 * `about:blank`, or a malformed URL.
 *
 * @example
 * toOriginPattern('https://nas:5001/photo/#/timeline') // → 'https://nas:5001/*'
 */
export function toOriginPattern(url: string): string | undefined {
  try {
    const { protocol, host } = new URL(url);

    /* Only http(s) can be granted as a host permission, and Synology Photos is
     * never served over anything else. Note `host` (not `hostname`): the port
     * is part of the origin, and Synology installs live on custom ports far
     * more often than not. */
    if (protocol !== 'https:' && protocol !== 'http:') return undefined;
    if (host === '') return undefined;

    return `${protocol}//${host}/*`;
  } catch {
    return undefined;
  }
}

/** Strips the trailing `/*` for display. */
export function originPatternToDisplay(pattern: string): string {
  return pattern.replace(/\/\*$/, '');
}
