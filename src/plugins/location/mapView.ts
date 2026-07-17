import type { SynoGps } from '@/types/synology';
import { el } from '@/utils/dom';

import { layoutMap, TILE_SIZE } from './tiles';

/**
 * Builds the preview's DOM: a tiled map, a centre marker, coordinates, an
 * "open larger" link, and the attribution OpenStreetMap's tile policy requires.
 *
 * Kept apart from `index.ts` so the layout math (`tiles.ts`) and this rendering
 * can be reasoned about without the plugin lifecycle in the way. The tile
 * `<img>` elements created here are the only network request the plugin ever
 * makes, and only because the user clicked.
 *
 * ## Two different providers, on purpose
 *
 * The tiles are **always** OpenStreetMap's: they are the only free, keyless
 * tile source, so a viewer picking "Google Maps" still sees OSM tiles here.
 * But the **"open larger" link** follows the user's chosen provider (`openUrl`),
 * so clicking through lands them in the map they asked for. Showing OSM tiles
 * and linking to Google is not an inconsistency to hide — it is the honest best
 * of both, and the attribution makes the tile source clear.
 */

const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 180;
/* 15 shows a neighbourhood — close enough to place a photo, wide enough to
 * orient. */
const ZOOM = 15;

function formatCoords(gps: SynoGps): string {
  return `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
}

/**
 * @param gps The point to preview.
 * @param openUrl Where "open larger" leads — the user's chosen provider, built
 * by the caller. Kept as a parameter so this module knows nothing about
 * providers.
 */
export function buildMapElement(gps: SynoGps, openUrl: string): HTMLElement {
  const layout = layoutMap({ gps, zoom: ZOOM, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });

  /* Clips the tiles to the viewport; the tiles are positioned absolutely inside. */
  const canvas = el('div', {
    className: 'spe-minimap-canvas',
    style: {
      position: 'relative',
      width: `${String(PREVIEW_WIDTH)}px`,
      height: `${String(PREVIEW_HEIGHT)}px`,
      overflow: 'hidden',
      borderRadius: '6px',
      background: '#e8eaed',
    },
  });

  for (const placed of layout.tiles) {
    const tile = el('img', {
      attrs: {
        src: placed.url,
        alt: '',
        loading: 'eager',
        draggable: 'false',
        referrerpolicy: 'no-referrer',
      },
      style: {
        position: 'absolute',
        left: `${String(Math.round(placed.left))}px`,
        top: `${String(Math.round(placed.top))}px`,
        width: `${String(TILE_SIZE)}px`,
        height: `${String(TILE_SIZE)}px`,
      },
    });
    /* A blocked or failed tile (CSP, offline) must not leave a broken-image
     * glyph; the coordinates and link below still do the job. */
    tile.addEventListener('error', () => {
      tile.remove();
    });
    canvas.append(tile);
  }

  const marker = el('div', {
    text: '📍',
    attrs: { 'aria-hidden': 'true' },
    style: {
      position: 'absolute',
      left: `${String(layout.marker.left)}px`,
      top: `${String(layout.marker.top)}px`,
      /* The pin's tip, not its centre, marks the spot. */
      transform: 'translate(-50%, -100%)',
      fontSize: '20px',
      lineHeight: '1',
      pointerEvents: 'none',
    },
  });
  canvas.append(marker);

  const coords = el('span', { className: 'spe-minimap-coords', text: formatCoords(gps) });

  const openLarger = el('a', {
    className: 'spe-minimap-open',
    text: 'Open larger ↗',
    attrs: { href: openUrl, target: '_blank', rel: 'noopener noreferrer' },
  });

  /* Required by OSM's tile usage policy, and only fair. */
  const attribution = el('a', {
    className: 'spe-minimap-attribution',
    text: '© OpenStreetMap',
    attrs: {
      href: 'https://www.openstreetmap.org/copyright',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  });

  const footer = el('div', {
    className: 'spe-minimap-footer',
    style: { display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '6px' },
    children: [coords, openLarger],
  });

  return el('div', {
    className: 'spe-minimap',
    style: { width: `${String(PREVIEW_WIDTH)}px` },
    children: [canvas, footer, attribution],
  });
}
