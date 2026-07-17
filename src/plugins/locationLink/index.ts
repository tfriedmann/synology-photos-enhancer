import { findLightboxAddress } from '@/api/selectors';
import { definePlugin } from '@/core/plugin';
import type { SettingsStore } from '@/core/settings';
import type { SynoGps } from '@/types/synology';
import { injectPageStyles } from '@/ui/pageStyles';
import { el } from '@/utils/dom';

import { MAP_PROVIDERS, parseOptions, resolveProvider } from './providers';

/**
 * Re-exported for tests. The traversal lives in `api/selectors.ts` because
 * `miniMap` needs the same address element and plugins may not share code
 * directly.
 */
export { findLightboxAddress as findAddressElement } from '@/api/selectors';

/**
 * Makes the photo's location clickable, opening it in the map of your choice.
 *
 * Synology writes the address under the photo but does nothing with it. The GPS
 * is right there in the API response — it just never reaches the UI.
 *
 * ## Why one plugin and not one per map
 *
 * `googleMaps` and `openStreetMap` as separate plugins would target the *same*
 * element and fight over it: two listeners, one click, two tabs. Nor could they
 * negotiate, since plugins may not know about each other. So the plugin owns
 * the element and the maps are data — see `providers.ts`.
 *
 * ## Why it never touches Synology's children
 *
 * The obvious implementation replaces the address line's contents with an `<a>`:
 *
 * ```js
 * address.innerHTML = '';
 * address.appendChild(link);   // don't
 * ```
 *
 * That fights React for a node React owns, and loses in three ways. It
 * **destroys the address text**, leaving nothing to restore. It goes **stale**:
 * if React reuses the node and swaps only the text, the link keeps the
 * *previous* photo's coordinates under the *new* photo's address — pointing at
 * the wrong place, confidently. And it starts a **churn loop**, React rewriting
 * the text and us rebuilding the link, forever.
 *
 * So we add a class, `role`, `tabindex` and a listener to their element, and
 * let CSS supply the 📍 via `::before`. React can re-render as often as it
 * likes: the text stays theirs, and both the GPS *and* the chosen provider are
 * read from live state at click time, so neither can go stale. If React strips
 * our class, the next mutation batch restores it; re-adding the same listener
 * reference is a no-op, so nothing accumulates.
 *
 * Cost to Synology's DOM: one attribute.
 */

const PLUGIN_ID = 'location-link';
const CLICKABLE_CLASS = 'spe-location-clickable';

/* Namespaced to a class we add ourselves — never a `.synofoto-*` selector.
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

export default definePlugin({
  id: PLUGIN_ID,
  name: 'Clickable location',
  description: "Opens the photo's location in a map.",
  enabledByDefault: true,

  setup({ bus, log, settings, signal }) {
    /** The open photo's coordinates. Read at click time, so it cannot be stale. */
    let gps: SynoGps | undefined;

    injectPageStyles(PLUGIN_ID, STYLES, signal);

    const open = (): void => {
      if (!gps) return;

      /* Read at click time, exactly like the GPS: switch provider in the popup
       * and the very next click uses it — no subscription, nothing to
       * invalidate, nothing that can drift out of sync. */
      const provider = resolveProvider(settings.getPluginOptions(PLUGIN_ID));
      const url = provider.buildUrl(gps);

      log.debug('Opening', provider.id, url);
      /* `noopener` is not optional on a `window.open` to a third party: without
       * it the new tab gets a handle back to this one via `window.opener`. */
      window.open(url, '_blank', 'noopener,noreferrer');
    };

    const onClick = (event: Event): void => {
      /* Synology's own handlers sit on this node's ancestors and react to
       * clicks in the info panel. Without this, opening a map also triggers
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
     * Idempotent by design: it runs on every mutation batch. The class is the
     * "have I done this?" check, and re-adding the same listener reference is a
     * DOM no-op, so a node React stripped is repaired for free.
     */
    const render = (): void => {
      const address = findLightboxAddress();
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
     * after `photo:changed` has already fired. Batched to one call per
     * animation frame by the core, so this stays cheap. */
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

  /** The provider picker, shown under this plugin's row in the popup. */
  renderOptions(settings: SettingsStore): HTMLElement {
    const select = el('select', { className: 'select plugin__option' });
    const current = parseOptions(settings.getPluginOptions(PLUGIN_ID)).provider;

    for (const provider of MAP_PROVIDERS) {
      const option = el('option', { text: provider.name, attrs: { value: provider.id } });
      option.selected = provider.id === current;
      select.append(option);
    }

    select.addEventListener('change', () => {
      void settings.setPluginOptions(PLUGIN_ID, { provider: select.value });
    });

    return el('label', {
      className: 'plugin__option-row',
      children: [el('span', { text: 'Open in' }), select],
    });
  },
});
