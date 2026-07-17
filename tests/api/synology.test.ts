import { describe, expect, it } from 'vitest';

import {
  detectPhotoItemSpace,
  extractPhotoItems,
  isWebApiUrl,
  parseGps,
  parsePhotoItem,
} from '@/api/synology';

import {
  ABSOLUTE_ITEM_URL,
  errorResponse,
  listingResponse,
  PERSONAL_ITEM_URL,
  singleItemWithGps,
  TEAM_ITEM_URL,
  THUMBNAIL_URL,
  UNIDENTIFIED_WEBAPI_URL,
} from '../fixtures/synology';

describe('isWebApiUrl', () => {
  /* Regression: this filter used to require a leading slash (`'/webapi/'`).
   * Synology Photos sends *relative* URLs, so it matched nothing at all — the
   * extension silently saw zero traffic while every test passed, because the
   * fixtures were invented rather than captured. Hence the verbatim URLs below. */
  it('matches the relative URL Synology Photos actually sends', () => {
    expect(isWebApiUrl('webapi/entry.cgi/SYNO.FotoTeam.Browse.Item')).toBe(true);
    expect(isWebApiUrl('webapi/entry.cgi')).toBe(true);
  });

  it('matches the captured fixtures', () => {
    expect(isWebApiUrl(TEAM_ITEM_URL)).toBe(true);
    expect(isWebApiUrl(PERSONAL_ITEM_URL)).toBe(true);
    expect(isWebApiUrl(UNIDENTIFIED_WEBAPI_URL)).toBe(true);
  });

  it('matches absolute and path-prefixed forms too', () => {
    /* A reverse proxy or a future DSM could serve either. */
    expect(isWebApiUrl(ABSOLUTE_ITEM_URL)).toBe(true);
    expect(isWebApiUrl('/webapi/entry.cgi')).toBe(true);
    expect(isWebApiUrl('/photo/webapi/entry.cgi/SYNO.Foto.Browse.Item')).toBe(true);
  });

  it('ignores the thumbnail API, which serves image bytes', () => {
    /* A separate API (`/synofoto/api/v2/`). Capturing it would clone every
     * thumbnail in the grid for a body we cannot read. */
    expect(isWebApiUrl(THUMBNAIL_URL)).toBe(false);
  });

  it('ignores everything else the page loads', () => {
    expect(isWebApiUrl('https://nas:5001/photo/main.js')).toBe(false);
    expect(isWebApiUrl('https://nas:5001/photo/#/personal_space/timeline')).toBe(false);
  });
});

describe('detectPhotoItemSpace', () => {
  /* Both spaces matter. The personal library and the shared one are different
   * endpoints with identical payloads — handling only one silently breaks half
   * the app, which is exactly the trap the original userscript fell into. */
  it('recognises the personal space', () => {
    expect(detectPhotoItemSpace(PERSONAL_ITEM_URL)).toBe('personal');
  });

  it('recognises the team space', () => {
    expect(detectPhotoItemSpace(TEAM_ITEM_URL)).toBe('team');
  });

  it('reads the method from the URL path, where Synology actually puts it', () => {
    /* Not a query parameter — a path segment. */
    expect(detectPhotoItemSpace('webapi/entry.cgi/SYNO.FotoTeam.Browse.Item')).toBe('team');
  });

  it('does not confuse FotoTeam with Foto', () => {
    /* `SYNO.Foto.` is not a substring of `SYNO.FotoTeam.` (the dot saves us),
     * but this pins the behaviour so a future loosening of the match cannot
     * regress it silently. */
    expect(detectPhotoItemSpace(TEAM_ITEM_URL)).not.toBe('personal');
  });

  it('returns undefined when the method is not in the URL', () => {
    /* A real, observed call: `POST webapi/entry.cgi` with the method presumably
     * in the body. Unidentifiable means ignored — never guessed. */
    expect(detectPhotoItemSpace(UNIDENTIFIED_WEBAPI_URL)).toBeUndefined();
    expect(detectPhotoItemSpace('')).toBeUndefined();
  });
});

describe('parseGps', () => {
  it('parses real coordinates', () => {
    expect(parseGps({ latitude: 48.85837, longitude: 2.294481 })).toEqual({
      latitude: 48.85837,
      longitude: 2.294481,
    });
  });

  it('accepts negative coordinates', () => {
    expect(parseGps({ latitude: -33.8688, longitude: -70.6693 })).toEqual({
      latitude: -33.8688,
      longitude: -70.6693,
    });
  });

  it('rejects 0/0, which Synology uses for "not geotagged"', () => {
    /* Null Island is a real place in the Gulf of Guinea. Trusting this would
     * drop a pin in the ocean for every photo that failed to geotag. */
    expect(parseGps({ latitude: 0, longitude: 0 })).toBeUndefined();
  });

  it('accepts a real coordinate that has a zero component', () => {
    expect(parseGps({ latitude: 0, longitude: 2.294481 })).toEqual({
      latitude: 0,
      longitude: 2.294481,
    });
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseGps({ latitude: 91, longitude: 0 })).toBeUndefined();
    expect(parseGps({ latitude: 0, longitude: 181 })).toBeUndefined();
  });

  it('rejects malformed input rather than throwing', () => {
    expect(parseGps(undefined)).toBeUndefined();
    expect(parseGps(null)).toBeUndefined();
    expect(parseGps({})).toBeUndefined();
    expect(parseGps({ latitude: 48.8 })).toBeUndefined();
    expect(parseGps({ latitude: '48.8', longitude: '2.2' })).toBeUndefined();
    expect(parseGps({ latitude: Number.NaN, longitude: 2 })).toBeUndefined();
    expect(parseGps('nope')).toBeUndefined();
  });
});

describe('parsePhotoItem', () => {
  it('parses a full item', () => {
    const item = parsePhotoItem(singleItemWithGps.data.list[0]);

    expect(item?.id).toBe(44246);
    expect(item?.filename).toBe('IMG_2481.HEIC');
    expect(item?.folder_id).toBe(1901);
    expect(item?.additional?.gps).toEqual({ latitude: 48.85837, longitude: 2.294481 });
    /* Not in the URL, and required to build a thumbnail — the reason the
     * network hook exists at all. */
    expect(item?.additional?.thumbnail?.cache_key).toBe('44246_1720000000');
  });

  it('requires only an id', () => {
    expect(parsePhotoItem({ id: 1 })?.id).toBe(1);
  });

  it('rejects an item without a usable id', () => {
    expect(parsePhotoItem({ filename: 'a.jpg' })).toBeUndefined();
    expect(parsePhotoItem({ id: 'abc' })).toBeUndefined();
    expect(parsePhotoItem(null)).toBeUndefined();
    expect(parsePhotoItem([])).toBeUndefined();
  });

  it('drops fields of the wrong type instead of failing the item', () => {
    /* A NAS sending one surprising field should cost a detail, not the photo. */
    const item = parsePhotoItem({ id: 5, filename: 42, filesize: 'big' });
    expect(item?.id).toBe(5);
    expect(item?.filename).toBeUndefined();
    expect(item?.filesize).toBeUndefined();
  });
});

describe('extractPhotoItems', () => {
  it('pulls items out of the envelope', () => {
    const items = extractPhotoItems(singleItemWithGps);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(44246);
  });

  it('returns every item of a listing', () => {
    expect(extractPhotoItems(listingResponse)).toHaveLength(3);
  });

  it('returns [] for an error envelope', () => {
    expect(extractPhotoItems(errorResponse)).toEqual([]);
  });

  it('returns [] for shapes that are not a photo response', () => {
    expect(extractPhotoItems(undefined)).toEqual([]);
    expect(extractPhotoItems(null)).toEqual([]);
    expect(extractPhotoItems('a string body')).toEqual([]);
    expect(extractPhotoItems({ data: {} })).toEqual([]);
    expect(extractPhotoItems({ data: { list: 'nope' } })).toEqual([]);
  });

  it('skips unusable entries but keeps the good ones', () => {
    const items = extractPhotoItems({
      data: { list: [{ id: 1 }, null, { nope: true }, { id: 2 }] },
    });
    expect(items.map((item) => item.id)).toEqual([1, 2]);
  });
});
