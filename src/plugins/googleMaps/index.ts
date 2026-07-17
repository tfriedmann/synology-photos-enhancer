import { SELECTORS } from '@/api/selectors';
import { definePlugin } from '@/core/plugin';
import type { SynoGps } from '@/types/synology';
import { injectPageStyles } from '@/ui/pageStyles';

/**
 * Makes the photo's location clickable, opening it in Google Maps.
 *
 * Synology writes the address under the photo but does nothing with it. The GPS
 * is right there in the API response — it just never reaches the UI.
 *
 * ## The design decision worth explaining
 *
 * The obvious implementation — the one the original userscript used, and the
 * one anyone writes first — is to replace the address line's contents with an
 * `<a>`:
 *
 * ```js
 * address.innerHTML = '';
 * address.appendChild(link);   // don't
 * ```
 *
 * That fights React for ownership of a node React owns, and loses in three
 * ways. It **destroys the address text**, so there is nothing to restore if we
 * later need to undo. It goes **stale**: if React reuses the node and only
 * swaps the text, our link keeps the *previous* photo's coordinates while
 * showing the *new* photo's address — pointing at the wrong place, confidently.
 * And it starts a **churn loop**, where React rewrites the text, we rebuild the
 * link, forever.
 *
 * So we never touch their children. We add a class, `role`, `tabindex` and a
 * listener to their element, and let CSS supply the 📍 via `::before`. React can
 * re-render the text as often as it likes — the text is still theirs, and the
 * handler reads the current GPS from this closure at click time, so it cannot
 * go stale. If React strips our class, the next mutation batch puts it back;
 * re-adding the same listener reference is a no-op, so nothing accumulates.
 *
 * The result is a plugin that costs Synology's DOM exactly one attribute.
 */

const PLUGIN_ID = 'google-maps';
const CLICKABLE_CLASS = 'spe-maps-clickable';

/* Namespaced to classes we add ourselves — never a `.synofoto-*` selector.
 * See `injectPageStyles`. */
const STYLES = `
.${CLICKABLE_CLASS} {
  cursor: pointer;
  color: #2b7cff;
  text-decoration: none;
  border-radius: 3px;
}
.${CLICKABLE_CLASS}::before {
  content: '📍 ';
}
.${CLICKABLE_CLASS}:hover {
  text-decoration: underline;
}
.${CLICKABLE_CLASS}:focus-visible {
  outline: 2px solid #2b7cff;
  outline-offset: 2px;
}
`;

/**
 * Builds a Google Maps URL.
 *
 * Uses the documented Maps URL API rather than the shorter `?q=lat,lng`: the
 * latter is a legacy form Google has never committed to, and this costs nothing.
 */
export function buildMapsUrl(gps: SynoGps): string {
  const query = encodeURIComponent(`${String(gps.latitude)},${String(gps.longitude)}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * Finds the address line in the lightbox info panel.
 *
 * Mirrors the app's structure: the location icon and the info block are
 * siblings, so we reach the address through their shared parent. Returns
 * `undefined` whenever any link in the chain is missing — which is the normal
 * case for a photo with no location, not an error.
 */
export function findAddressElement(root: ParentNode = document): HTMLElement | undefined {
  const indicator = root.querySelector(SELECTORS.locationIndicator);
  const block = indicator?.parentElement?.querySelector(SELECTORS.infoBlock);
  return block?.querySelector<HTMLElement>(SELECTORS.infoSecondLine) ?? undefined;
}

export default definePlugin({
  id: PLUGIN_ID,
  name: 'Google Maps',
  description: "Makes the photo's location clickable and opens it in Google Maps.",
  enabledByDefault: true,

  setup({ bus, log, signal }) {
    /** The open photo's coordinates. Read at click time, so it can never be stale. */
    let gps: SynoGps | undefined;

    injectPageStyles(PLUGIN_ID, STYLES, signal);

    const open = (): void => {
      if (!gps) return;
      const url = buildMapsUrl(gps);
      log.debug('Opening', url);
      /* `noopener` is not optional on a `window.open` to a third party: without
       * it the new tab gets a handle back to this one via `window.opener`. */
      window.open(url, '_blank', 'noopener,noreferrer');
    };

    const onClick = (event: Event): void => {
      /* Synology's own handlers sit on the ancestors of this node and react to
       * clicks in the info panel. Without this, opening Maps also triggers
       * whatever they do — closing the lightbox, typically. */
      event.stopPropagation();
      event.preventDefault();
      open();
    };

    const onKeydown = (event: KeyboardEvent): void => {
      /* We made a div behave like a link, so we owe it the keyboard behaviour a
       * real link would have had. */
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.stopPropagation();
      event.preventDefault();
      open();
    };

    /**
     * Ensures the address element is marked up as clickable.
     *
     * Idempotent by design: it is called on every mutation batch. The class is
     * the "have I done this?" check, and re-adding the same listener reference
     * is a no-op in the DOM, so a node React stripped is repaired for free.
     */
    const render = (): void => {
      const address = findAddressElement();
      if (!address) return;

      if (!gps) {
        /* No location for this photo. Synology normally drops the whole row, so
         * this mostly guards the case where they reuse the node instead. */
        if (address.classList.contains(CLICKABLE_CLASS)) {
          address.classList.remove(CLICKABLE_CLASS);
          address.removeAttribute('role');
          address.removeAttribute('tabindex');
        }
        return;
      }

      if (address.classList.contains(CLICKABLE_CLASS)) return;

      address.classList.add(CLICKABLE_CLASS);
      address.setAttribute('role', 'link');
      address.setAttribute('tabindex', '0');
      address.addEventListener('click', onClick, { signal });
      address.addEventListener('keydown', onKeydown, { signal });

      log.debug('Location is now clickable');
    };

    bus.on(
      'photo:changed',
      (payload) => {
        gps = payload.gps;
        render();
      },
      { signal },
    );

    /* React rebuilds the info panel constantly, and the panel often appears
     * after `photo:changed` has already fired. Batched to one call per animation
     * frame by the core, so this stays cheap. */
    bus.on('dom:mutation', render, { signal });
  },

  /* `signal` already retires both subscriptions, both DOM listeners and the
   * stylesheet. Only the marks we left on Synology's own element need undoing
   * by hand — which is the entire reason this plugin has a teardown at all. */
  teardown() {
    for (const node of document.querySelectorAll(`.${CLICKABLE_CLASS}`)) {
      node.classList.remove(CLICKABLE_CLASS);
      node.removeAttribute('role');
      node.removeAttribute('tabindex');
    }
  },
});
