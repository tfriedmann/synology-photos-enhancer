# Changelog

All notable changes to this project are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until 1.0.0, the minor version is the feature counter — see the
[roadmap](README.md#roadmap).

## [Unreleased]

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
  [§7 of the architecture doc](docs/ARCHITECTURE.md#7-what-we-do-not-know) —
  chiefly whether the timeline lightbox routes at all.

[Unreleased]: https://github.com/tfriedmann/synology-photos-enhancer/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/tfriedmann/synology-photos-enhancer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tfriedmann/synology-photos-enhancer/releases/tag/v0.1.0
