import type { SynoGps } from '@/types/synology';
import { isRecord, isString } from '@/utils/guards';

/**
 * Map providers — deliberately **data, not plugins**.
 *
 * The instinct is to make each provider its own plugin: `googleMaps`,
 * `openStreetMap`, one folder each, one line each in the registry. It does not
 * work, and the reason is worth recording because it will be tempting again.
 *
 * Both would target the *same* DOM element — Synology's address line. Two
 * plugins, two classes, two click listeners on one node: clicking it opens two
 * tabs. And they could not negotiate, because plugins are forbidden from
 * knowing about each other, which is the rule the whole architecture rests on.
 * Two plugins that cannot coexist are not two features; they are one feature
 * cut in the wrong place.
 *
 * So the plugin owns the element, and a provider is just a name and a function
 * from coordinates to a URL. Adding one is four lines and cannot conflict with
 * anything. Street View (roadmap v0.6.0) targets the same element and drops in
 * here too.
 */

export interface MapProvider {
  /** Stable: it is persisted as the user's choice. Renaming it resets their setting. */
  readonly id: string;
  /** Shown in the popup. */
  readonly name: string;
  buildUrl(gps: SynoGps): string;
}

/**
 * Uses the documented Maps URL API rather than the shorter legacy `?q=lat,lng`,
 * which Google has never committed to.
 */
const google: MapProvider = {
  id: 'google',
  name: 'Google Maps',
  buildUrl: (gps) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${String(gps.latitude)},${String(gps.longitude)}`,
    )}`,
};

/**
 * `mlat`/`mlon` drop the marker; the `#map=` fragment sets the view. Both are
 * needed — the query alone centres the map without marking the spot.
 */
const openStreetMap: MapProvider = {
  id: 'osm',
  name: 'OpenStreetMap',
  buildUrl: (gps) => {
    const lat = String(gps.latitude);
    const lon = String(gps.longitude);
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  },
};

export const MAP_PROVIDERS: readonly MapProvider[] = [google, openStreetMap];

export const DEFAULT_PROVIDER_ID = google.id;

/** The plugin's persisted options. */
export interface LocationOptions {
  /** Which map the link and "open larger" point at. */
  readonly provider: string;
  /**
   * Whether the 🗺 map-preview button is shown.
   *
   * Off by default: the preview fetches tiles from a third party, so it is
   * opt-in even though the rest of the plugin (a link) sends nothing until
   * clicked. See the plugin doc.
   */
  readonly preview: boolean;
}

/**
 * Reads the stored options.
 *
 * Total by design: storage is user-editable and survives upgrades, so an
 * unknown or malformed value must fall back field by field rather than break
 * the feature — a removed provider should not leave someone with a dead link.
 */
export function parseOptions(value: unknown): LocationOptions {
  const record = isRecord(value) ? value : {};

  const stored = record['provider'];
  const provider =
    isString(stored) && MAP_PROVIDERS.some((p) => p.id === stored) ? stored : DEFAULT_PROVIDER_ID;

  /* Strict `=== true`: any other stored value means "not enabled", which is the
   * safe default for something that talks to a third party. */
  const preview = record['preview'] === true;

  return { provider, preview };
}

/** Resolves stored options to a provider, always returning one. */
export function resolveProvider(value: unknown): MapProvider {
  const { provider } = parseOptions(value);
  return MAP_PROVIDERS.find((p) => p.id === provider) ?? google;
}
