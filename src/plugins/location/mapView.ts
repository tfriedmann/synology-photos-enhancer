import type { SynoGps } from '@/types/synology';
import { el } from '@/utils/dom';

import { layoutMap, TILE_SIZE } from './tiles';

/**
 * Builds the preview's DOM: a zoomable tiled map, a centre marker, coordinates,
 * an "open larger" link, and the attribution OpenStreetMap's tile policy
 * requires.
 *
 * Kept apart from `index.ts` so the layout math (`tiles.ts`) and this rendering
 * can be reasoned about without the plugin lifecycle in the way. The tile
 * `<img>` elements created here are the only network request the plugin ever
 * makes, and only because the user clicked — including each zoom step, which is
 * why zoom is a button press, not a wheel: one deliberate request at a time,
 * never a burst.
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
 * orient. The bounds keep zoom within what OSM's tiles cover (0–19), narrowed
 * to a range that stays useful for a small preview. */
export const DEFAULT_ZOOM = 15;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

function formatCoords(gps: SynoGps): string {
  return `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
}

/**
 * Holds a zoom level within the tile bounds.
 *
 * The +/- buttons also disable themselves at the limits, so through them this
 * is belt-and-braces. It is the real guard for any future entry point that has
 * no disabled state of its own — a keyboard shortcut, a wheel handler — so it
 * stays, and is tested directly rather than only through the buttons.
 */
export const clampZoom = (zoom: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

/** Paints the tiles and marker for one zoom level into `canvas`, replacing what was there. */
function paintCanvas(canvas: HTMLElement, gps: SynoGps, zoom: number): void {
  const layout = layoutMap({ gps, zoom, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  const nodes: Node[] = [];

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
     * glyph; the coordinates and link still do the job. */
    tile.addEventListener('error', () => {
      tile.remove();
    });
    nodes.push(tile);
  }

  /* The marker stays dead centre at every zoom, because the layout always
   * recentres on the point. A preview of *this* photo does not pan. */
  nodes.push(
    el('div', {
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
    }),
  );

  canvas.replaceChildren(...nodes);
}

/**
 * @param gps The point to preview.
 * @param openUrl Where "open larger" leads — the user's chosen provider, built
 * by the caller. Kept as a parameter so this module knows nothing about
 * providers.
 */
export function buildMapElement(gps: SynoGps, openUrl: string): HTMLElement {
  let zoom = DEFAULT_ZOOM;

  /* Clips the tiles to the viewport; the tiles are positioned absolutely inside. */
  const canvas = el('div', {
    className: 'spe-minimap-canvas',
    style: {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      background: '#e8eaed',
    },
  });

  const zoomButton = (label: string, delta: number, ariaLabel: string): HTMLButtonElement =>
    el('button', {
      className: 'spe-minimap-zoom',
      text: label,
      attrs: { type: 'button', 'aria-label': ariaLabel },
    });

  const zoomIn = zoomButton('+', 1, 'Zoom in');
  const zoomOut = zoomButton('−', -1, 'Zoom out');

  const syncButtons = (): void => {
    zoomIn.disabled = zoom >= MAX_ZOOM;
    zoomOut.disabled = zoom <= MIN_ZOOM;
  };

  const changeZoom =
    (delta: number) =>
    (event: Event): void => {
      /* Keep the click inside the popup: it must not bubble to the toggle that
       * opened the preview, nor to the dismiss-on-outside-click handler. */
      event.stopPropagation();
      event.preventDefault();
      const next = clampZoom(zoom + delta);
      if (next === zoom) return;
      zoom = next;
      paintCanvas(canvas, gps, zoom); // one deliberate tile request per press
      syncButtons();
    };

  zoomIn.addEventListener('click', changeZoom(1));
  zoomOut.addEventListener('click', changeZoom(-1));

  paintCanvas(canvas, gps, zoom);
  syncButtons();

  const zoomControls = el('div', {
    className: 'spe-minimap-zoom-controls',
    children: [zoomIn, zoomOut],
  });

  const map = el('div', {
    className: 'spe-minimap-map',
    style: {
      position: 'relative',
      width: `${String(PREVIEW_WIDTH)}px`,
      height: `${String(PREVIEW_HEIGHT)}px`,
      borderRadius: '6px',
      overflow: 'hidden',
    },
    children: [canvas, zoomControls],
  });

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
    children: [map, footer, attribution],
  });
}
