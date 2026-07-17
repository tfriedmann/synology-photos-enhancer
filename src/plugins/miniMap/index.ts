import { findLightboxAddress } from '@/api/selectors';
import { definePlugin } from '@/core/plugin';
import type { SynoGps } from '@/types/synology';
import { injectPageStyles } from '@/ui/pageStyles';
import { createPopup, type Popup } from '@/ui/popup';
import { el, markOnce } from '@/utils/dom';

import { buildMapElement } from './mapView';

/**
 * A map preview of the photo's location, on demand.
 *
 * ## Why a separate plugin, and why it does not fight locationLink
 *
 * `locationLink` owns the address element: click it, a map opens in a new tab.
 * This plugin owns a *different* node — a small 🗺 button it adds beside the
 * address — and opens an in-page preview. Two plugins, two nodes, no conflict.
 * That is the test from the architecture doc (§6): ownership of a node, not
 * subject matter. Both find the address through the shared
 * `findLightboxAddress`, since plugins may not import each other.
 *
 * ## Why on click, not inline
 *
 * A map means fetching tiles from a third party. Rendering inline would send the
 * coordinates of *every geotagged photo you view* to OpenStreetMap,
 * automatically — quietly breaking the extension's "nothing is sent anywhere"
 * promise. So the preview, and the only tile request, happens when you ask for
 * it by clicking. Nothing leaves the browser until then.
 *
 * ## Robustness
 *
 * Tiles are third-party images, and a strict Synology CSP (`img-src`) may block
 * them. The preview therefore always shows the coordinates and an "open larger"
 * link in text; the map is a visual bonus layered on top. If the tiles never
 * load, the popup still does something useful.
 */

const PLUGIN_ID = 'mini-map';
const BUTTON_CLASS = 'spe-minimap-button';

/* The button lives in Synology's DOM (beside their address), so it is injected
 * into the page via `injectPageStyles` — `spe-`-namespaced, per the rule in
 * `pageStyles.ts`. */
const PAGE_STYLES = `
.${BUTTON_CLASS} {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 0 2px;
  cursor: pointer;
  border: none;
  background: none;
  font-size: inherit;
  line-height: 1;
  opacity: 0.75;
}
.${BUTTON_CLASS}:hover {
  opacity: 1;
}
.${BUTTON_CLASS}:focus-visible {
  outline: 2px solid #2b7cff;
  outline-offset: 2px;
  border-radius: 3px;
}
`;

/* The preview renders inside the popup, which lives in the shadow root, so its
 * styles go there via `ui.addStyles` — not into the page. */
const SHADOW_STYLES = `
.spe-minimap-footer {
  font-size: 12px;
}
.spe-minimap-coords {
  color: var(--spe-color-text-muted);
  font-family: ui-monospace, monospace;
}
.spe-minimap-open {
  color: var(--spe-color-accent);
  text-decoration: none;
  white-space: nowrap;
}
.spe-minimap-open:hover {
  text-decoration: underline;
}
.spe-minimap-attribution {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--spe-color-text-muted);
  text-decoration: none;
}
`;

export default definePlugin({
  id: PLUGIN_ID,
  name: 'Mini map',
  description:
    'Adds a 🗺 button that previews the location on a map. Loads tiles only when clicked.',
  enabledByDefault: false,

  setup({ bus, log, ui, signal }) {
    let gps: SynoGps | undefined;
    let popup: Popup | undefined;

    injectPageStyles(PLUGIN_ID, PAGE_STYLES, signal);
    ui.addStyles(SHADOW_STYLES);

    const showPreview = (anchor: HTMLElement): void => {
      if (!gps) return;

      /* One popup, reused. Building the map here — not before — is what keeps
       * the tile request on-demand. */
      popup?.remove();
      popup = createPopup({ signal });
      popup.body.append(buildMapElement(gps));
      ui.container.append(popup.element);
      popup.showAt(anchor);

      log.debug('Preview opened for', gps.latitude, gps.longitude);
    };

    const onButtonClick = (event: Event, anchor: HTMLElement): void => {
      /* Synology's panel handlers sit on the ancestors; without this, opening
       * the preview would also trip them (closing the lightbox, usually). */
      event.stopPropagation();
      event.preventDefault();

      if (popup?.visible) {
        popup.hide();
        return;
      }
      showPreview(anchor);
    };

    /**
     * Ensures the 🗺 button sits beside the address.
     *
     * Idempotent: it runs on every mutation batch. `markOnce` on the *address*
     * is the "have I added my button here?" check, so React rebuilding the
     * panel gets a fresh button without ever stacking two.
     */
    const render = (): void => {
      const address = findLightboxAddress();

      if (!gps || !address) {
        return;
      }

      /* React may have rebuilt the row and dropped our button while leaving a
       * stale marker elsewhere; keying off the live address node avoids that. */
      if (!markOnce(address, 'minimap')) return;

      const button = el('button', {
        className: BUTTON_CLASS,
        text: '🗺',
        attrs: {
          type: 'button',
          'aria-label': 'Preview location on a map',
          title: 'Preview on map',
        },
      });
      button.addEventListener('click', (event) => {
        onButtonClick(event, button);
      });
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      });

      address.after(button);
      log.debug('Map button added');
    };

    bus.on(
      'photo:changed',
      (payload) => {
        gps = payload.gps;
        /* A different photo: the open preview is about the old one. */
        popup?.remove();
        popup = undefined;
        render();
      },
      { signal },
    );

    bus.on('dom:mutation', render, { signal });
  },

  /* `signal` retires the subscriptions, the button listeners and the stylesheet.
   * The button itself lives in Synology's DOM, so it is removed by hand. */
  teardown() {
    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      button.remove();
    }
    for (const marked of document.querySelectorAll<HTMLElement>('[data-spe-minimap]')) {
      delete marked.dataset['speMinimap'];
    }
  },
});
