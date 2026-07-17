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

/** `additional` is opt-in per request, so any of it may be absent. */
export interface SynoItemAdditional {
  readonly gps?: SynoGps | undefined;
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
