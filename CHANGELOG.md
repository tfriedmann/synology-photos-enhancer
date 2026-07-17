# Changelog

All notable changes to this project are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until 1.0.0, the minor version is the feature counter — see the
[roadmap](README.md#roadmap).

## [Unreleased]

## [0.5.0] — 2026-07-17

Camera details, and Street View — two features, one branch.

### Added

- **Camera details (EXIF).** A new plugin adds a **Camera** section to the
  lightbox info panel showing what Synology reads but never displays: camera,
  lens, focal length, aperture, shutter and ISO. On by default — the data is
  already in the payload the page fetched, so showing it sends nothing anywhere.
- **Street View** — a 🧍 button beside the location opens a Google Street View
  panorama. A dedicated button, not a dropdown choice: you keep your map _and_
  get Street View, rather than picking one. Always offered (like the address, it
  contacts a third party only on click), so no toggle. Not every spot has
  imagery, so it is best-effort where a map always works.

### Notes

- The EXIF values are displayed **exactly as Synology returns them** (`F1.8`,
  `1/60 s`, `6.9 mm`) — Synology pre-formats them, so reformatting would only
  risk mangling what is already right. The fixtures in the tests are real values
  captured from a live library, not invented ones.
- The camera section is keyed to the photo id, so moving between photos never
  shows one photo's settings under another's.
- Both features grew from a single payload capture that turned out to carry far
  more than expected — `additional` also exposes a structured `address`,
  `rating`, `person` and `tag`, noted in `docs/ARCHITECTURE.md` §8 for later.

## [0.4.0] — 2026-07-17

A map preview in the lightbox — and `locationLink` grows into `location`.

### Added

- **Map preview.** A 🗺 button beside the location opens an in-page map centred
  on the photo, with **+/- zoom**, the coordinates, an "open larger" link and
  OpenStreetMap attribution. Enable it from the **Location** row in the popup.
  Zoom is by button, not wheel — one deliberate tile request per press, never a
  burst — and the map stays centred on the photo (it does not pan).
- **The tiles come from OpenStreetMap, computed without a mapping library.**
  `src/plugins/location/tiles.ts` implements the standard Web Mercator
  projection (~40 lines), so the preview draws `<img>` tiles directly — no
  Leaflet, no runtime dependency, no API key.
- **`findLightboxAddress` moved to `src/api/selectors.ts`** — shared
  Synology-DOM knowledge, since plugins may not import each other.

### Changed

- **`locationLink` is now `location`, and absorbs the map preview.**

  These were going to be two plugins — a link and a mini map. They cannot be,
  for the same reason `openStreetMap` could not be its own plugin in 0.3.0: they
  must **share one setting**, the map provider, and a plugin cannot read another
  plugin's options. Two plugins that must share a preference are one feature.

  So one plugin owns the address text (click → open in Google or OSM) _and_ the
  🗺 button beside it (click → preview). A single plugin owning two nodes is fine;
  the rule only forbids two plugins owning the same node.

  The preview's tiles are always OSM's — the only free, keyless source — but its
  "open larger" link follows your chosen provider. OSM tiles, a Google link if
  that is what you picked: the honest best of both.

  Breaking: the plugin id changed from `location-link` to `location`, so the
  provider preference resets once.

### Notes

- **The preview is off by default and loads on demand.** A map means fetching
  tiles from a third party. Rendering it automatically would send the location
  of every geotagged photo you view to OpenStreetMap — quietly breaking the
  "nothing is sent anywhere" promise. So the button is opt-in and the only tile
  request happens on click.
- **Robust to a strict CSP.** If Synology's `img-src` blocks the tiles, each
  failed tile is removed and the popup still shows the coordinates and the link.

## [0.3.0] — 2026-07-17

OpenStreetMap — and a course correction the roadmap could not have foreseen.

### Added

- **OpenStreetMap** as a map provider. Pick it from the dropdown under
  **Clickable location** in the popup. Drops a marker (`mlat`/`mlon`) and frames
  it (`#map=`).
- **Per-plugin options.** `Settings.options` stores each plugin's preferences
  under its id and is **opaque to the core** — plugins parse their own slice.
  A plugin declares its settings UI via `Plugin.renderOptions()`, so the popup
  renders it without ever learning what it is.

### Changed

- **`googleMaps` is now `locationLink`, with maps as data rather than plugins.**

  Shipping `openStreetMap` as a second plugin was the plan, and it does not
  work: both would target the _same_ element — Synology's address line — with
  two classes and two click listeners, so one click opens two tabs. They could
  not negotiate either, because plugins are forbidden from knowing about each
  other, which is the rule the whole architecture rests on. Two plugins that
  cannot coexist are not two features; they are one feature cut in the wrong
  place.

  So the plugin owns the element and a provider is a name plus a
  `gps => url` function. Adding one is four lines and cannot conflict with
  anything. **Street View (v0.6.0) belongs here too** — it targets the same
  element, so it is a provider, not a plugin.

  Your enable/disable preference for `google-maps` is reset once, since the
  plugin id changed. Google Maps stays the default.

### Notes

The rule this release adds, in `docs/ARCHITECTURE.md`: when a "feature" wants a
node another plugin already owns, that is the signal it is not a separate
plugin.

## [0.2.0] — 2026-07-17

The first feature, and the first proof the architecture pays off: it is one
folder and one line in `src/plugins/index.ts`. The core did not change.

### Added

- **Google Maps plugin.** The photo's location becomes clickable and opens in
  Google Maps. On by default; toggle it in the popup. Works in both the
  personal and shared libraries.
- **`src/api/selectors.ts`** — Synology's DOM selectors, centralised. When DSM
  changes its markup, this is the blast radius. Class names only: Synology
  localises its labels, so any text-based selector is broken outside its author's
  language.
- **`src/ui/pageStyles.ts`** — a narrow, documented exception to the
  shadow-root rule, for plugins that augment Synology's own UI in place and so
  must style a node inside their tree. `spe-`-namespaced selectors only, removed
  on teardown.

### Notes

The plugin never touches Synology's DOM children. Replacing the address line's
contents with an `<a>` — the obvious approach — destroys the address text, goes
stale when React reuses a node and swaps only the text (showing the new photo's
address over the _previous_ photo's coordinates), and starts a rewrite loop with
React. Instead it adds a class, `role` and `tabindex` to their element and reads
the GPS at click time, which makes staleness unrepresentable. Cost to Synology's
DOM: one attribute.

## [0.1.0] — 2026-07-17

Foundation release. **No user-facing feature, on purpose**: this is the base
that features plug into. The first one (Google Maps) lands in 0.2.0.

### Added

- **Plugin system.** `definePlugin()`, per-plugin `PluginContext`, enable/disable
  from the popup. A plugin that throws is disabled on its own and takes nothing
  else down.
- **Typed EventBus.** `photo:changed`, `route:changed`, `api:response`,
  `dom:mutation`. Unsubscribe via `AbortSignal`; a throwing listener cannot stop
  delivery to the others.
- **MAIN world network bridge.** Hooks the page's `XMLHttpRequest` and `fetch`
  at `document_start` and forwards Synology `/webapi/` responses across a
  validated `postMessage` boundary. Also reports `pushState`/`replaceState`,
  which fire no event of their own.
- **`photo:changed` derived from network traffic**, covering both the personal
  (`SYNO.Foto.*`) and shared (`SYNO.FotoTeam.*`) libraries. Multi-item listings
  are ignored, so a background grid refresh cannot clobber the open photo — the
  root cause of the familiar "GPS keeps getting cleared" symptom.
- **Runtime content-script registration.** No permission is requested at install
  time. The user grants one origin from the popup ("Enable on this site") and
  the service worker registers the scripts for it — the only approach that works
  given that NAS hostnames are arbitrary (custom ports, DDNS, QuickConnect,
  reverse proxies). Uses `activeTab` so the popup can read the current tab's URL
  when you click the icon, without the install-time warning that `"tabs"` would
  bring.
- **Router.** Tolerant hash parsing that degrades to `raw` + `segments` on
  shapes we have not seen, rather than throwing.
- **Batched DOM observer** (one callback per animation frame) and
  `waitForElement()`.
- **Shadow-DOM UI layer** with `button`, `panel` and in-page `popup` primitives,
  isolated from Synology's ~442 KB stylesheet.
- **Namespaced logger** with user-settable level, defaulting to `warn`.
- **Settings** in `chrome.storage.sync`, parsed field-by-field so one bad value
  cannot discard the rest.
- **`dev-probe` plugin** (off by default): logs every core event. Proves the
  chain end to end and doubles as the reference plugin.
- **Tooling.** Vite 8 + CRXJS 2.7, strict TypeScript, ESLint 10 flat config,
  Prettier, Vitest (188 tests), CI and tag-driven release workflows.

### Notes

- **Zero runtime dependencies.**
- **`typescript` is pinned to `6.0.3` exactly.** TypeScript 7 ships no
  programmatic API until 7.1, and `typescript-eslint` refuses it; forcing it
  breaks ESLint outright. See [CONTRIBUTING.md](CONTRIBUTING.md).
- Chrome and Edge only (Chrome 116+). Firefox is not a target for now.
- Known open questions are tracked in
  [§8 of the architecture doc](docs/ARCHITECTURE.md#8-what-we-do-not-know) —
  chiefly whether the timeline lightbox routes at all.

[Unreleased]: https://github.com/tfriedmann/synology-photos-enhancer/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/tfriedmann/synology-photos-enhancer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/tfriedmann/synology-photos-enhancer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tfriedmann/synology-photos-enhancer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tfriedmann/synology-photos-enhancer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tfriedmann/synology-photos-enhancer/releases/tag/v0.1.0
