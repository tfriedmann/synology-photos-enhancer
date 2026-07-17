import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEventBus, type EventBus } from '@/core/eventBus';
import { createLogger } from '@/core/logger';
import type { PluginContext } from '@/core/plugin';
import exif from '@/plugins/exif';
import type { AppEventMap } from '@/types/events';
import type { SynoExif, SynoPhotoItem } from '@/types/synology';

import { REAL_EXIF } from '../fixtures/synology';

/**
 * The lightbox info panel, mirroring the real structure captured from Synology:
 * an info tab-panel holding several "general section" blocks (date, size, …).
 * The plugin inserts its section after the last of them.
 */
function renderPanel(): void {
  document.body.innerHTML = `
    <div class="synofoto-lightbox-info-panel">
      <div class="synofoto-lightbox-info-tab-panel">
        <div class="synofoto-lightbox-general-section synofoto-lightbox-info-date-section">
          <div class="synofoto-lightbox-info-block">date</div>
        </div>
        <div class="synofoto-lightbox-general-section">
          <div class="synofoto-lightbox-info-block">size</div>
        </div>
        <div class="synofoto-lightbox-info-tag-section">tags</div>
      </div>
    </div>
  `;
}

function photoWith(exifData: SynoExif | undefined, id = 1): SynoPhotoItem {
  return { id, filename: 'IMG.HEIC', additional: exifData ? { exif: exifData } : {} };
}

function setup(): {
  controller: AbortController;
  photoChanged: (item: SynoPhotoItem) => void;
  mutate: () => void;
} {
  const bus: EventBus<AppEventMap> = createEventBus<AppEventMap>();
  const controller = new AbortController();

  const context = {
    bus,
    log: createLogger('test', 'silent'),
    signal: controller.signal,
  } as unknown as PluginContext;

  void exif.setup(context);

  return {
    controller,
    photoChanged: (item) => {
      bus.emit('photo:changed', { item, space: 'team', gps: item.additional?.gps });
    },
    mutate: () => {
      bus.emit('dom:mutation', { mutations: [] });
    },
  };
}

const section = (): HTMLElement | null => document.querySelector('.spe-exif-section');
const values = (): string[] =>
  [...document.querySelectorAll('.spe-exif-row-value')].map((n) => n.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
  void exif.teardown?.();
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[id^="spe-styles-"]').forEach((n) => {
    n.remove();
  });
});

describe('exif plugin', () => {
  it('is on by default — showing local data sends nothing', () => {
    expect(exif.enabledByDefault).toBe(true);
  });

  it('adds a Camera section with the EXIF values', () => {
    renderPanel();
    const { photoChanged } = setup();

    photoChanged(photoWith(REAL_EXIF));

    expect(section()).not.toBeNull();
    expect(values()).toContain('iPhone 14 Pro Max');
    expect(values()).toContain('1/60 s');
    expect(values()).toContain('160');
  });

  it('inserts after the last general section, before the tag section', () => {
    renderPanel();
    const { photoChanged } = setup();
    photoChanged(photoWith(REAL_EXIF));

    const sections = [...document.querySelectorAll('.synofoto-lightbox-info-tab-panel > *')];
    const generalCount = document.querySelectorAll('.synofoto-lightbox-general-section').length;
    /* Our section sits right after the last general section. */
    expect(sections[generalCount]?.classList.contains('spe-exif-section')).toBe(true);
  });

  it('shows nothing for a photo without EXIF', () => {
    renderPanel();
    const { photoChanged } = setup();

    photoChanged(photoWith(undefined));

    expect(section()).toBeNull();
  });

  it('does not require the panel to exist when the photo arrives', () => {
    /* The API response often lands before React has drawn the panel. */
    document.body.innerHTML = '';
    const { photoChanged, mutate } = setup();

    photoChanged(photoWith(REAL_EXIF));
    expect(section()).toBeNull();

    renderPanel();
    mutate();

    expect(section()).not.toBeNull();
  });

  describe('staleness', () => {
    it('replaces the section when the photo changes', () => {
      renderPanel();
      const { photoChanged } = setup();

      photoChanged(photoWith({ camera: 'iPhone 14 Pro Max' }, 1));
      expect(values()).toContain('iPhone 14 Pro Max');

      photoChanged(photoWith({ camera: 'Leica M6' }, 2));

      expect(values()).toContain('Leica M6');
      expect(values()).not.toContain('iPhone 14 Pro Max');
      expect(document.querySelectorAll('.spe-exif-section')).toHaveLength(1);
    });

    it('removes the section when moving to a photo with no EXIF', () => {
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(photoWith(REAL_EXIF, 1));
      expect(section()).not.toBeNull();

      photoChanged(photoWith(undefined, 2));

      expect(section()).toBeNull();
    });
  });

  describe('surviving React', () => {
    it('re-adds the section after React rebuilds the panel', () => {
      renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(photoWith(REAL_EXIF));
      expect(section()).not.toBeNull();

      renderPanel(); // React replaces the panel, dropping our section
      expect(section()).toBeNull();
      mutate();

      expect(section()).not.toBeNull();
    });

    it('does not rebuild the section on every mutation for the same photo', () => {
      renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(photoWith(REAL_EXIF));
      const first = section();

      mutate();
      mutate();

      /* Same node — not torn down and rebuilt each frame. */
      expect(section()).toBe(first);
    });

    it('never adds two sections', () => {
      renderPanel();
      const { photoChanged, mutate } = setup();
      photoChanged(photoWith(REAL_EXIF));

      for (let i = 0; i < 5; i += 1) mutate();

      expect(document.querySelectorAll('.spe-exif-section')).toHaveLength(1);
    });
  });

  describe('teardown', () => {
    it('removes the section', () => {
      renderPanel();
      const { photoChanged } = setup();
      photoChanged(photoWith(REAL_EXIF));
      expect(section()).not.toBeNull();

      void exif.teardown?.();

      expect(section()).toBeNull();
    });

    it('stops responding once aborted', () => {
      renderPanel();
      const { photoChanged, controller, mutate } = setup();
      controller.abort();

      photoChanged(photoWith(REAL_EXIF));
      mutate();

      expect(section()).toBeNull();
    });
  });
});
