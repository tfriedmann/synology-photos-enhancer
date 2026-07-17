/**
 * Synology Photos DOM selectors — the single place they are allowed to live.
 *
 * Same principle as the rest of `api/`: when DSM changes its markup, this file
 * is the blast radius. A plugin that inlines `.synofoto-…` somewhere in its own
 * logic is a plugin that breaks silently and separately from every other one.
 *
 * ## Two rules, both learned the hard way
 *
 * 1. **Class names only. Never match on visible text.** Synology localises its
 *    labels and tooltips: `data-tooltip-content` is `"Delete"` in English and
 *    `"삭제"` in Korean. Existing userscripts in the wild match one or the other
 *    and are silently broken for everyone else. A class name is the same in
 *    every locale.
 * 2. **Never assume a node exists.** These describe an app we do not control,
 *    observed at one point in time. Every lookup must degrade to "feature
 *    absent", never to an exception in someone's photo library.
 *
 * Verified against DSM 7 (2026-07). If a selector stops matching, that is a
 * DSM change, not a bug in the plugin using it — fix it here, once.
 */
export const SELECTORS = {
  /**
   * The location row's icon, in the lightbox info panel.
   *
   * The anchor for finding the address: it is a *sibling* of the info block,
   * so the traversal is `indicator → parentElement → info block → second line`.
   * Only present when the photo actually has a location.
   */
  locationIndicator: '.synofoto-indicator-photo-location',

  /** The text block next to an indicator icon. */
  infoBlock: '.synofoto-lightbox-info-block',

  /** Within a location block: the street address. The first line is the place name. */
  infoSecondLine: '.synofoto-lightbox-info-second-line',
} as const;

/**
 * Finds the address line in the lightbox info panel.
 *
 * Lives here, not in a plugin, because more than one plugin needs it —
 * `locationLink` makes it clickable, `miniMap` anchors a preview beside it — and
 * plugins may not import each other. This is shared Synology-DOM knowledge, so
 * it belongs in `api/` with the selectors it uses.
 *
 * Mirrors the app's structure: the location icon and the info block are
 * siblings, so the address is reached through their shared parent. Returns
 * `undefined` whenever any link in the chain is missing — the normal case for a
 * photo with no location, not an error.
 */
export function findLightboxAddress(root: ParentNode = document): HTMLElement | undefined {
  const indicator = root.querySelector(SELECTORS.locationIndicator);
  const block = indicator?.parentElement?.querySelector(SELECTORS.infoBlock);
  return block?.querySelector<HTMLElement>(SELECTORS.infoSecondLine) ?? undefined;
}
