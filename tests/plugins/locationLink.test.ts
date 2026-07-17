import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '@/core/eventBus';
import { createLogger } from '@/core/logger';
import type { PluginContext } from '@/core/plugin';
import { createSettingsStore, DEFAULT_SETTINGS, type SettingsStore } from '@/core/settings';
import locationLink, { findAddressElement } from '@/plugins/locationLink';
import {
  DEFAULT_PROVIDER_ID,
  MAP_PROVIDERS,
  parseOptions,
  resolveProvider,
} from '@/plugins/locationLink/providers';
import type { AppEventMap } from '@/types/events';
import type { SynoGps } from '@/types/synology';

const PARIS: SynoGps = { latitude: 48.85837, longitude: 2.294481 };
const TOKYO: SynoGps = { latitude: 35.7021055555556, longitude: 139.741027777778 };
const ADDRESS_TEXT = '1 Rue de Rivoli, Paris';

const GOOGLE_PARIS = 'https://www.google.com/maps/search/?api=1&query=48.85837%2C2.294481';
const OSM_PARIS =
  'https://www.openstreetmap.org/?mlat=48.85837&mlon=2.294481#map=17/48.85837/2.294481';

/**
 * The lightbox info panel, mirroring the structure the plugin traverses: the
 * location icon and the info block are siblings under a shared parent.
 */
function renderPanel(addressText = ADDRESS_TEXT): HTMLElement {
  document.body.innerHTML = `
    <div class="synofoto-lightbox-info-row">
      <span class="synofoto-indicator-photo-location"></span>
      <div class="synofoto-lightbox-info-block">
        <div class="synofoto-lightbox-info-first-line">Louvre</div>
        <div class="synofoto-lightbox-info-second-line">${addressText}</div>
      </div>
    </div>
  `;
  const address = document.querySelector<HTMLElement>('.synofoto-lightbox-info-second-line');
  if (!address) throw new Error('test setup: address element missing');
  return address;
}

function fakeSettings(options?: unknown): SettingsStore {
  return createSettingsStore({
    area: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
    initial: {
      ...DEFAULT_SETTINGS,
      ...(options !== undefined ? { options: { 'location-link': options } } : {}),
    },
  });
}

function setup(options?: unknown): {
  settings: SettingsStore;
  controller: AbortController;
  openSpy: ReturnType<typeof vi.fn>;
  photoChanged: (gps: SynoGps | undefined) => void;
  mutate: () => void;
} {
  const bus: EventBus<AppEventMap> = createEventBus<AppEventMap>();
  const controller = new AbortController();
  const settings = fakeSettings(options);

  const context = {
    bus,
    settings,
    log: createLogger('test', 'silent'),
    signal: controller.signal,
  } as unknown as PluginContext;

  void locationLink.setup(context);

  const openSpy = vi.fn();
  vi.stubGlobal('open', openSpy);

  return {
    settings,
    controller,
    openSpy,
    photoChanged: (gps) => {
      bus.emit('photo:changed', { item: { id: 1 }, space: 'team', gps });
    },
    mutate: () => {
      bus.emit('dom:mutation', { mutations: [] });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[id^="spe-styles-"]').forEach((n) => {
    n.remove();
  });
});

describe('providers', () => {
  it('builds a documented Google Maps URL', () => {
    expect(resolveProvider({ provider: 'google' }).buildUrl(PARIS)).toBe(GOOGLE_PARIS);
  });

  it('builds an OpenStreetMap URL with both a marker and a view', () => {
    /* `mlat`/`mlon` drop the pin, the `#map=` fragment frames it. Without the
     * fragment OSM centres the map but marks nothing. */
    expect(resolveProvider({ provider: 'osm' }).buildUrl(PARIS)).toBe(OSM_PARIS);
  });

  it('keeps full precision', () => {
    /* Truncating a coordinate moves the pin. */
    for (const provider of MAP_PROVIDERS) {
      expect(provider.buildUrl(TOKYO)).toContain('35.7021055555556');
      expect(provider.buildUrl(TOKYO)).toContain('139.741027777778');
    }
  });

  it('handles negative coordinates', () => {
    const gps = { latitude: -33.8688, longitude: -70.6693 };
    expect(resolveProvider({ provider: 'google' }).buildUrl(gps)).toContain('-33.8688');
    expect(resolveProvider({ provider: 'osm' }).buildUrl(gps)).toContain('mlat=-33.8688');
  });

  it('every provider has a unique id', () => {
    /* Ids are persisted as the user's choice; a duplicate would make the stored
     * preference ambiguous. */
    const ids = MAP_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('parseOptions', () => {
    it('reads a valid stored provider', () => {
      expect(parseOptions({ provider: 'osm' })).toEqual({ provider: 'osm' });
    });

    it('falls back for anything unusable', () => {
      /* Storage is user-editable and survives upgrades, so a provider we
       * removed must not leave someone with a dead link. */
      expect(parseOptions(undefined).provider).toBe(DEFAULT_PROVIDER_ID);
      expect(parseOptions(null).provider).toBe(DEFAULT_PROVIDER_ID);
      expect(parseOptions({}).provider).toBe(DEFAULT_PROVIDER_ID);
      expect(parseOptions({ provider: 'bing-maps-1998' }).provider).toBe(DEFAULT_PROVIDER_ID);
      expect(parseOptions({ provider: 42 }).provider).toBe(DEFAULT_PROVIDER_ID);
      expect(parseOptions('osm').provider).toBe(DEFAULT_PROVIDER_ID);
    });
  });

  it('resolveProvider always returns a provider', () => {
    expect(resolveProvider(undefined).id).toBe(DEFAULT_PROVIDER_ID);
    expect(resolveProvider({ provider: 'nonsense' }).id).toBe(DEFAULT_PROVIDER_ID);
  });
});

describe('findAddressElement', () => {
  it('finds the address through the indicator', () => {
    const address = renderPanel();
    expect(findAddressElement()).toBe(address);
  });

  it('returns undefined when there is no location row', () => {
    /* The normal case for a photo with no geotag — not an error. */
    document.body.innerHTML = '<div class="synofoto-lightbox-info-block"></div>';
    expect(findAddressElement()).toBeUndefined();
  });

  it('returns undefined on an empty document', () => {
    document.body.innerHTML = '';
    expect(findAddressElement()).toBeUndefined();
  });

  it('returns undefined when the chain is broken', () => {
    /* The block is not a sibling of the indicator, so it is not this
     * indicator's block. Matching it anyway would attach one row's location to
     * another. */
    document.body.innerHTML = `
      <div><span class="synofoto-indicator-photo-location"></span></div>
      <div class="synofoto-lightbox-info-block">
        <div class="synofoto-lightbox-info-second-line">elsewhere</div>
      </div>`;
    expect(findAddressElement()).toBeUndefined();
  });
});

describe('locationLink plugin', () => {
  it('makes the address clickable when a geotagged photo opens', () => {
    const address = renderPanel();
    const { photoChanged } = setup();

    photoChanged(PARIS);

    expect(address.classList.contains('spe-location-clickable')).toBe(true);
    expect(address.getAttribute('role')).toBe('link');
    expect(address.getAttribute('tabindex')).toBe('0');
  });

  it('opens the default provider when nothing is configured', () => {
    const address = renderPanel();
    const { photoChanged, openSpy } = setup();
    photoChanged(PARIS);

    address.click();

    expect(openSpy).toHaveBeenCalledExactlyOnceWith(GOOGLE_PARIS, '_blank', 'noopener,noreferrer');
  });

  it('opens the configured provider', () => {
    const address = renderPanel();
    const { photoChanged, openSpy } = setup({ provider: 'osm' });
    photoChanged(PARIS);

    address.click();

    expect(openSpy).toHaveBeenCalledExactlyOnceWith(OSM_PARIS, '_blank', 'noopener,noreferrer');
  });

  it('does nothing for a photo with no location', () => {
    const address = renderPanel();
    const { photoChanged } = setup();

    photoChanged(undefined);

    expect(address.classList.contains('spe-location-clickable')).toBe(false);
  });

  it('injects its stylesheet once', () => {
    setup();
    expect(document.getElementById('spe-styles-location-link')).not.toBeNull();
  });

  describe('reading state at click time', () => {
    /* Both the GPS and the provider are read when the click happens, never
     * baked in at render time. That is what makes staleness unrepresentable. */

    it('never points at the previous photo once the photo changes', () => {
      /* The stale-coordinates bug: React reuses the node and swaps only the
       * text, so an implementation that rebuilds a link only when one is
       * missing keeps the *old* coordinates under the *new* address. */
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();

      photoChanged(PARIS);
      photoChanged(TOKYO);
      address.click();

      expect(openSpy.mock.calls[0]?.[0]).toContain('35.7021055555556');
    });

    it('uses a provider changed after the link was rendered', () => {
      /* Switching provider in the popup must affect the very next click, with
       * no re-render and no subscription. */
      const address = renderPanel();
      const { photoChanged, openSpy, settings } = setup();
      photoChanged(PARIS);

      void settings.setPluginOptions('location-link', { provider: 'osm' });
      address.click();

      expect(openSpy).toHaveBeenCalledExactlyOnceWith(OSM_PARIS, '_blank', 'noopener,noreferrer');
    });
  });

  describe("never destroying Synology's DOM", () => {
    it('leaves the address text exactly as it was', () => {
      const address = renderPanel();
      const { photoChanged } = setup();

      photoChanged(PARIS);

      expect(address.textContent).toBe(ADDRESS_TEXT);
      expect(address.children).toHaveLength(0);
    });

    it("shows the new photo's address after React rewrites the text", () => {
      const address = renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(PARIS);

      /* React updating the text node in place — which would have wiped an
       * injected <a>. */
      address.textContent = '2 Chome-3 Nishishinjuku, Tokyo';
      photoChanged(TOKYO);
      mutate();

      expect(address.textContent).toBe('2 Chome-3 Nishishinjuku, Tokyo');
      expect(address.classList.contains('spe-location-clickable')).toBe(true);
    });
  });

  describe('surviving React', () => {
    it('repairs the class after React strips it', () => {
      const address = renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(PARIS);

      address.className = 'synofoto-lightbox-info-second-line'; // React re-render
      expect(address.classList.contains('spe-location-clickable')).toBe(false);

      mutate();

      expect(address.classList.contains('spe-location-clickable')).toBe(true);
    });

    it('does not stack listeners when the class is repaired', () => {
      /* Re-adding the same listener reference is a DOM no-op. If it were not,
       * every mutation batch would add a handler and one click would open a
       * dozen tabs. */
      const address = renderPanel();
      const { photoChanged, mutate, openSpy } = setup();
      photoChanged(PARIS);

      for (let i = 0; i < 5; i += 1) {
        address.className = 'synofoto-lightbox-info-second-line';
        mutate();
      }
      address.click();

      expect(openSpy).toHaveBeenCalledOnce();
    });

    it('applies to a panel that appears after the photo event', () => {
      /* The common ordering: the API response lands before React has rendered
       * the info panel. */
      document.body.innerHTML = '';
      const { photoChanged, mutate } = setup();

      photoChanged(PARIS);
      const address = renderPanel();
      mutate();

      expect(address.classList.contains('spe-location-clickable')).toBe(true);
    });

    it('handles a node React replaced entirely', () => {
      renderPanel();
      const { photoChanged, mutate, openSpy } = setup();
      photoChanged(PARIS);

      const fresh = renderPanel('Somewhere else');
      mutate();
      fresh.click();

      expect(fresh.classList.contains('spe-location-clickable')).toBe(true);
      expect(openSpy).toHaveBeenCalledOnce();
    });
  });

  describe('coexisting with the host app', () => {
    it("stops the click from reaching Synology's handlers", () => {
      /* Their handlers sit on the ancestors and react to clicks in the panel —
       * typically by closing the lightbox. Opening a map must not also do that. */
      const address = renderPanel();
      const ancestorClick = vi.fn();
      document.body.addEventListener('click', ancestorClick);
      const { photoChanged } = setup();
      photoChanged(PARIS);

      address.click();

      expect(ancestorClick).not.toHaveBeenCalled();
      document.body.removeEventListener('click', ancestorClick);
    });

    it('opens with noopener, so the map gets no handle on the NAS tab', () => {
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();
      photoChanged(PARIS);

      address.click();

      expect(openSpy.mock.calls[0]?.[2]).toContain('noopener');
    });
  });

  describe('keyboard access', () => {
    it.each([['Enter'], [' ']])('opens on %s', (key) => {
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();
      photoChanged(PARIS);

      address.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

      expect(openSpy).toHaveBeenCalledOnce();
    });

    it('ignores other keys', () => {
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();
      photoChanged(PARIS);

      address.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('renderOptions', () => {
    /** `renderOptions` is optional on the Plugin interface, so it is proven present here once. */
    const renderSelect = (settings: SettingsStore): HTMLSelectElement => {
      const node = locationLink.renderOptions?.(settings);
      if (!node) throw new Error('locationLink should render options');
      const select = node.querySelector('select');
      if (!select) throw new Error('no select rendered');
      return select;
    };

    it('lists every provider', () => {
      expect(renderSelect(fakeSettings()).options).toHaveLength(MAP_PROVIDERS.length);
    });

    it('preselects the stored provider', () => {
      expect(renderSelect(fakeSettings({ provider: 'osm' })).value).toBe('osm');
    });

    it('preselects the default when nothing is stored', () => {
      expect(renderSelect(fakeSettings()).value).toBe(DEFAULT_PROVIDER_ID);
    });

    it('falls back for a stored provider that no longer exists', () => {
      /* Someone edits storage, or we drop a provider in a later version. The
       * picker must still show something valid rather than an empty select. */
      expect(renderSelect(fakeSettings({ provider: 'bing-maps-1998' })).value).toBe(
        DEFAULT_PROVIDER_ID,
      );
    });

    it('persists a change', () => {
      const settings = fakeSettings();
      const select = renderSelect(settings);

      select.value = 'osm';
      select.dispatchEvent(new Event('change'));

      expect(parseOptions(settings.getPluginOptions('location-link')).provider).toBe('osm');
    });
  });

  describe('teardown', () => {
    it('leaves the page exactly as it found it', () => {
      const address = renderPanel();
      const { photoChanged, controller } = setup();
      photoChanged(PARIS);

      controller.abort();
      void locationLink.teardown?.();

      expect(address.classList.contains('spe-location-clickable')).toBe(false);
      expect(address.getAttribute('role')).toBeNull();
      expect(address.getAttribute('tabindex')).toBeNull();
      expect(address.textContent).toBe(ADDRESS_TEXT);
      expect(document.getElementById('spe-styles-location-link')).toBeNull();
    });

    it('stops responding to events once aborted', () => {
      const address = renderPanel();
      const { photoChanged, controller, mutate } = setup();
      controller.abort();

      photoChanged(PARIS);
      mutate();

      expect(address.classList.contains('spe-location-clickable')).toBe(false);
    });
  });
});
