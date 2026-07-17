# Synology Photos Enhancer

> A browser extension that adds features to the Synology Photos web app.
> No NAS-side changes, no third-party servers, no telemetry.

[![CI](https://github.com/tfriedmann/synology-photos-enhancer/actions/workflows/ci.yml/badge.svg)](https://github.com/tfriedmann/synology-photos-enhancer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Synology Photos is a good place to keep your photos and a frustrating place to
_use_ them. The location is written under the picture but you cannot click it.
The EXIF panel shows a fraction of what the file contains. There is no map.

This extension adds those things from the browser, as plugins. It talks only to
your NAS, over your own session — nothing is installed on the NAS, nothing is
sent anywhere else.

> **Status: v0.1.0 — architecture only.**
> This release ships the foundation and deliberately **no user-facing feature**.
> Features land one per release, starting with Google Maps in v0.2.0. See the
> [roadmap](#roadmap).

---

## Contents

- [Planned features](#planned-features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Permissions](#permissions-and-privacy)
- [Development](#development)
- [Build](#build)
- [Architecture](#architecture)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Planned features

| Feature       | Version | What it does                                         |
| ------------- | ------- | ---------------------------------------------------- |
| Google Maps   | v0.2.0  | Makes the photo's location clickable, opens in Maps. |
| OpenStreetMap | v0.3.0  | Same, for people who prefer OSM.                     |
| Mini map      | v0.4.0  | An inline map preview in the lightbox info panel.    |
| Advanced EXIF | v0.5.0  | The full EXIF payload, not Synology's subset.        |
| Street View   | v0.6.0  | Opens the shooting location in Street View.          |
| World map     | v0.7.0  | Every geotagged photo in your library on one map.    |
| Statistics    | v0.8.0  | Counts by camera, lens, year, place.                 |

Each is an independent plugin, individually toggleable, and none of them exists
yet — v0.1.0 is the base they plug into.

## Screenshots

> Placeholders until v0.2.0 ships something to look at.

| Lightbox with map link | Extension popup |
| :--------------------: | :-------------: |
|       _(v0.2.0)_       |   _(v0.1.0)_    |

## Installation

Not on the Chrome Web Store yet. Until then, load it unpacked:

```bash
git clone https://github.com/tfriedmann/synology-photos-enhancer.git
cd synology-photos-enhancer
npm install
npm run build
```

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. Open your Synology Photos tab.
5. Click the extension icon → **Enable on this site** → accept.
6. **Reload the tab.**

Steps 5 and 6 are not busywork, and step 6 is not optional — see below.

## Permissions and privacy

**On install, this extension asks for nothing** — no permission prompt, no "read
and change all your data on all websites". Check for yourself: the built
`dist/manifest.json` has no `content_scripts` and no `host_permissions`.

It does declare `activeTab`, which lets the popup see the address of the tab you
are on **at the moment you click the icon** — it needs that to know which origin
to ask about. `activeTab` grants nothing until you click and carries no
install-time warning, which is why it is used instead of the blunt `"tabs"`
permission.

That is unusual, and it is because of a real constraint. A Synology NAS can live
at any address: `https://nas:5001`, `http://192.168.1.42:5000`,
`https://mynas.synology.me`, `https://praha.cz2.quickconnect.to`, or a reverse
proxy on your own domain. DSM's Login Portal lets an admin change the alias,
port and domain per app. There is no match pattern that covers that, so the
usual shortcut is to request _all websites_ and check at runtime.

We do the opposite: you click **Enable on this site**, Chrome asks about that
**one origin**, and the extension registers its scripts only there. Everywhere
else it does not exist. Revoke it any time from the popup or
`chrome://extensions`.

The reload in step 6 is a Chrome rule, not an oversight: content scripts inject
at page load, and a page already open when you granted access has missed it.

**Data.** Everything runs in your browser and talks only to your NAS, over the
session you are already logged into. No analytics, no telemetry, no external
service. Settings live in `chrome.storage.sync` (a handful of booleans, synced
by your browser profile). Photos and metadata are never sent anywhere.

## Development

**Requires Node 22.12+** (CI runs Node 24 LTS; `.nvmrc` pins it).

```bash
npm install
npm run dev      # Vite dev server + HMR
npm test         # Vitest
npm run verify   # format + lint + typecheck + test + build — what CI runs
```

Load `dist/` unpacked as above. `npm run dev` rebuilds on save; extension pages
hot-reload, content scripts trigger a page reload.

### A trap worth knowing about

**`typescript` is pinned to `6.0.3` on purpose. Do not run `npm install typescript`.**

TypeScript 7 (the native Go port) is `latest` on npm but ships **no programmatic
API** until 7.1. `typescript-eslint` declares a `<6.1.0` peer range and refuses
it; forced through, ESLint dies with `Cannot read properties of undefined
(reading 'Cjs')`. The upstream issue is closed as _not planned_ — the fix has to
come from TypeScript. So the version is exact (no `^`), and it stays that way
until typescript-eslint announces TS 7 support.

### Scripts

| Script                  | Purpose                       |
| ----------------------- | ----------------------------- |
| `npm run dev`           | Dev server with HMR           |
| `npm run build`         | Production build into `dist/` |
| `npm test`              | Run the test suite            |
| `npm run test:watch`    | Tests in watch mode           |
| `npm run test:coverage` | Coverage report               |
| `npm run lint`          | ESLint                        |
| `npm run typecheck`     | `tsc --noEmit`                |
| `npm run format`        | Prettier, write               |
| `npm run verify`        | Everything CI runs, in order  |

## Build

```bash
npm run build   # → dist/
```

`dist/` is a loadable, publishable extension. Tagging `v*` builds it in CI and
attaches a zip to a GitHub Release.

## Architecture

```
src/
  entries/     # The 4 things Chrome loads: SW, MAIN world, ISOLATED world, popup
  core/        # EventBus, logger, router, observer, settings, plugin lifecycle
  bridge/      # MAIN ↔ ISOLATED world plumbing (the XHR/fetch hook)
  api/         # Synology payload types and parsers — the only Synology-aware layer
  ui/          # Shadow-DOM UI primitives
  plugins/     # One folder per feature. The core never imports this.
  utils/ types/ styles/
```

Three ideas hold it together:

1. **Everything is a plugin, and the core never depends on one.** The arrow
   points one way: plugins import the core, never the reverse. The only place
   they meet is `entries/content-isolated.ts`. It is enforced by ESLint, not by
   good intentions — so a plugin stays deletable years from now.

2. **Plugins never talk to each other.** They subscribe to a typed EventBus:
   `photo:changed`, `route:changed`, `api:response`, `dom:mutation`. Ten plugins
   stay ten independent things instead of a graph.

3. **The interesting data comes from the network, not the DOM.** Synology's own
   API carries the GPS and the `cache_key` — and `cache_key` appears nowhere in
   the URL, so the URL alone is never enough. A MAIN world script hooks
   `XMLHttpRequest`/`fetch` and forwards responses across a `postMessage`
   bridge.

Why two worlds, why the network, why a shadow root, and what is still unproven:
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

Writing a plugin is a folder and one line: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Roadmap

| Version | Scope                                           | Status  |
| ------- | ----------------------------------------------- | ------- |
| v0.1.0  | Architecture: plugin system, EventBus, XHR hook | ✅      |
| v0.2.0  | Google Maps — clickable location                | Next    |
| v0.3.0  | OpenStreetMap                                   | Planned |
| v0.4.0  | Mini map in the lightbox                        | Planned |
| v0.5.0  | Advanced EXIF                                   | Planned |
| v0.6.0  | Street View                                     | Planned |
| v0.7.0  | World map of the whole library                  | Planned |
| v0.8.0  | Statistics                                      | Planned |

Beyond that: Chrome Web Store publication, i18n, and possibly Firefox.

## Contributing

Issues and pull requests welcome — especially bug reports from DSM versions and
setups other than the author's. Synology documents none of this API, so every
observation from a different NAS is genuinely useful.

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** first.

## License

[MIT](LICENSE) © tfriedmann

Not affiliated with, endorsed by, or supported by Synology Inc. "Synology" and
"Synology Photos" are trademarks of Synology Inc. This project reads its web
app's public traffic from your own browser session; it is an independent,
unofficial tool.
