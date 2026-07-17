import type { SynoGps } from '@/types/synology';

/**
 * Slippy-map tile math — the standard Web Mercator projection OpenStreetMap
 * uses, computed here so the mini map needs no mapping library.
 *
 * A dependency like Leaflet would be the obvious way to draw a map. It is also
 * ~140 KB, a runtime dependency this project has none of, and far more than a
 * static preview needs. The projection below is a handful of well-documented
 * formulas ([OSM wiki: Slippy map tilenames]); the plugin lays the resulting
 * `<img>` tiles out by hand.
 *
 * Everything here is pure and framework-free, so it is unit-tested directly.
 *
 * [OSM wiki: Slippy map tilenames]: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */

/** Standard OSM tile size, in pixels. */
export const TILE_SIZE = 256;

/**
 * A point's pixel position on the whole world map at a given zoom.
 *
 * Fractional on purpose: the integer part is which tile, the fraction is where
 * inside it. The plugin needs both — one to fetch, one to position.
 */
export interface WorldPixel {
  readonly x: number;
  readonly y: number;
}

/** Clamps latitude to the range Web Mercator can represent. Beyond it, `tan` diverges. */
export const MAX_LATITUDE = 85.05112878;

export function project(gps: SynoGps, zoom: number): WorldPixel {
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, gps.latitude));
  const scale = TILE_SIZE * 2 ** zoom;

  const x = ((gps.longitude + 180) / 360) * scale;

  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;

  return { x, y };
}

export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The tile a world pixel falls in. */
export function tileAt(pixel: WorldPixel, zoom: number): Tile {
  return {
    x: Math.floor(pixel.x / TILE_SIZE),
    y: Math.floor(pixel.y / TILE_SIZE),
    z: zoom,
  };
}

/**
 * The tile's URL on OpenStreetMap's standard server.
 *
 * `x` is wrapped modulo the world width so a viewport spanning the antimeridian
 * still points at real tiles; `y` is clamped, since there is no tile above the
 * pole. A `null`/out-of-range `y` would otherwise 404 as a broken image.
 */
export function tileUrl(tile: Tile): string {
  const count = 2 ** tile.z;
  const x = ((tile.x % count) + count) % count;
  const y = Math.max(0, Math.min(count - 1, tile.y));
  return `https://tile.openstreetmap.org/${String(tile.z)}/${String(x)}/${String(y)}.png`;
}

export interface PlacedTile {
  readonly tile: Tile;
  readonly url: string;
  /** Offset within the viewport, in px. May be negative or past the edge. */
  readonly left: number;
  readonly top: number;
}

export interface MapLayout {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly PlacedTile[];
  /** The marker position — the projected point, centred in the viewport. */
  readonly marker: { readonly left: number; readonly top: number };
}

export interface LayoutOptions {
  readonly gps: SynoGps;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Lays out exactly the tiles needed to fill a `width`×`height` viewport centred
 * on `gps`, each with its pixel offset, plus the centred marker.
 *
 * Only covering tiles are emitted — no fixed 3×3 grid that fetches corners a
 * small viewport never shows. Every tile here is one the user will actually see.
 */
export function layoutMap(options: LayoutOptions): MapLayout {
  const { gps, zoom, width, height } = options;
  const centre = project(gps, zoom);

  /* Top-left world pixel of the viewport. */
  const originX = centre.x - width / 2;
  const originY = centre.y - height / 2;

  const firstTileX = Math.floor(originX / TILE_SIZE);
  const firstTileY = Math.floor(originY / TILE_SIZE);
  const lastTileX = Math.floor((originX + width) / TILE_SIZE);
  const lastTileY = Math.floor((originY + height) / TILE_SIZE);

  const tiles: PlacedTile[] = [];
  for (let ty = firstTileY; ty <= lastTileY; ty += 1) {
    for (let tx = firstTileX; tx <= lastTileX; tx += 1) {
      const tile: Tile = { x: tx, y: ty, z: zoom };
      tiles.push({
        tile,
        url: tileUrl(tile),
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }

  return {
    width,
    height,
    tiles,
    marker: { left: width / 2, top: height / 2 },
  };
}
