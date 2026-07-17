import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '@/core/eventBus';
import { createLogger } from '@/core/logger';
import type { PluginContext, PluginUi } from '@/core/plugin';
import miniMap from '@/plugins/miniMap';
import type { AppEventMap } from '@/types/events';
import type { SynoGps } from '@/types/synology';

const PARIS: SynoGps = { latitude: 48.8566, longitude: 2.3522 };
const TOKYO: SynoGps = { latitude: 35.6762, longitude: 139.6503 };

function renderPanel(): HTMLElement {
  document.body.innerHTML = `
    <div class="synofoto-lightbox-info-row">
      <span class="synofoto-indicator-photo-location"></span>
      <div class="synofoto-lightbox-info-block">
        <div class="synofoto-lightbox-info-first-line">Paris</div>
        <div class="synofoto-lightbox-info-second-line">Rue de Rivoli</div>
      </div>
    </div>
  `;
  const address = document.querySelector<HTMLElement>('.synofoto-lightbox-info-second-line');
  if (!address) throw new Error('test setup: address missing');
  return address;
}

/** The shadow container the popup renders into. */
let container: HTMLElement;

function setup(): {
  controller: AbortController;
  photoChanged: (gps: SynoGps | undefined) => void;
  mutate: () => void;
} {
  const bus: EventBus<AppEventMap> = createEventBus<AppEventMap>();
  const controller = new AbortController();

  container = document.createElement('div');
  document.body.append(container);
  const ui: PluginUi = { container, addStyles: vi.fn() };

  const context = {
    bus,
    ui,
    log: createLogger('test', 'silent'),
    signal: controller.signal,
  } as unknown as PluginContext;

  void miniMap.setup(context);

  return {
    controller,
    photoChanged: (gps) => {
      bus.emit('photo:changed', { item: { id: 1 }, space: 'team', gps });
    },
    mutate: () => {
      bus.emit('dom:mutation', { mutations: [] });
    },
  };
}

const button = (): HTMLButtonElement | null => document.querySelector('.spe-minimap-button');

afterEach(() => {
  vi.unstubAllGlobals();
  void miniMap.teardown?.();
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[id^="spe-styles-"]').forEach((n) => {
    n.remove();
  });
});

describe('miniMap plugin', () => {
  it('is disabled by default', () => {
    /* It pings a third party for tiles, so it must be opt-in. */
    expect(miniMap.enabledByDefault).toBe(false);
  });

  it('adds a map button beside the address for a geotagged photo', () => {
    const address = renderPanel();
    const { photoChanged } = setup();

    photoChanged(PARIS);

    expect(button()).not.toBeNull();
    expect(address.nextElementSibling).toBe(button());
  });

  it('adds no button for a photo with no location', () => {
    renderPanel();
    const { photoChanged } = setup();

    photoChanged(undefined);

    expect(button()).toBeNull();
  });

  describe('on demand: no request until the click', () => {
    it('loads no tile just from opening a photo', () => {
      /* The privacy promise: viewing a photo sends nothing. The DOM proves it —
       * no <img> exists until the button is clicked. */
      renderPanel();
      const { photoChanged } = setup();

      photoChanged(PARIS);

      expect(container.querySelector('img')).toBeNull();
    });

    it('renders tiles only after the button is clicked', () => {
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);

      button()?.click();

      const tiles = container.querySelectorAll('img');
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles[0]?.getAttribute('src')).toMatch(/tile\.openstreetmap\.org/);
    });
  });

  describe('the preview', () => {
    it('shows the coordinates as text', () => {
      /* Always present, so the popup is useful even if a CSP blocks the tiles. */
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);
      button()?.click();

      expect(container.querySelector('.spe-minimap-coords')?.textContent).toBe('48.85660, 2.35220');
    });

    it('offers an "open larger" link to OpenStreetMap', () => {
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);
      button()?.click();

      const link = container.querySelector<HTMLAnchorElement>('.spe-minimap-open');
      expect(link?.href).toContain('openstreetmap.org');
      expect(link?.rel).toContain('noopener');
    });

    it('shows OpenStreetMap attribution, as the tile policy requires', () => {
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);
      button()?.click();

      const attr = container.querySelector<HTMLAnchorElement>('.spe-minimap-attribution');
      expect(attr?.textContent).toContain('OpenStreetMap');
      expect(attr?.href).toContain('openstreetmap.org/copyright');
    });

    it('removes a tile that fails to load rather than showing a broken image', () => {
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);
      button()?.click();

      const tile = container.querySelector('img');
      expect(tile).not.toBeNull();
      tile?.dispatchEvent(new Event('error'));

      expect(container.contains(tile)).toBe(false);
      /* The coordinates survive — the popup still does its job. */
      expect(container.querySelector('.spe-minimap-coords')).not.toBeNull();
    });
  });

  describe('interaction', () => {
    it('toggles the preview off on a second click', () => {
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);

      button()?.click();
      expect(container.querySelector('.spe-minimap')).not.toBeNull();

      button()?.click();
      const popup = container.querySelector<HTMLElement>('.spe-popup');
      expect(popup?.hidden).toBe(true);
    });

    it("stops the click from reaching Synology's handlers", () => {
      /* Their panel handlers close the lightbox on a click; the preview must
       * not trigger that. */
      renderPanel();
      const ancestorClick = vi.fn();
      document.body.addEventListener('click', ancestorClick);
      const { photoChanged } = setup();
      photoChanged(PARIS);

      button()?.click();

      expect(ancestorClick).not.toHaveBeenCalled();
      document.body.removeEventListener('click', ancestorClick);
    });

    it('drops the open preview when the photo changes', () => {
      /* An open map is about the old photo; leaving it up would mislead. */
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);
      button()?.click();
      expect(container.querySelector('.spe-minimap-coords')?.textContent).toContain('48.85660');

      photoChanged(TOKYO);

      /* The old preview is gone; the button now previews Tokyo. */
      expect(container.querySelector('.spe-minimap')).toBeNull();
      button()?.click();
      expect(container.querySelector('.spe-minimap-coords')?.textContent).toContain('35.67620');
    });
  });

  describe('surviving React', () => {
    it('re-adds the button after React rebuilds the panel', () => {
      renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(PARIS);
      expect(button()).not.toBeNull();

      renderPanel(); // React replaces the row, dropping our button
      expect(button()).toBeNull();
      mutate();

      expect(button()).not.toBeNull();
    });

    it('never adds two buttons to the same address', () => {
      renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(PARIS);

      for (let i = 0; i < 5; i += 1) mutate();

      expect(document.querySelectorAll('.spe-minimap-button')).toHaveLength(1);
    });
  });

  describe('teardown', () => {
    it('removes the button and its marker from the page', () => {
      const address = renderPanel();
      const { photoChanged } = setup();
      photoChanged(PARIS);
      expect(button()).not.toBeNull();

      void miniMap.teardown?.();

      expect(button()).toBeNull();
      expect(address.hasAttribute('data-spe-minimap')).toBe(false);
    });

    it('stops responding once aborted', () => {
      renderPanel();
      const { photoChanged, controller, mutate } = setup();
      controller.abort();

      photoChanged(PARIS);
      mutate();

      expect(button()).toBeNull();
    });
  });
});
