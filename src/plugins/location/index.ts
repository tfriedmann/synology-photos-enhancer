import { findLightboxAddress } from '@/api/selectors';
import { definePlugin } from '@/core/plugin';
import type { SettingsStore } from '@/core/settings';
import type { SynoGps } from '@/types/synology';
import { injectPageStyles } from '@/ui/pageStyles';
import { createPopup, type Popup } from '@/ui/popup';
import { el, markOnce } from '@/utils/dom';

import { buildMapElement } from './mapView';
import { MAP_PROVIDERS, parseOptions, resolveProvider } from './providers';

/**
 * Everything about a photo's location, in one plugin.
 *
 * It does two things:
 *
 * - **Makes the address clickable** — click it, the location opens in your
 *   chosen map (Google or OpenStreetMap) in a new tab.
 * - **Previews the location** — an optional 🗺 button beside the address opens
 *   an in-page map.
 *
 * ## Why one plugin, not two
 *
 * These began as `locationLink` and `miniMap`. They are back together because
 * they must **share one setting**: the map provider. A plugin cannot read
 * another plugin's options — that is the coupling the architecture forbids — so
 * two plugins sharing a preference is the same smell as two plugins fighting
 * over a node (see `docs/ARCHITECTURE.md` §6). "The photo's location" is one
 * feature with two presentations, not two features.
 *
 * A single plugin owning two nodes (the address text and the 🗺 button) is fine;
 * the rule only forbids *two plugins* owning the *same* node.
 *
 * ## Why the plugin never destroys Synology's DOM
 *
 * The address stays Synology's. We add a class, `role`, `tabindex` and a
 * listener to their element and read the GPS and provider at **click time**, so
 * nothing we hold can go stale when React reuses the node and swaps only the
 * text. Replacing its contents with an `<a>` would destroy the address, point
 * at the previous photo after a change, and loop against React. Cost to their
 * DOM: one attribute, plus the sibling button.
 *
 * ## Why the preview is opt-in
 *
 * The link sends nothing until you click it. The preview is different: it
 * fetches tiles from OpenStreetMap. Rendering it inline would leak the location
 * of every geotagged photo you view; even the button is off by default, and the
 * tiles load only when it is clicked. See `mapView.ts`.
 */

const PLUGIN_ID = 'location';
const CLICKABLE_CLASS = 'spe-location-clickable';
const BUTTON_CLASS = 'spe-location-preview-button';

/* Injected into the page (light DOM) because both the clickable address and the
 * button live in Synology's tree. `spe-`-namespaced, per `pageStyles.ts`. */
const PAGE_STYLES = `
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
.${BUTTON_CLASS} {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 0 2px;
  border: none;
  background: none;
  font-size: inherit;
  line-height: 1;
  cursor: pointer;
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
 * styles go there via `ui.addStyles`. */
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
.spe-minimap-zoom-controls {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.spe-minimap-zoom {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: rgb(255 255 255 / 92%);
  color: #1c1c1e;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
}
.spe-minimap-zoom:hover:not([disabled]) {
  background: #fff;
}
.spe-minimap-zoom[disabled] {
  opacity: 0.4;
  cursor: default;
}
.spe-minimap-zoom:focus-visible {
  outline: 2px solid var(--spe-color-accent);
  outline-offset: 1px;
}
`;

/** Re-exported for tests; the traversal lives in `api/selectors.ts`. */
export { findLightboxAddress as findAddressElement } from '@/api/selectors';

export default definePlugin({
  id: PLUGIN_ID,
  name: 'Location',
  description: "Opens the photo's location in a map, with an optional in-page preview.",
  enabledByDefault: true,

  setup({ bus, log, settings, ui, signal }) {
    /** Read at click time, so neither can be stale. */
    let gps: SynoGps | undefined;
    let popup: Popup | undefined;

    const options = (): ReturnType<typeof parseOptions> =>
      parseOptions(settings.getPluginOptions(PLUGIN_ID));

    injectPageStyles(PLUGIN_ID, PAGE_STYLES, signal);
    ui.addStyles(SHADOW_STYLES);

    // ------------------------------------------------------------ the link
    const openInMap = (): void => {
      if (!gps) return;
      const provider = resolveProvider(settings.getPluginOptions(PLUGIN_ID));
      const url = provider.buildUrl(gps);
      log.debug('Opening', provider.id, url);
      /* `noopener` on a third-party `window.open` — otherwise the new tab gets a
       * handle back to this one. */
      window.open(url, '_blank', 'noopener,noreferrer');
    };

    const onAddressClick = (event: Event): void => {
      /* Synology's ancestor handlers react to panel clicks (closing the
       * lightbox). Stop the event before it reaches them. */
      event.stopPropagation();
      event.preventDefault();
      openInMap();
    };

    const onAddressKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.stopPropagation();
      event.preventDefault();
      openInMap();
    };

    // --------------------------------------------------------- the preview
    const showPreview = (anchor: HTMLElement): void => {
      if (!gps) return;
      const provider = resolveProvider(settings.getPluginOptions(PLUGIN_ID));

      /* Building the map here — not before — is what keeps the tile request
       * on-demand. */
      popup?.remove();
      popup = createPopup({ signal });
      popup.body.append(buildMapElement(gps, provider.buildUrl(gps)));
      ui.container.append(popup.element);
      popup.showAt(anchor);
      log.debug('Preview opened');
    };

    const onButtonClick = (event: Event, anchor: HTMLElement): void => {
      event.stopPropagation();
      event.preventDefault();
      if (popup?.visible) {
        popup.hide();
        return;
      }
      showPreview(anchor);
    };

    // ------------------------------------------------------------ wiring up
    /**
     * Brings the address and (if enabled) the button into their marked-up
     * state. Idempotent: it runs on every mutation batch, so a node React
     * rebuilt is repaired for free and never doubled.
     */
    const render = (): void => {
      const address = findLightboxAddress();
      if (!address) return;

      const { preview } = options();

      if (!gps) {
        /* No location on this photo. Synology usually drops the row, so this
         * mostly handles a reused node. */
        if (address.classList.contains(CLICKABLE_CLASS)) {
          address.classList.remove(CLICKABLE_CLASS);
          address.removeAttribute('role');
          address.removeAttribute('tabindex');
        }
        return;
      }

      if (!address.classList.contains(CLICKABLE_CLASS)) {
        address.classList.add(CLICKABLE_CLASS);
        address.setAttribute('role', 'link');
        address.setAttribute('tabindex', '0');
        address.addEventListener('click', onAddressClick, { signal });
        address.addEventListener('keydown', onAddressKey, { signal });
        log.debug('Address is now clickable');
      }

      /* `markOnce` on the address is the "does my button already sit here?"
       * check, keyed to the live node so a rebuilt panel gets a fresh button. */
      if (preview && markOnce(address, 'preview')) {
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
        log.debug('Preview button added');
      }
    };

    bus.on(
      'photo:changed',
      (payload) => {
        gps = payload.gps;
        /* The open preview is about the previous photo. */
        popup?.remove();
        popup = undefined;
        render();
      },
      { signal },
    );

    bus.on('dom:mutation', render, { signal });
  },

  /* `signal` retires the subscriptions, listeners and stylesheet. Only the marks
   * on Synology's own nodes need undoing by hand. */
  teardown() {
    for (const node of document.querySelectorAll(`.${CLICKABLE_CLASS}`)) {
      node.classList.remove(CLICKABLE_CLASS);
      node.removeAttribute('role');
      node.removeAttribute('tabindex');
    }
    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      button.remove();
    }
    for (const marked of document.querySelectorAll<HTMLElement>('[data-spe-preview]')) {
      delete marked.dataset['spePreview'];
    }
  },

  /** Provider picker plus the preview toggle, under this plugin's popup row. */
  renderOptions(settings: SettingsStore): HTMLElement {
    const { provider: currentProvider, preview } = parseOptions(
      settings.getPluginOptions(PLUGIN_ID),
    );

    const select = el('select', { className: 'select plugin__option' });
    for (const provider of MAP_PROVIDERS) {
      const option = el('option', { text: provider.name, attrs: { value: provider.id } });
      option.selected = provider.id === currentProvider;
      select.append(option);
    }
    const persist = (patch: { provider?: string; preview?: boolean }): void => {
      const now = parseOptions(settings.getPluginOptions(PLUGIN_ID));
      void settings.setPluginOptions(PLUGIN_ID, { ...now, ...patch });
    };
    select.addEventListener('change', () => {
      persist({ provider: select.value });
    });

    const providerRow = el('label', {
      className: 'plugin__option-row',
      children: [el('span', { text: 'Open in' }), select],
    });

    const previewCheckbox = el('input', {
      className: 'plugin__option',
      attrs: { type: 'checkbox', id: 'spe-location-preview' },
    });
    previewCheckbox.checked = preview;
    previewCheckbox.addEventListener('change', () => {
      persist({ preview: previewCheckbox.checked });
    });
    const previewRow = el('label', {
      className: 'plugin__option-row',
      attrs: { for: 'spe-location-preview' },
      children: [
        previewCheckbox,
        el('span', { text: 'Show map preview button (loads tiles on click)' }),
      ],
    });

    return el('div', { children: [providerRow, previewRow] });
  },
});
