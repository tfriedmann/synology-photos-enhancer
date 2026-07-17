/**
 * Synology Photos routing model.
 *
 * The app is a React SPA using hash routing. Observed real-world shape:
 *
 *     #/shared_space/folder/1901/item/44246
 *     #/personal_space/timeline
 *
 * Two things to keep in mind before relying on any of this:
 *
 * 1. The `.../item/<id>` segment is only *confirmed* for folder views. Whether
 *    the timeline lightbox routes at all is unverified — see
 *    `docs/ARCHITECTURE.md`. This is why the router is a secondary signal and
 *    `photo:changed` is derived from network traffic instead.
 * 2. Synology can change this at any DSM release. Parsing is therefore
 *    deliberately tolerant: unknown shapes degrade to `raw` + `segments`
 *    rather than throwing.
 */

/** Top-level library section. `unknown` covers shapes we have not seen yet. */
export type PhotoSpace = 'personal_space' | 'shared_space' | 'unknown';

export interface Route {
  /** The hash as-is, without the leading `#`. Always present, never parsed away. */
  readonly raw: string;
  /** Path segments, already URI-decoded. */
  readonly segments: readonly string[];
  readonly space: PhotoSpace;
  /** First segment after the space, e.g. `timeline`, `folder`, `album`. */
  readonly view: string | undefined;
  /**
   * Numeric ids collected from `name/value` segment pairs, e.g.
   * `folder/1901/item/44246` yields `{ folder: 1901, item: 44246 }`.
   */
  readonly params: Readonly<Record<string, number>>;
  /** Convenience alias for `params.item`, the photo id when the URL exposes one. */
  readonly itemId: number | undefined;
}
