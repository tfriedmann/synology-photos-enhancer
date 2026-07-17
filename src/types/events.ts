import type { Route } from './route';
import type { SynoGps, SynoPhotoItem, SynoSpace } from './synology';

/**
 * Every event a plugin can subscribe to. This map is the whole contract between
 * the core and the plugins — plugins never call each other, they only read from
 * here (see `docs/ARCHITECTURE.md`).
 *
 * Adding an event means adding a line here; the EventBus is typed off this map,
 * so a typo in an event name is a compile error rather than a silent no-op.
 */
export interface AppEventMap {
  /**
   * A Synology `/webapi/` call completed. Emitted from the MAIN world bridge,
   * which sees the page's own XHR and fetch traffic.
   *
   * `body` is `unknown` on purpose: it crosses a `postMessage` boundary from a
   * server we do not control. Narrow it with the guards in `src/api/synology.ts`.
   */
  'api:response': {
    readonly url: string;
    readonly method: string;
    readonly status: number;
    readonly body: unknown;
  };

  /** The hash route changed. Also fires for `pushState`/`replaceState`. */
  'route:changed': {
    readonly route: Route;
    readonly previous: Route | undefined;
  };

  /**
   * A batch of DOM mutations, coalesced into one animation frame.
   *
   * Synology Photos is React-driven and rebuilds panels constantly, so this
   * fires often. Do the cheapest possible check first, and prefer
   * `waitForElement()` when you are only waiting for one node to appear.
   */
  'dom:mutation': {
    readonly mutations: readonly MutationRecord[];
  };

  /**
   * The photo currently being viewed changed.
   *
   * Derived from network traffic rather than the URL: the timeline lightbox may
   * not route at all, and `cache_key` never appears in the URL. See
   * `src/core/photoContext.ts`.
   */
  'photo:changed': {
    readonly item: SynoPhotoItem;
    readonly space: SynoSpace;
    /** Hoisted out of `item.additional` because nearly every map plugin wants it. */
    readonly gps: SynoGps | undefined;
  };
}

export type AppEventName = keyof AppEventMap;
