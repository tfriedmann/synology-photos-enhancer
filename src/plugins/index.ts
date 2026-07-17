import type { Plugin } from '@/core/plugin';

import devProbe from './devProbe';
import location from './location';

/**
 * The plugin registry — the single list of everything that ships.
 *
 * ## The one rule
 *
 * This file is imported by exactly one consumer:
 * `src/entries/content-isolated.ts`, which passes the list to `bootstrap()`.
 *
 * Nothing in `core/`, `api/`, `bridge/`, `ui/` or `utils/` may import it, and
 * ESLint fails the build if anything tries. That keeps the dependency arrow
 * pointing one way for good: plugins know about the core, the core knows
 * nothing about plugins. It is what makes a plugin deletable — remove the
 * folder, remove its line here, done — and it is the whole reason this codebase
 * can absorb a dozen more features without turning into a graph.
 *
 * ## Adding a plugin
 *
 * 1. `src/plugins/<name>/index.ts`, default-exporting `definePlugin({ ... })`.
 * 2. Import it here and add it to the array.
 *
 * That is the entire wiring. See `CONTRIBUTING.md`.
 *
 * Order is not significant: plugins are set up concurrently and must never
 * depend on each other. If two of them need to agree on something, that is an
 * event on the bus, not an ordering constraint here.
 */
export const plugins: readonly Plugin[] = [
  devProbe,
  location,

  /* Coming per the roadmap — each lands as its own folder + one line here:
   *   v0.5.0  exif
   *   v0.8.0  statistics
   * They are deliberately absent rather than stubbed: an empty folder is dead
   * code that has to be maintained and explained until the day it is filled.
   *
   * Note what is *not* on this list. Street View (v0.6.0) targets the same
   * element as `location` and would fight it for ownership, exactly as a
   * separate `openStreetMap` plugin would have. It belongs in
   * `location/providers.ts` as a provider, not here as a plugin. When a
   * "feature" wants a node another plugin already owns, that is the signal it is
   * not a separate plugin. */
];
