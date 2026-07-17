/**
 * Types for the Synology Photos web API.
 *
 * Synology publishes no official documentation for the Photos API (unlike
 * FileStation), so every field here is derived from observed traffic — chiefly
 * a working `SYNO.FotoTeam.Browse.Item` response. Treat these as a *best
 * current understanding*, not a contract: they describe a payload we do not
 * own and cannot version.
 *
 * Consequently every field beyond `id` is optional, and nothing is trusted
 * without a runtime guard (see `src/api/synology.ts`). A missing field must
 * degrade a feature, never throw.
 */

export interface SynoGps {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Camera metadata (EXIF), as Synology returns it under `additional.exif`.
 *
 * Confirmed on a live library (2026-07-17): every value arrives **already
 * formatted as a string** — `"F1.8"`, `"1/60 s"`, `"6.9 mm"`, `"160"`. Synology
 * does the formatting, so consumers display these as-is rather than parsing
 * them. The type still admits `number` per field, defensively, in case a
 * different device or DSM version returns a raw value — a consumer that only
 * ever calls `String()` on them stays correct either way.
 */
export interface SynoExif {
  readonly camera?: string | number | undefined;
  readonly lens?: string | number | undefined;
  readonly focal_length?: string | number | undefined;
  readonly aperture?: string | number | undefined;
  readonly exposure_time?: string | number | undefined;
  readonly iso?: string | number | undefined;
}

/** `additional` is opt-in per request, so any of it may be absent. */
export interface SynoItemAdditional {
  readonly gps?: SynoGps | undefined;
  readonly exif?: SynoExif | undefined;
  readonly thumbnail?:
    | {
        /** Required to build a thumbnail URL, and notably absent from the page URL. */
        readonly cache_key?: string | undefined;
        readonly unit_id?: number | undefined;
      }
    | undefined;
  readonly resolution?:
    { readonly width?: number | undefined; readonly height?: number | undefined } | undefined;
  readonly orientation?: number | undefined;
}

export interface SynoPhotoItem {
  readonly id: number;
  readonly filename?: string | undefined;
  readonly filesize?: number | undefined;
  readonly folder_id?: number | undefined;
  readonly owner_user_id?: number | undefined;
  /** Unix seconds. */
  readonly time?: number | undefined;
  readonly type?: string | undefined;
  readonly additional?: SynoItemAdditional | undefined;
}

/** Envelope shared by every `/webapi/` endpoint. */
export interface SynoApiEnvelope {
  readonly success?: boolean | undefined;
  readonly error?: { readonly code?: number | undefined } | undefined;
  readonly data?: { readonly list?: readonly SynoPhotoItem[] | undefined } | undefined;
}

/** Which library an item came from — the two spaces use different API methods. */
export type SynoSpace = 'personal' | 'team';
