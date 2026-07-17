import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '@/core/eventBus';
import { createLogger } from '@/core/logger';
import type { PluginContext, PluginUi } from '@/core/plugin';
import { createSettingsStore, DEFAULT_SETTINGS, type SettingsStore } from '@/core/settings';
import location, { findAddressElement } from '@/plugins/location';
import { clampZoom, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from '@/plugins/location/mapView';
import {
  DEFAULT_PROVIDER_ID,
  MAP_PROVIDERS,
  parseOptions,
  resolveProvider,
} from '@/plugins/location/providers';
import type { AppEventMap } from '@/types/events';
import type { SynoGps } from '@/types/synology';

const PARIS: SynoGps = { latitude: 48.8566, longitude: 2.3522 };
const TOKYO: SynoGps = { latitude: 35.6762, longitude: 139.6503 };
const ADDRESS_TEXT = '1 Rue de Rivoli, Paris';

const GOOGLE_PARIS = 'https://www.google.com/maps/search/?api=1&query=48.8566%2C2.3522';
const OSM_PARIS = 'https://www.openstreetmap.org/?mlat=48.8566&mlon=2.3522#map=17/48.8566/2.3522';

function renderPanel(addressText = ADDRESS_TEXT): HTMLElement {
  document.body.innerHTML = `
    <div class="synofoto-lightbox-info-row">
      <span class="synofoto-indicator-photo-location"></span>
      <div class="synofoto-lightbox-info-block">
        <div class="synofoto-lightbox-info-first-line">Paris</div>
        <div class="synofoto-lightbox-info-second-line">${addressText}</div>
      </div>
    </div>
  `;
  const address = document.querySelector<HTMLElement>('.synofoto-lightbox-info-second-line');
  if (!address) throw new Error('test setup: address missing');
  return address;
}

let container: HTMLElement;

function fakeSettings(options?: unknown): SettingsStore {
  return createSettingsStore({
    area: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
    initial: {
      ...DEFAULT_SETTINGS,
      ...(options !== undefined ? { options: { location: options } } : {}),
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

  container = document.createElement('div');
  document.body.append(container);
  const ui: PluginUi = { container, addStyles: vi.fn() };

  const context = {
    bus,
    ui,
    settings,
    log: createLogger('test', 'silent'),
    signal: controller.signal,
  } as unknown as PluginContext;

  void location.setup(context);

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

const previewButton = (): HTMLButtonElement | null =>
  document.querySelector('.spe-location-preview-button');

afterEach(() => {
  vi.unstubAllGlobals();
  void location.teardown?.();
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
    expect(resolveProvider({ provider: 'osm' }).buildUrl(PARIS)).toBe(OSM_PARIS);
  });

  it('every provider has a unique id', () => {
    const ids = MAP_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('parseOptions', () => {
    it('reads a valid stored value', () => {
      expect(parseOptions({ provider: 'osm', preview: true })).toEqual({
        provider: 'osm',
        preview: true,
      });
    });

    it('defaults the provider and leaves preview off', () => {
      expect(parseOptions(undefined)).toEqual({ provider: DEFAULT_PROVIDER_ID, preview: false });
      expect(parseOptions({})).toEqual({ provider: DEFAULT_PROVIDER_ID, preview: false });
    });

    it('recovers field by field', () => {
      /* A bad provider must not also discard the preview choice. */
      expect(parseOptions({ provider: 'bing-1998', preview: true })).toEqual({
        provider: DEFAULT_PROVIDER_ID,
        preview: true,
      });
    });

    it('treats any non-true preview value as off', () => {
      /* The safe default for something that talks to a third party. */
      expect(parseOptions({ preview: 'yes' }).preview).toBe(false);
      expect(parseOptions({ preview: 1 }).preview).toBe(false);
    });
  });
});

describe('findAddressElement', () => {
  it('finds the address through the indicator', () => {
    const address = renderPanel();
    expect(findAddressElement()).toBe(address);
  });

  it('returns undefined when the chain is broken', () => {
    document.body.innerHTML = `
      <div><span class="synofoto-indicator-photo-location"></span></div>
      <div class="synofoto-lightbox-info-block">
        <div class="synofoto-lightbox-info-second-line">elsewhere</div>
      </div>`;
    expect(findAddressElement()).toBeUndefined();
  });
});

describe('the clickable address', () => {
  it('marks the address clickable for a geotagged photo', () => {
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

  describe('reading state at click time', () => {
    it('never points at the previous photo', () => {
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();

      photoChanged(PARIS);
      photoChanged(TOKYO);
      address.click();

      expect(openSpy.mock.calls[0]?.[0]).toContain('35.6762');
    });

    it('uses a provider changed after the link was rendered', () => {
      const address = renderPanel();
      const { photoChanged, openSpy, settings } = setup();
      photoChanged(PARIS);

      void settings.setPluginOptions('location', { provider: 'osm' });
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

    it('keeps working after React rewrites the text in place', () => {
      const address = renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(PARIS);

      address.textContent = '2 Chome-3 Nishishinjuku, Tokyo';
      photoChanged(TOKYO);
      mutate();

      expect(address.textContent).toBe('2 Chome-3 Nishishinjuku, Tokyo');
      expect(address.classList.contains('spe-location-clickable')).toBe(true);
    });
  });

  describe('coexisting with the host app', () => {
    it("stops the click from reaching Synology's handlers", () => {
      const address = renderPanel();
      const ancestorClick = vi.fn();
      document.body.addEventListener('click', ancestorClick);
      const { photoChanged } = setup();
      photoChanged(PARIS);

      address.click();

      expect(ancestorClick).not.toHaveBeenCalled();
      document.body.removeEventListener('click', ancestorClick);
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

  describe('surviving React', () => {
    it('repairs the class after React strips it', () => {
      const address = renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(PARIS);

      address.className = 'synofoto-lightbox-info-second-line';
      mutate();

      expect(address.classList.contains('spe-location-clickable')).toBe(true);
    });

    it('applies to a panel that appears after the photo event', () => {
      document.body.innerHTML = '';
      const { photoChanged, mutate } = setup();

      photoChanged(PARIS);
      const address = renderPanel();
      mutate();

      expect(address.classList.contains('spe-location-clickable')).toBe(true);
    });
  });
});

describe('the map preview', () => {
  it('adds no button when preview is off (the default)', () => {
    renderPanel();
    const { photoChanged } = setup();

    photoChanged(PARIS);

    expect(previewButton()).toBeNull();
  });

  it('adds the button beside the address when preview is on', () => {
    const address = renderPanel();
    const { photoChanged } = setup({ preview: true });

    photoChanged(PARIS);

    expect(previewButton()).not.toBeNull();
    expect(address.nextElementSibling).toBe(previewButton());
  });

  it('adds no button for a photo with no location', () => {
    renderPanel();
    const { photoChanged } = setup({ preview: true });

    photoChanged(undefined);

    expect(previewButton()).toBeNull();
  });

  describe('on demand: no request until the click', () => {
    it('loads no tile from opening a photo', () => {
      /* The privacy line. Viewing a photo must fetch nothing; the DOM proves
       * it — no <img> exists until the button is clicked. */
      renderPanel();
      const { photoChanged } = setup({ preview: true });

      photoChanged(PARIS);

      expect(container.querySelector('img')).toBeNull();
    });

    it('renders OSM tiles only after the button is clicked', () => {
      renderPanel();
      const { photoChanged } = setup({ preview: true });
      photoChanged(PARIS);

      previewButton()?.click();

      const tiles = container.querySelectorAll('img');
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles[0]?.getAttribute('src')).toMatch(/tile\.openstreetmap\.org/);
    });
  });

  describe('the preview content', () => {
    it('shows the coordinates as text (useful even if a CSP blocks tiles)', () => {
      renderPanel();
      const { photoChanged } = setup({ preview: true });
      photoChanged(PARIS);
      previewButton()?.click();

      expect(container.querySelector('.spe-minimap-coords')?.textContent).toBe('48.85660, 2.35220');
    });

    it('points "open larger" at the chosen provider, not always OSM', () => {
      /* The whole reason for the merge: the tiles are OSM, but the link follows
       * the user's provider. */
      renderPanel();
      const { photoChanged } = setup({ provider: 'google', preview: true });
      photoChanged(PARIS);
      previewButton()?.click();

      const link = container.querySelector<HTMLAnchorElement>('.spe-minimap-open');
      expect(link?.href).toBe(GOOGLE_PARIS);
    });

    it('links to OSM when OSM is the provider', () => {
      renderPanel();
      const { photoChanged } = setup({ provider: 'osm', preview: true });
      photoChanged(PARIS);
      previewButton()?.click();

      const link = container.querySelector<HTMLAnchorElement>('.spe-minimap-open');
      expect(link?.href).toBe(OSM_PARIS);
    });

    it('always shows OSM attribution, since the tiles are always OSM', () => {
      renderPanel();
      const { photoChanged } = setup({ provider: 'google', preview: true });
      photoChanged(PARIS);
      previewButton()?.click();

      const attr = container.querySelector<HTMLAnchorElement>('.spe-minimap-attribution');
      expect(attr?.href).toContain('openstreetmap.org/copyright');
    });

    it('removes a tile that fails to load rather than showing a broken image', () => {
      renderPanel();
      const { photoChanged } = setup({ preview: true });
      photoChanged(PARIS);
      previewButton()?.click();

      const tile = container.querySelector('img');
      tile?.dispatchEvent(new Event('error'));

      expect(container.contains(tile)).toBe(false);
      expect(container.querySelector('.spe-minimap-coords')).not.toBeNull();
    });
  });

  describe('clampZoom', () => {
    /* Tested directly, not only through the buttons: it is the guard for any
     * future entry point (keyboard, wheel) that lacks a disabled state. */
    it('holds within the tile bounds', () => {
      expect(clampZoom(MIN_ZOOM - 5)).toBe(MIN_ZOOM);
      expect(clampZoom(MAX_ZOOM + 5)).toBe(MAX_ZOOM);
      expect(clampZoom(DEFAULT_ZOOM)).toBe(DEFAULT_ZOOM);
    });
  });

  describe('zoom', () => {
    const zoomIn = (): HTMLButtonElement | null =>
      container.querySelector('.spe-minimap-zoom[aria-label="Zoom in"]');
    const zoomOut = (): HTMLButtonElement | null =>
      container.querySelector('.spe-minimap-zoom[aria-label="Zoom out"]');
    const tileZoom = (): string | undefined => {
      /* The z in .../tile/{z}/{x}/{y}.png reflects the current zoom. */
      const src = container.querySelector('img')?.getAttribute('src') ?? '';
      return /openstreetmap\.org\/(\d+)\//.exec(src)?.[1];
    };

    const open = () => {
      renderPanel();
      const ctx = setup({ preview: true });
      ctx.photoChanged(PARIS);
      previewButton()?.click();
      return ctx;
    };

    it('starts at the default zoom', () => {
      open();
      expect(tileZoom()).toBe('15');
    });

    it('zooms in and refetches tiles at the higher level', () => {
      open();
      zoomIn()?.click();
      expect(tileZoom()).toBe('16');
    });

    it('zooms out', () => {
      open();
      zoomOut()?.click();
      expect(tileZoom()).toBe('14');
    });

    it('keeps the marker centred after zooming', () => {
      /* The preview recentres on the photo at every level — it never pans. */
      open();
      zoomIn()?.click();
      const marker = [...container.querySelectorAll<HTMLElement>('.spe-minimap-canvas > div')].find(
        (n) => n.textContent === '📍',
      );
      expect(marker?.style.left).toBe('130px');
      expect(marker?.style.top).toBe('90px');
    });

    it('disables zoom-in at the maximum', () => {
      open();
      for (let i = 0; i < 40; i += 1) zoomIn()?.click();
      expect(tileZoom()).toBe('19');
      expect(zoomIn()?.disabled).toBe(true);
      expect(zoomOut()?.disabled).toBe(false);
    });

    it('disables zoom-out at the minimum', () => {
      open();
      for (let i = 0; i < 40; i += 1) zoomOut()?.click();
      expect(tileZoom()).toBe('3');
      expect(zoomOut()?.disabled).toBe(true);
    });

    it('does not close the preview when a zoom button is clicked', () => {
      /* The zoom click must not bubble to the toggle or the dismiss handler. */
      open();
      zoomIn()?.click();
      expect(container.querySelector('.spe-minimap')).not.toBeNull();
      expect(container.querySelector<HTMLElement>('.spe-popup')?.hidden).toBe(false);
    });

    it("keeps the zoom click away from Synology's handlers", () => {
      /* The popup lives in the shadow root but its events still bubble to the
       * document across the boundary, so a zoom click without stopPropagation
       * would reach Synology's ancestor handlers (which close the lightbox). */
      const ancestorClick = vi.fn();
      document.body.addEventListener('click', ancestorClick);
      open();

      zoomIn()?.click();

      expect(ancestorClick).not.toHaveBeenCalled();
      document.body.removeEventListener('click', ancestorClick);
    });

    it('resets to the default zoom on a fresh preview', () => {
      const ctx = open();
      zoomIn()?.click();
      zoomIn()?.click();
      expect(tileZoom()).toBe('17');

      /* Reopen for another photo: a new preview starts fresh. */
      ctx.photoChanged(TOKYO);
      previewButton()?.click();
      expect(tileZoom()).toBe('15');
    });
  });

  describe('interaction', () => {
    it('toggles the preview off on a second click', () => {
      renderPanel();
      const { photoChanged } = setup({ preview: true });
      photoChanged(PARIS);

      previewButton()?.click();
      expect(container.querySelector('.spe-minimap')).not.toBeNull();

      previewButton()?.click();
      expect(container.querySelector<HTMLElement>('.spe-popup')?.hidden).toBe(true);
    });

    it('drops the open preview when the photo changes', () => {
      renderPanel();
      const { photoChanged } = setup({ preview: true });
      photoChanged(PARIS);
      previewButton()?.click();

      photoChanged(TOKYO);

      expect(container.querySelector('.spe-minimap')).toBeNull();
      previewButton()?.click();
      expect(container.querySelector('.spe-minimap-coords')?.textContent).toContain('35.67620');
    });
  });

  describe('surviving React', () => {
    it('re-adds the button after React rebuilds the panel', () => {
      renderPanel();
      const { photoChanged, mutate } = setup({ preview: true });
      photoChanged(PARIS);
      expect(previewButton()).not.toBeNull();

      renderPanel();
      mutate();

      expect(previewButton()).not.toBeNull();
    });

    it('never adds two buttons to the same address', () => {
      renderPanel();
      const { photoChanged, mutate } = setup({ preview: true });
      photoChanged(PARIS);

      for (let i = 0; i < 5; i += 1) mutate();

      expect(document.querySelectorAll('.spe-location-preview-button')).toHaveLength(1);
    });
  });
});

describe('renderOptions', () => {
  const render = (settings: SettingsStore): HTMLElement => {
    const node = location.renderOptions?.(settings);
    if (!node) throw new Error('location should render options');
    return node;
  };
  const findSelect = (settings: SettingsStore): HTMLSelectElement => {
    const node = render(settings).querySelector('select');
    if (!node) throw new Error('no select rendered');
    return node;
  };
  const findCheckbox = (settings: SettingsStore): HTMLInputElement => {
    const node = render(settings).querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!node) throw new Error('no checkbox rendered');
    return node;
  };

  it('lists every provider', () => {
    expect(findSelect(fakeSettings()).options).toHaveLength(MAP_PROVIDERS.length);
  });

  it('preselects the stored provider', () => {
    expect(findSelect(fakeSettings({ provider: 'osm' })).value).toBe('osm');
  });

  it('falls back for a provider that no longer exists', () => {
    expect(findSelect(fakeSettings({ provider: 'bing-1998' })).value).toBe(DEFAULT_PROVIDER_ID);
  });

  it('reflects the stored preview flag', () => {
    expect(findCheckbox(fakeSettings({ preview: true })).checked).toBe(true);
    expect(findCheckbox(fakeSettings()).checked).toBe(false);
  });

  it('persists a provider change without touching preview', () => {
    const settings = fakeSettings({ preview: true });
    const select = findSelect(settings);

    select.value = 'osm';
    select.dispatchEvent(new Event('change'));

    expect(parseOptions(settings.getPluginOptions('location'))).toEqual({
      provider: 'osm',
      preview: true,
    });
  });

  it('persists a preview change without touching the provider', () => {
    const settings = fakeSettings({ provider: 'osm' });
    const checkbox = findCheckbox(settings);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    expect(parseOptions(settings.getPluginOptions('location'))).toEqual({
      provider: 'osm',
      preview: true,
    });
  });
});

describe('teardown', () => {
  it('leaves the page exactly as it found it', () => {
    const address = renderPanel();
    const { photoChanged, controller } = setup({ preview: true });
    photoChanged(PARIS);
    expect(previewButton()).not.toBeNull();

    controller.abort();
    void location.teardown?.();

    expect(address.classList.contains('spe-location-clickable')).toBe(false);
    expect(address.getAttribute('role')).toBeNull();
    expect(previewButton()).toBeNull();
    expect(address.textContent).toBe(ADDRESS_TEXT);
  });

  it('stops responding once aborted', () => {
    const address = renderPanel();
    const { photoChanged, controller, mutate } = setup({ preview: true });
    controller.abort();

    photoChanged(PARIS);
    mutate();

    expect(address.classList.contains('spe-location-clickable')).toBe(false);
    expect(previewButton()).toBeNull();
  });
});
