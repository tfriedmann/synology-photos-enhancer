import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '@/core/eventBus';
import { createLogger } from '@/core/logger';
import type { PluginContext } from '@/core/plugin';
import googleMaps, { buildMapsUrl, findAddressElement } from '@/plugins/googleMaps';
import type { AppEventMap } from '@/types/events';
import type { SynoGps } from '@/types/synology';

const PARIS: SynoGps = { latitude: 48.85837, longitude: 2.294481 };
const TOKYO: SynoGps = { latitude: 35.7021055555556, longitude: 139.741027777778 };
const ADDRESS_TEXT = '1 Rue de Rivoli, Paris';

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

function setup(): {
  bus: EventBus<AppEventMap>;
  controller: AbortController;
  openSpy: ReturnType<typeof vi.fn>;
  photoChanged: (gps: SynoGps | undefined) => void;
  mutate: () => void;
} {
  const bus = createEventBus<AppEventMap>();
  const controller = new AbortController();

  const context = {
    bus,
    log: createLogger('test', 'silent'),
    signal: controller.signal,
  } as unknown as PluginContext;

  void googleMaps.setup(context);

  const openSpy = vi.fn();
  vi.stubGlobal('open', openSpy);

  return {
    bus,
    controller,
    openSpy,
    photoChanged: (gps) => {
      bus.emit('photo:changed', {
        item: { id: 1 },
        space: 'team',
        ...(gps !== undefined ? { gps } : { gps: undefined }),
      });
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

describe('buildMapsUrl', () => {
  it('builds a documented Maps URL', () => {
    expect(buildMapsUrl(PARIS)).toBe(
      'https://www.google.com/maps/search/?api=1&query=48.85837%2C2.294481',
    );
  });

  it('handles negative coordinates', () => {
    expect(buildMapsUrl({ latitude: -33.8688, longitude: -70.6693 })).toContain(
      'query=-33.8688%2C-70.6693',
    );
  });

  it('keeps full precision', () => {
    /* Truncating a coordinate moves the pin. */
    expect(buildMapsUrl(TOKYO)).toContain('35.7021055555556');
    expect(buildMapsUrl(TOKYO)).toContain('139.741027777778');
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
    document.body.innerHTML = `
      <div><span class="synofoto-indicator-photo-location"></span></div>
      <div class="synofoto-lightbox-info-block">
        <div class="synofoto-lightbox-info-second-line">elsewhere</div>
      </div>`;
    /* The block is not a sibling of the indicator, so it is not this
     * indicator's block. Matching it anyway would attach the location of one
     * row to another. */
    expect(findAddressElement()).toBeUndefined();
  });
});

describe('googleMaps plugin', () => {
  beforeEach(() => {
    renderPanel();
  });

  it('makes the address clickable when a geotagged photo opens', () => {
    const address = renderPanel();
    const { photoChanged } = setup();

    photoChanged(PARIS);

    expect(address.classList.contains('spe-maps-clickable')).toBe(true);
    expect(address.getAttribute('role')).toBe('link');
    expect(address.getAttribute('tabindex')).toBe('0');
  });

  it('opens Google Maps at the photo location on click', () => {
    const address = renderPanel();
    const { photoChanged, openSpy } = setup();
    photoChanged(PARIS);

    address.click();

    expect(openSpy).toHaveBeenCalledExactlyOnceWith(
      buildMapsUrl(PARIS),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('does nothing for a photo with no location', () => {
    const address = renderPanel();
    const { photoChanged } = setup();

    photoChanged(undefined);

    expect(address.classList.contains('spe-maps-clickable')).toBe(false);
  });

  it('injects its stylesheet once', () => {
    setup();
    expect(document.getElementById('spe-styles-google-maps')).not.toBeNull();
  });

  describe("never destroying Synology's DOM", () => {
    /* The whole reason this plugin adds a class instead of replacing the
     * address line's contents. Each of these fails on the `innerHTML = ''`
     * implementation. */

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
      expect(address.classList.contains('spe-maps-clickable')).toBe(true);
    });

    it('never points at the previous photo once the photo changes', () => {
      /* The stale-coordinates bug: React reuses the node and only swaps the
       * text, so an implementation that rebuilds a link only when one is
       * missing keeps the *old* coordinates under the *new* address — pointing
       * confidently at the wrong city. Reading the GPS at click time makes that
       * unrepresentable. */
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();

      photoChanged(PARIS);
      photoChanged(TOKYO);
      address.click();

      expect(openSpy).toHaveBeenCalledExactlyOnceWith(
        buildMapsUrl(TOKYO),
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  describe('surviving React', () => {
    it('repairs the class after React strips it', () => {
      const address = renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(PARIS);

      address.className = 'synofoto-lightbox-info-second-line'; // React re-render
      expect(address.classList.contains('spe-maps-clickable')).toBe(false);

      mutate();

      expect(address.classList.contains('spe-maps-clickable')).toBe(true);
    });

    it('does not stack listeners when the class is repaired', () => {
      /* Re-adding the same listener reference is a DOM no-op. If it were not,
       * every mutation batch would add another handler and one click would open
       * a dozen tabs. */
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

      expect(address.classList.contains('spe-maps-clickable')).toBe(true);
    });

    it('handles a node React replaced entirely', () => {
      renderPanel();
      const { photoChanged, mutate, openSpy } = setup();
      photoChanged(PARIS);

      const fresh = renderPanel('Somewhere else');
      mutate();
      fresh.click();

      expect(fresh.classList.contains('spe-maps-clickable')).toBe(true);
      expect(openSpy).toHaveBeenCalledOnce();
    });
  });

  describe('coexisting with the host app', () => {
    it("stops the click from reaching Synology's handlers", () => {
      /* Their handlers sit on the ancestors and react to clicks in the panel —
       * typically by closing the lightbox. Opening Maps must not also do that. */
      const address = renderPanel();
      const ancestorClick = vi.fn();
      document.body.addEventListener('click', ancestorClick);
      const { photoChanged } = setup();
      photoChanged(PARIS);

      address.click();

      expect(ancestorClick).not.toHaveBeenCalled();
      document.body.removeEventListener('click', ancestorClick);
    });

    it('opens with noopener, so Maps gets no handle on the NAS tab', () => {
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();
      photoChanged(PARIS);

      address.click();

      expect(openSpy.mock.calls[0]?.[2]).toContain('noopener');
    });
  });

  describe('keyboard access', () => {
    it('opens on Enter', () => {
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();
      photoChanged(PARIS);

      address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(openSpy).toHaveBeenCalledOnce();
    });

    it('opens on Space', () => {
      const address = renderPanel();
      const { photoChanged, openSpy } = setup();
      photoChanged(PARIS);

      address.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

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

  describe('teardown', () => {
    it('leaves the page exactly as it found it', () => {
      const address = renderPanel();
      const { photoChanged, controller } = setup();
      photoChanged(PARIS);

      controller.abort();
      void googleMaps.teardown?.();

      expect(address.classList.contains('spe-maps-clickable')).toBe(false);
      expect(address.getAttribute('role')).toBeNull();
      expect(address.getAttribute('tabindex')).toBeNull();
      expect(address.textContent).toBe(ADDRESS_TEXT);
      expect(document.getElementById('spe-styles-google-maps')).toBeNull();
    });

    it('stops responding to events once aborted', () => {
      const address = renderPanel();
      const { photoChanged, controller, mutate } = setup();
      controller.abort();

      photoChanged(PARIS);
      mutate();

      expect(address.classList.contains('spe-maps-clickable')).toBe(false);
    });
  });
});
