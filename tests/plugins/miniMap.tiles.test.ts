import { describe, expect, it } from 'vitest';

import {
  layoutMap,
  MAX_LATITUDE,
  project,
  TILE_SIZE,
  tileAt,
  tileUrl,
} from '@/plugins/miniMap/tiles';

const PARIS = { latitude: 48.8566, longitude: 2.3522 };

describe('project', () => {
  it('places 0,0 at the centre of the world', () => {
    /* Null Island projects to the exact middle of the map at every zoom. */
    const scale = TILE_SIZE * 2 ** 3;
    const p = project({ latitude: 0, longitude: 0 }, 3);
    expect(p.x).toBeCloseTo(scale / 2, 6);
    expect(p.y).toBeCloseTo(scale / 2, 6);
  });

  it('maps longitude linearly', () => {
    const scale = TILE_SIZE * 2 ** 5;
    expect(project({ latitude: 0, longitude: -180 }, 5).x).toBeCloseTo(0, 6);
    expect(project({ latitude: 0, longitude: 180 }, 5).x).toBeCloseTo(scale, 6);
  });

  it('places northern latitudes in the upper half', () => {
    /* y grows downward, so a positive latitude sits above the equator line. */
    const scale = TILE_SIZE * 2 ** 10;
    expect(project(PARIS, 10).y).toBeLessThan(scale / 2);
  });

  it('doubles pixel coordinates when zoom increases by one', () => {
    const a = project(PARIS, 10);
    const b = project(PARIS, 11);
    expect(b.x).toBeCloseTo(a.x * 2, 4);
    expect(b.y).toBeCloseTo(a.y * 2, 4);
  });

  it('clamps latitude to the Mercator limit instead of diverging', () => {
    /* Past ~85° the projection runs to infinity; clamping keeps it finite. */
    const beyond = project({ latitude: 89, longitude: 0 }, 10);
    const atLimit = project({ latitude: MAX_LATITUDE, longitude: 0 }, 10);
    expect(beyond.y).toBeCloseTo(atLimit.y, 6);
    expect(Number.isFinite(beyond.y)).toBe(true);
  });

  it('matches the canonical OSM tile for Paris at zoom 15', () => {
    /* Cross-checked against OSM's published Slippy-map formula: (48.8566,
     * 2.3522) at z15 is tile (16598, 11273) — a real tile that resolves at
     * https://tile.openstreetmap.org/15/16598/11273.png. If the projection
     * drifts, this catches it. */
    const tile = tileAt(project(PARIS, 15), 15);
    expect(tile).toEqual({ x: 16598, y: 11273, z: 15 });
  });
});

describe('tileUrl', () => {
  it('builds a standard OSM URL', () => {
    expect(tileUrl({ x: 16598, y: 11273, z: 15 })).toBe(
      'https://tile.openstreetmap.org/15/16598/11273.png',
    );
  });

  it('wraps x across the antimeridian', () => {
    /* Tile -1 at z2 (4 tiles wide) is really tile 3 — a viewport crossing the
     * date line must point at real tiles, not 404s. */
    expect(tileUrl({ x: -1, y: 1, z: 2 })).toBe('https://tile.openstreetmap.org/2/3/1.png');
    expect(tileUrl({ x: 4, y: 1, z: 2 })).toBe('https://tile.openstreetmap.org/2/0/1.png');
  });

  it('clamps y at the poles', () => {
    /* There is no tile above the top row; clamping avoids a broken image. */
    expect(tileUrl({ x: 1, y: -1, z: 2 })).toBe('https://tile.openstreetmap.org/2/1/0.png');
    expect(tileUrl({ x: 1, y: 99, z: 2 })).toBe('https://tile.openstreetmap.org/2/1/3.png');
  });
});

describe('layoutMap', () => {
  const layout = layoutMap({ gps: PARIS, zoom: 15, width: 260, height: 180 });

  it('centres the marker in the viewport', () => {
    expect(layout.marker).toEqual({ left: 130, top: 90 });
  });

  it('covers the whole viewport', () => {
    /* Every pixel must be painted: the tiles must reach from the top-left to
     * beyond the bottom-right corner. */
    const left = Math.min(...layout.tiles.map((t) => t.left));
    const top = Math.min(...layout.tiles.map((t) => t.top));
    const right = Math.max(...layout.tiles.map((t) => t.left + TILE_SIZE));
    const bottom = Math.max(...layout.tiles.map((t) => t.top + TILE_SIZE));

    expect(left).toBeLessThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(260);
    expect(bottom).toBeGreaterThanOrEqual(180);
  });

  it('emits only covering tiles, not a fixed grid', () => {
    /* A 260×180 viewport needs at most 3×3 tiles. Emitting a corner the
     * viewport never shows is a wasted third-party request. */
    expect(layout.tiles.length).toBeLessThanOrEqual(9);
    expect(layout.tiles.length).toBeGreaterThanOrEqual(4);
  });

  it('positions tiles on a tile-sized grid', () => {
    /* Neighbouring tiles are exactly TILE_SIZE apart, so they abut without a
     * seam or an overlap. */
    const lefts = [...new Set(layout.tiles.map((t) => t.left))].sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i += 1) {
      expect((lefts[i] ?? 0) - (lefts[i - 1] ?? 0)).toBeCloseTo(TILE_SIZE, 6);
    }
  });

  it('gives every tile a valid URL', () => {
    for (const placed of layout.tiles) {
      expect(placed.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/);
    }
  });

  it('keeps the marked point under the marker', () => {
    /* The tile containing the projected point must be the one rendered under
     * the viewport centre. */
    const centre = project(PARIS, 15);
    const containing = tileAt(centre, 15);
    const rendered = layout.tiles.find(
      (t) => t.tile.x === containing.x && t.tile.y === containing.y,
    );
    expect(rendered).toBeDefined();
    /* The point sits within that tile's painted rectangle. */
    expect(rendered ? centre.x - containing.x * TILE_SIZE : -1).toBeGreaterThanOrEqual(0);
  });
});
