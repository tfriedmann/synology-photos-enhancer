import type { SynoExif, SynoGps, SynoPhotoItem, SynoSpace } from '@/types/synology';
import { isFiniteNumber, isRecord, isString, readPath, readProp } from '@/utils/guards';

/**
 * The typed edge of the Synology Photos web API.
 *
 * This is the *only* module that knows Synology's method names and payload
 * shapes. When DSM changes them — and it will, since none of this is
 * documented or contractual — this file is the blast radius.
 *
 * Nothing here trusts its input: every value arrives from a NAS we do not
 * control, over a `postMessage` boundary, typed `unknown`. Parsers return
 * `undefined` on anything unexpected rather than throwing, because a plugin
 * losing a feature beats an exception taking down the page.
 */

/**
 * The JSON API endpoint, as it actually appears in requests.
 *
 * **No leading slash, and that is the whole point.** Synology Photos calls this
 * with a *relative* URL:
 *
 *     POST webapi/entry.cgi/SYNO.FotoTeam.Browse.Item
 *     POST webapi/entry.cgi
 *
 * An earlier version matched `'/webapi/'` with a leading slash, which never
 * matches a relative URL — so every request was silently ignored and the
 * extension saw nothing at all. Matching on `entry.cgi` keeps it working
 * whether the app sends a relative URL, an absolute one, or moves behind a path
 * prefix like `/photo/webapi/entry.cgi`.
 *
 * Do not "tidy" a slash back onto the front of this.
 */
export const WEBAPI_ENDPOINT = 'webapi/entry.cgi';

/**
 * The methods that return photo items.
 *
 * Both spaces matter: `SYNO.Foto.*` serves the *personal* library and
 * `SYNO.FotoTeam.*` the *shared* one. They are separate endpoints with
 * identical payloads — handling only one silently breaks half the app.
 */
export const PHOTO_ITEM_METHODS = {
  personal: 'SYNO.Foto.Browse.Item',
  team: 'SYNO.FotoTeam.Browse.Item',
} as const satisfies Record<SynoSpace, string>;

/**
 * Cheap pre-filter so the bridge does not serialise unrelated page traffic.
 *
 * Deliberately narrow to the JSON endpoint. Synology Photos also uses a second,
 * separate API — `/synofoto/api/v2/t/Thumbnail/get?...&cache_key=...&SynoToken=...` —
 * which serves image bytes. Capturing those would mean cloning every thumbnail
 * the grid loads, for a body we could not read anyway.
 */
export function isWebApiUrl(url: string): boolean {
  return url.includes(WEBAPI_ENDPOINT);
}

/**
 * Identifies which library a `Browse.Item` call targets, or `undefined` if this
 * is not one.
 *
 * The method name arrives as a **path segment**, not a query parameter:
 *
 *     webapi/entry.cgi/SYNO.FotoTeam.Browse.Item
 *
 * Some calls are plain `webapi/entry.cgi` with the method presumably in the
 * form-encoded body; those simply return `undefined` here and are ignored,
 * which is the right outcome — a call we cannot identify is a call we should
 * not act on.
 *
 * Substring matching keeps this working for either shape. Order matters:
 * `SYNO.FotoTeam.` is checked first so a haystack containing it can never be
 * misread as the personal space.
 */
export function detectPhotoItemSpace(haystack: string): SynoSpace | undefined {
  if (haystack.includes(PHOTO_ITEM_METHODS.team)) return 'team';
  if (haystack.includes(PHOTO_ITEM_METHODS.personal)) return 'personal';
  return undefined;
}

/** Parses `additional.gps`, rejecting the partial or non-numeric shapes. */
export function parseGps(value: unknown): SynoGps | undefined {
  const latitude = readProp(value, 'latitude');
  const longitude = readProp(value, 'longitude');

  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return undefined;
  /* Synology reports 0/0 for items it failed to geotag. That is a real place in
   * the Gulf of Guinea, so treating it as data would drop a pin in the ocean. */
  if (latitude === 0 && longitude === 0) return undefined;
  if (latitude < -90 || latitude > 90) return undefined;
  if (longitude < -180 || longitude > 180) return undefined;

  return { latitude, longitude };
}

/** A displayable EXIF scalar: keep strings and numbers, drop anything else. */
function parseExifField(value: unknown): string | number | undefined {
  if (isString(value)) return value.trim() === '' ? undefined : value;
  if (isFiniteNumber(value)) return value;
  return undefined;
}

/**
 * Parses `additional.exif`.
 *
 * Synology returns these pre-formatted as strings, so we do not interpret them
 * — only keep the scalar fields we know how to show and discard the rest. A
 * consumer that `String()`s them is correct whether a value is a string or (on
 * some other device) a bare number.
 */
export function parseExif(value: unknown): SynoExif | undefined {
  if (!isRecord(value)) return undefined;

  const exif: SynoExif = {
    camera: parseExifField(value['camera']),
    lens: parseExifField(value['lens']),
    focal_length: parseExifField(value['focal_length']),
    aperture: parseExifField(value['aperture']),
    exposure_time: parseExifField(value['exposure_time']),
    iso: parseExifField(value['iso']),
  };

  /* All-empty EXIF is the same as no EXIF: a photo with the block present but
   * every field stripped should not light up the feature. */
  const hasAny = Object.values(exif).some((field) => field !== undefined);
  return hasAny ? exif : undefined;
}

function parseAdditional(value: unknown): SynoPhotoItem['additional'] {
  if (!isRecord(value)) return undefined;

  const gps = parseGps(value['gps']);
  const cacheKey = readPath(value, 'thumbnail', 'cache_key');
  const unitId = readPath(value, 'thumbnail', 'unit_id');
  const width = readPath(value, 'resolution', 'width');
  const height = readPath(value, 'resolution', 'height');
  const orientation = value['orientation'];

  return {
    gps,
    exif: parseExif(value['exif']),
    thumbnail: {
      cache_key: isString(cacheKey) ? cacheKey : undefined,
      unit_id: isFiniteNumber(unitId) ? unitId : undefined,
    },
    resolution: {
      width: isFiniteNumber(width) ? width : undefined,
      height: isFiniteNumber(height) ? height : undefined,
    },
    orientation: isFiniteNumber(orientation) ? orientation : undefined,
  };
}

/** `id` is the only field we require; everything else degrades to `undefined`. */
export function parsePhotoItem(value: unknown): SynoPhotoItem | undefined {
  if (!isRecord(value)) return undefined;

  const id = value['id'];
  if (!isFiniteNumber(id)) return undefined;

  const filename = value['filename'];
  const filesize = value['filesize'];
  const folderId = value['folder_id'];
  const ownerUserId = value['owner_user_id'];
  const time = value['time'];
  const type = value['type'];

  return {
    id,
    filename: isString(filename) ? filename : undefined,
    filesize: isFiniteNumber(filesize) ? filesize : undefined,
    folder_id: isFiniteNumber(folderId) ? folderId : undefined,
    owner_user_id: isFiniteNumber(ownerUserId) ? ownerUserId : undefined,
    time: isFiniteNumber(time) ? time : undefined,
    type: isString(type) ? type : undefined,
    additional: parseAdditional(value['additional']),
  };
}

/**
 * Pulls the items out of a `{ success, data: { list: [...] } }` envelope.
 *
 * Returns `[]` for an error envelope or any unrecognised shape — callers should
 * not have to distinguish "no photos" from "not a photo response".
 */
export function extractPhotoItems(body: unknown): readonly SynoPhotoItem[] {
  const list = readPath(body, 'data', 'list');
  if (!Array.isArray(list)) return [];

  const items: SynoPhotoItem[] = [];
  for (const entry of list) {
    const item = parsePhotoItem(entry);
    if (item) items.push(item);
  }
  return items;
}
