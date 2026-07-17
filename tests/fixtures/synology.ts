/**
 * Fixtures modelled on real Synology Photos traffic.
 *
 * The shapes come from a working Tampermonkey userscript against a live DSM 7
 * NAS — `SYNO.FotoTeam.Browse.Item` → `data.list[0].additional.gps`. They are
 * the closest thing to a spec that exists, since Synology documents none of
 * this.
 *
 * Keep them faithful. The moment a fixture is "tidied up" into something more
 * convenient than what the NAS actually sends, the tests stop testing reality.
 */

/**
 * An `additional.exif` block captured verbatim from a live library
 * (2026-07-17). Every value is a pre-formatted string, units included — this is
 * how Synology returns EXIF, not how we wish it were.
 */
export const REAL_EXIF = {
  aperture: 'F1.8',
  camera: 'iPhone 14 Pro Max',
  exposure_time: '1/60 s',
  focal_length: '6.9 mm',
  iso: '160',
  lens: 'iPhone 14 Pro Max back triple camera 6.86mm f/1.78',
};

/** A single-item response: the lightbox loading the photo the user just opened. */
export const singleItemWithGps = {
  success: true,
  data: {
    list: [
      {
        id: 44246,
        filename: 'IMG_2481.HEIC',
        filesize: 2_184_233,
        folder_id: 1901,
        owner_user_id: 1,
        time: 1_720_000_000,
        type: 'photo',
        additional: {
          orientation: 1,
          gps: { latitude: 48.85837, longitude: 2.294481 },
          resolution: { width: 4032, height: 3024 },
          thumbnail: { cache_key: '44246_1720000000', unit_id: 44_246 },
          /* Verbatim from a live library (2026-07-17): Synology returns every
           * EXIF value pre-formatted as a string, units included. */
          exif: REAL_EXIF,
        },
      },
    ],
  },
};

/** The same photo, but `additional` was not requested — no GPS in the payload. */
export const singleItemWithoutGps = {
  success: true,
  data: {
    list: [{ id: 44246, filename: 'IMG_2481.HEIC', type: 'photo' }],
  },
};

/** A different photo, also geotagged. */
export const otherItemWithGps = {
  success: true,
  data: {
    list: [
      {
        id: 44247,
        filename: 'IMG_2482.HEIC',
        type: 'photo',
        additional: { gps: { latitude: 45.4642, longitude: 9.19 } },
      },
    ],
  },
};

/**
 * A grid listing: many items, the first one with no GPS.
 *
 * This is the payload that breaks the naive `list[0]` approach — it silently
 * redefines "current photo" as whatever happens to sort first.
 */
export const listingResponse = {
  success: true,
  data: {
    list: [
      { id: 90_001, filename: 'a.jpg', type: 'photo' },
      {
        id: 90_002,
        filename: 'b.jpg',
        type: 'photo',
        additional: { gps: { latitude: 1, longitude: 2 } },
      },
      { id: 90_003, filename: 'c.jpg', type: 'photo' },
    ],
  },
};

/** Synology's error envelope: no `data` at all. */
export const errorResponse = { success: false, error: { code: 119 } };

/* ------------------------------------------------------------------ *
 * URLs — captured verbatim from a live DSM 7 NAS (2026-07-17).
 *
 * Two things here are load-bearing and neither was guessable:
 *
 * 1. They are **relative, with no leading slash**. An earlier filter matched
 *    `'/webapi/'` and therefore matched nothing at all, silently.
 * 2. The method name is a **path segment**, not a query parameter.
 *
 * Earlier versions of this file invented plausible URLs
 * (`?api=SYNO.Foto.Browse.Item&method=get`) which were wrong on both counts and
 * made the tests pass while the extension saw nothing. If you touch these,
 * capture real traffic first.
 * ------------------------------------------------------------------ */

/** Verbatim: the shared-space item call. */
export const TEAM_ITEM_URL = 'webapi/entry.cgi/SYNO.FotoTeam.Browse.Item';

/**
 * The personal-space equivalent.
 *
 * The method name was inferred by symmetry with the shared-space URL above, then
 * confirmed on a live personal library (2026-07-17): the location feature works
 * there, so this matcher sees real personal-space traffic. The exact URL string
 * has not been captured byte-for-byte, but the `SYNO.Foto.Browse.Item` method it
 * hinges on is confirmed.
 */
export const PERSONAL_ITEM_URL = 'webapi/entry.cgi/SYNO.Foto.Browse.Item';

/**
 * Verbatim: a `webapi/entry.cgi` POST with no method in the URL.
 *
 * The method is presumably in the form-encoded body. We cannot identify it, so
 * we ignore it — and must keep ignoring it rather than guessing.
 */
export const UNIDENTIFIED_WEBAPI_URL = 'webapi/entry.cgi';

/**
 * The *other* Synology Photos API, serving image bytes.
 *
 * Structurally verbatim, with two values replaced: the real `SynoToken` was a
 * live session credential and the host was a real machine name. Neither belongs
 * in a public repository, and neither carries any information the test needs —
 * what matters is the shape, and that `cache_key` and `SynoToken` live in the
 * query string here rather than in the page URL.
 *
 * Outside `webapi/entry.cgi`, so it must not be captured: cloning every
 * thumbnail in the grid would be pure waste.
 */
export const THUMBNAIL_URL =
  'https://nas:5001/synofoto/api/v2/t/Thumbnail/get?id=120565&cache_key=%22120565_1716818418%22&type=%22unit%22&size=%22xl%22&SynoToken=REDACTED';

/** An absolute `entry.cgi` URL — the filter must handle both forms. */
export const ABSOLUTE_ITEM_URL = 'https://nas:5001/webapi/entry.cgi/SYNO.FotoTeam.Browse.Item';
