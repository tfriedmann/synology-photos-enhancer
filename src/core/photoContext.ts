import { detectPhotoItemSpace, extractPhotoItems } from '@/api/synology';
import type { AppEventMap } from '@/types/events';
import type { SynoPhotoItem, SynoSpace } from '@/types/synology';

import type { EventBus } from './eventBus';
import type { Logger } from './logger';

/**
 * Derives `photo:changed` from network traffic.
 *
 * ## Why the network and not the URL
 *
 * The obvious approach — read the photo id out of the hash — does not hold up:
 *
 * - `#/…/item/<id>` is only confirmed for *folder* views. Whether the timeline
 *   lightbox routes at all is unverified (see `docs/ARCHITECTURE.md`).
 * - Even where the id is in the URL, `cache_key` is not — and no thumbnail URL
 *   can be built without it. The URL is never sufficient on its own.
 *
 * The API response carries the id, the GPS and the `cache_key` together, and it
 * arrives exactly when the photo changes. It is the better signal, so the
 * router stays a secondary one.
 *
 * ## The single-item rule
 *
 * `Browse.Item` serves two very different purposes: listing a grid (many items)
 * and loading the open photo (one item). They are indistinguishable by URL.
 *
 * Reading `list[0]` unconditionally — the intuitive move — means a grid
 * refresh silently redefines "current photo" as whatever happens to be first,
 * usually with no GPS attached. That is the root of the classic
 * "GPS keeps getting clobbered" symptom, normally patched over downstream with
 * a "never overwrite a good value with null" rule.
 *
 * We fix the cause instead: only a **single-item** response describes the open
 * photo. Listings are ignored outright, so there is no bad value to guard
 * against later.
 */

export interface PhotoSnapshot {
  readonly item: SynoPhotoItem;
  readonly space: SynoSpace;
}

export interface PhotoContextOptions {
  readonly bus: EventBus<AppEventMap>;
  readonly logger: Logger;
  readonly signal?: AbortSignal | undefined;
}

export interface PhotoContext {
  /** The photo currently believed to be open, for plugins starting up late. */
  readonly current: PhotoSnapshot | undefined;
}

export function createPhotoContext(options: PhotoContextOptions): PhotoContext {
  const { bus, logger } = options;
  let current: PhotoSnapshot | undefined;

  bus.on(
    'api:response',
    ({ url, body }) => {
      const space = detectPhotoItemSpace(url);
      if (space === undefined) return;

      const items = extractPhotoItems(body);
      if (items.length !== 1) return; // A listing, not the open photo.

      const item = items[0];
      if (!item) return;

      const gps = item.additional?.gps;
      const isSamePhoto = current?.item.id === item.id;

      /* Same photo, and this response tells us nothing new: staying quiet keeps
       * plugins from re-rendering on every grid poll. */
      if (isSamePhoto && gps === undefined) return;
      if (isSamePhoto && current?.item.additional?.gps !== undefined) return;

      current = { item, space };
      logger.debug('photo:changed', { id: item.id, space, hasGps: gps !== undefined });

      bus.emit('photo:changed', { item, space, gps });
    },
    options.signal ? { signal: options.signal } : {},
  );

  return {
    get current() {
      return current;
    },
  };
}
