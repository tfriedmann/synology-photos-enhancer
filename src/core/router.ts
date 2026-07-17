import type { PhotoSpace, Route } from '@/types/route';

/**
 * Reads Synology Photos' hash route.
 *
 * Parsing is deliberately tolerant. We are reverse-engineering a URL scheme
 * that Synology can change in any DSM update, so an unrecognised shape must
 * degrade into `raw` + `segments` — never throw, never guess. A plugin that
 * needs a shape we failed to parse can always read `raw` itself.
 *
 * The router is a *secondary* signal. It tells you where the user navigated,
 * not which photo they are looking at: the `item/<id>` segment is only
 * confirmed for folder views, and the timeline lightbox may not route at all.
 * `photo:changed` comes from the network instead — see `photoContext.ts`.
 */

const KNOWN_SPACES: readonly PhotoSpace[] = ['personal_space', 'shared_space'];

function toSpace(segment: string | undefined): PhotoSpace {
  return KNOWN_SPACES.find((space) => space === segment) ?? 'unknown';
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    /* Malformed percent-encoding: the raw segment is more useful than a crash. */
    return segment;
  }
}

/**
 * @param hash Location hash, with or without the leading `#`.
 *
 * @example
 * parseRoute('#/shared_space/folder/1901/item/44246')
 * // → { space: 'shared_space', view: 'folder', params: { folder: 1901, item: 44246 }, itemId: 44246 }
 */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;

  const segments = raw
    .split('?')[0]
    ?.split('/')
    .filter((segment) => segment.length > 0)
    .map(decode);

  const parts: readonly string[] = segments ?? [];
  const space = toSpace(parts[0]);

  /* Segments after the space read as `name/value` pairs
   * (`folder/1901/item/44246`). Walking in twos keeps unknown view types
   * working for free: a future `album/12` needs no code change here. */
  const rest = space === 'unknown' ? parts : parts.slice(1);
  const params: Record<string, number> = {};

  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i];
    const value = rest[i + 1];
    if (name === undefined || value === undefined) break;
    /* Only numeric ids: a non-numeric pair is a path, not a parameter. */
    if (!/^\d+$/.test(value)) continue;
    params[name] = Number(value);
  }

  return {
    raw,
    segments: parts,
    space,
    view: rest[0],
    params,
    itemId: params['item'],
  };
}

/** True when two routes address the same location. Used to suppress no-op events. */
export function isSameRoute(a: Route | undefined, b: Route): boolean {
  return a?.raw === b.raw;
}

export interface RouterOptions {
  readonly onChange: (route: Route, previous: Route | undefined) => void;
  /** Injected for tests. Defaults to the real `window`. */
  readonly scope?:
    Pick<Window, 'addEventListener' | 'removeEventListener' | 'location'> | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface Router {
  readonly current: Route;
  /**
   * Re-reads the location and fires `onChange` if it moved. Called by the core
   * when the MAIN world reports a `pushState`/`replaceState`, which fire no
   * event of their own.
   */
  refresh(): void;
}

export function createRouter(options: RouterOptions): Router {
  const scope = options.scope ?? window;
  let current = parseRoute(scope.location.hash);

  const refresh = (): void => {
    const next = parseRoute(scope.location.hash);
    if (isSameRoute(current, next)) return;
    const previous = current;
    current = next;
    options.onChange(next, previous);
  };

  const listenerOptions = options.signal ? { signal: options.signal } : undefined;
  scope.addEventListener('hashchange', refresh, listenerOptions);
  scope.addEventListener('popstate', refresh, listenerOptions);

  return {
    get current() {
      return current;
    },
    refresh,
  };
}
