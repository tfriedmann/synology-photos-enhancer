# Architecture

Why this codebase looks the way it does.

Code says _what_. This file says _why_, and — just as importantly — **what we do
not know**. Most of what follows is reverse-engineered from an undocumented API;
in a year the temptation will be to "simplify" something whose reason has been
forgotten. If you are about to do that, the reason is probably here.

Each decision below records what was rejected and what would change our mind.

---

## 1. Two content scripts, not one

**Decision.** Two separate bundles: `content-main.iife.ts` in the MAIN world and
`content-isolated.ts` in the ISOLATED world, connected by `window.postMessage`.

**Why.** Chrome leaves no choice:

- Hooking `XMLHttpRequest` means patching **the page's** `window`. A content
  script in the ISOLATED world gets its own `XMLHttpRequest` object — patching it
  observes nothing, because it is not the one Synology calls. (A Tampermonkey
  `@grant none` script gets MAIN world access for free, which is why the
  original userscript needed no bridge.)
- `chrome.*` exists **only** in the ISOLATED world.

One script cannot do both. The bridge is the cost of that, not a design flourish.

**Consequences.**

- The MAIN world entry must be **IIFE**, for three independent reasons:
  `registerContentScripts` does not accept ES modules; the CRXJS module loader
  calls `chrome.runtime.getURL()`, which is undefined in the MAIN world; and
  that loader is `await import(...)` — asynchronous, so it would arrive _after_
  the app's first requests. Patching an XHR that has already been called
  observes nothing. Hence the `.iife` in the filename, which is how CRXJS knows.
- Everything crossing the bridge is `unknown` and must be narrowed
  (`src/utils/guards.ts`, `src/api/synology.ts`).
- `postMessage` on a page is public. The page can read our messages and forge
  them. That is unavoidable — the MAIN world _is_ the page — so the protocol
  authenticates nothing and instead validates everything
  (`readBridgeMessage` rejects any message not from this window at this origin).
  Nothing we send is secret and nothing we receive is trusted, so forgery buys
  an attacker only what they could already do to their own page.

**Rejected.** A single ISOLATED script polling the DOM. It cannot see
`cache_key` (§4), and it would mean re-deriving from pixels what the API already
states.

---

## 2. No `content_scripts` in the manifest — runtime registration instead

**Decision.** The manifest declares no `content_scripts` and no
`host_permissions`. It declares `optional_host_permissions: ["*://*/*"]` plus
`activeTab`. The user grants **one origin** from the popup; the service worker
then registers both scripts for it.

**Why.** Synology NAS hostnames are arbitrary, and this is not a hypothetical —
these are real deployments seen in the wild:

| Shape                         | Example                                      |
| ----------------------------- | -------------------------------------------- |
| Custom HTTPS port             | `https://nas:5001`                           |
| Bare LAN hostname over HTTP   | `http://aynas:5000`                          |
| LAN IP                        | `http://192.168.1.42:5000`                   |
| Synology DDNS                 | `https://mynas.synology.me`                  |
| QuickConnect, regional prefix | `https://akapraha.cz2.quickconnect.to`       |
| Reverse proxy, own domain     | `https://photos.example.com`                 |
| Unusual ports                 | `:2518`, `:4443`, `:8004`, `:9530`, `:15001` |

The root cause: DSM's **Login Portal** lets an admin set the alias, port and
domain per application. No static match pattern can cover that.

The usual workaround is `content_scripts` on `<all_urls>` plus a runtime check.
That demands _"read and change all your data on all websites"_ at install time,
and injects into every page the user ever opens, to serve one host. For an
extension whose whole job is to read a photo library, that trade is bad.

### The chicken-and-egg: `activeTab`

Asking for one origin means knowing which origin. But with no host permission,
**Chrome blanks `tab.url` on every tab** — so the popup cannot learn the URL it
needs in order to ask for it. Omitting `activeTab` makes the popup report
_"Not a web page"_ for every site, including the NAS. (It did. That is why this
section exists.)

`activeTab` grants temporary access to the current tab **at the moment the user
invokes the extension** — clicking the icon — which is exactly when the popup
needs it, and never otherwise.

It is the right tool rather than a workaround: it carries **no install-time
warning**, so a fresh install still asks for nothing. The lazy alternative,
`"tabs"`, would hand us every tab's URL forever and display _"Read your browsing
history"_ — for an extension that reads one photo library, an absurd trade.

**Consequences** — Chrome's rules, each of which bites if ignored:

- `registerContentScripts` **throws** if `matches` is not already covered by a
  granted permission → always register _after_ the grant.
- `permissions.request()` only works inside a **user gesture** → it lives in the
  popup and cannot move to the service worker.
- `persistAcrossSessions` defaults to `true` → registrations survive restarts,
  and re-registering an existing id throws. `syncRegistrations()` therefore
  reconciles to a target state instead of applying deltas, and must be correct
  when a previous session already registered something.
- Built file paths change on every update → re-sync on `onInstalled` **and**
  `onStartup`, or a persisted registration will point at a file that no longer
  exists.
- A page open at grant time has already missed injection → the popup tells the
  user to reload. This is Chrome's behaviour, not a bug we can fix.

**Known cost.** `optional_host_permissions: ["*://*/*"]` is broad and may draw
questions at Chrome Web Store review. The justification is this section. Note
the extension never _requests_ the broad pattern — only the single origin the
user picked.

**Rejected.** Pre-declaring `*.quickconnect.to` and `*.synology.me`: the table
above shows they cover a minority of real installs. As a _shortcut_ in the popup
they would be fine; as the mechanism they would strand most users. Also rejected:
typing the NAS URL by hand — more steps and more ways to get it wrong (scheme,
port, trailing slash) than clicking a button on the tab you are already looking at.

---

## 3. CRXJS

**Decision.** `@crxjs/vite-plugin` 2.7.x.

**Why.** The reflex objection — "CRXJS is abandoned / stuck in beta" — was true
and is not any more. Archival was announced in Feb 2025, maintainers took it
over in Mar 2025, 2.0 stable shipped Jun 2025, and releases have been regular
since. It supports Vite 8 and declarative `world: "MAIN"`.

Decisively: our exact setup — no `content_scripts`, `?iife` import from the
service worker, `registerContentScripts` with `world: 'MAIN'` — is an
**official e2e fixture** (`tests/e2e/mv3-dynamic-script-iife`), tested in a real
browser upstream. We are on a supported path, not an ingenious one.

**Rejected.** **WXT** — more active and more popular, but still `0.x`, and it
routes MAIN world through `injectScript()` (two entry points) instead of the
declarative world we need. **`@samrum/vite-plugin-web-extension`** — unmaintained
since 2024, caps Vite at `^5`. **Hand-rolled Vite build** — means reimplementing
web-accessible-resources and asset hashing, and losing HMR.

**What would change our mind.** CRXJS going unmaintained again. WXT reaching
1.0 with declarative MAIN world support.

---

## 4. `photo:changed` comes from the network, not the URL

**Decision.** `core/photoContext.ts` derives `photo:changed` from
`api:response`, matching `SYNO.Foto.Browse.Item` (personal) and
`SYNO.FotoTeam.Browse.Item` (shared). The router is a **secondary** signal.

**Why.** Reading the photo id from the hash is the obvious approach and it does
not hold up:

- `#/…/item/<id>` is confirmed **only for folder views**. See §7.
- Even where the id _is_ in the URL, **`cache_key` is not** — and no thumbnail
  URL can be built without it. The URL is never sufficient on its own.

The API response carries the id, the GPS and the `cache_key` together, and it
arrives exactly when the photo changes. It is simply the better signal.

### The single-item rule

`Browse.Item` serves two purposes that are **indistinguishable by URL**: listing
a grid (many items) and loading the open photo (one item).

Reading `list[0]` unconditionally — the intuitive move, and what the original
userscript did — means a background grid refresh silently redefines "current
photo" as whatever sorts first, usually with no GPS. That is the true cause of
the familiar _"the GPS keeps getting clobbered"_ symptom, normally patched over
downstream with a _"never overwrite a good value with null"_ rule.

We fix the cause: **only a single-item response describes the open photo.**
Listings are ignored, so there is no bad value to guard against later. Tests:
`tests/core/photoContext.test.ts` → _the single-item rule_.

**Both spaces matter.** `SYNO.Foto.*` is the personal library, `SYNO.FotoTeam.*`
the shared one — separate endpoints, identical payloads. Handling one silently
breaks half the app.

---

## 5. Shadow DOM for all extension UI

**Decision.** One shadow host for the whole extension
(`ui/shadowHost.ts`), one container per plugin inside it, styles via
`adoptedStyleSheets`.

**Why.** Synology Photos ships a ~442 KB stylesheet. In the light DOM our CSS
and theirs share one cascade, and it hurts both ways: a DSM update restyles our
buttons, and our rules leak into their app. A shadow root ends that argument
permanently. It is cheap now and a rewrite later.

One host, not one per plugin: one stylesheet parse, one node in the page, and a
single `dispose()` that removes every trace of us.

`mode: 'open'` because `closed` would only inconvenience _us_ while debugging —
the page can already reach anything we render.

---

## 6. Smaller decisions

- **AbortSignal instead of a disposal dialect.** `bus.on(..., { signal })`
  mirrors `addEventListener`. One `AbortController` per plugin retires every
  listener it ever registered, which is why `teardown()` is optional. Standard
  beats clever, and in five years `AbortSignal` will still be standard.
- **A broken plugin breaks only itself.** Every call into plugin code is
  individually contained (`pluginRegistry.ts`), and setups run concurrently so a
  slow plugin cannot hold up the others. We are a guest in an app the user
  actually needs.
- **Mutations are batched per animation frame.** A naive observer on
  `document.body` fires in bursts of hundreds during a scroll; React rebuilds
  Synology's panels constantly. One shared, batched observer, not one per plugin.
- **Never a text selector.** `data-tooltip-content` and friends are **localised** —
  matching `"Delete"` breaks for every non-English user. Class names only.
  (Real prior art matches `"다운로드"`; real prior art also matches `"Delete"`.
  Both are broken for the other's users.)
- **No `any`, anywhere.** Every boundary we do not control (Synology payloads,
  `postMessage`) is `unknown` and narrowed by a guard. Parsers return
  `undefined` on surprises rather than throwing: a plugin losing a feature beats
  an exception in someone's photo library.
- **Zero runtime dependencies.** Not a purity contest — a supply-chain and
  longevity choice for something that runs inside a page holding personal
  photos.
- **`typescript` pinned to `6.0.3` exactly.** TypeScript 7 (the Go port) is
  `latest` but ships no programmatic API until 7.1; `typescript-eslint`
  (peer `<6.1.0`) refuses it, and forced through, ESLint crashes. Upstream issue
  closed as _not planned_. Revisit when typescript-eslint announces TS 7 support.

---

## 7. What we do not know

Honest gaps. **Measure these; do not assume them.** Update this section when you
learn something — that is the whole point of it.

### Captured traffic (DSM 7, 2026-07-17)

The ground truth everything below is measured against. Verbatim, from a live
NAS — mirrored in `tests/fixtures/synology.ts`:

```
POST  webapi/entry.cgi/SYNO.FotoTeam.Browse.Item
POST  webapi/entry.cgi
GET   https://nas:5001/synofoto/api/v2/t/Thumbnail/get
        ?id=120565&cache_key=%22120565_1716818418%22&type=%22unit%22&size=%22xl%22
        &SynoToken=REDACTED
```

> Host and `SynoToken` are redacted. The capture is otherwise untouched — the
> real token was a live session credential, which is exactly the kind of thing
> that should never reach a public repository, verbatim fixtures or not.

Four things worth knowing, none of them guessable:

- **URLs are relative, with no leading slash.** A filter matching `'/webapi/'`
  matches _nothing_. That shipped, and the symptom was an extension that saw
  zero traffic and said nothing about it. The filter matches `webapi/entry.cgi`.
- **The method name is a path segment**, not a query parameter
  (`entry.cgi/SYNO.FotoTeam.Browse.Item`).
- **Some calls carry no method in the URL** (`POST webapi/entry.cgi`) —
  presumably form-encoded in the body. We ignore what we cannot identify.
- **A second API exists**: `/synofoto/api/v2/…`, outside `webapi/`, serving
  image bytes. `cache_key` and `SynoToken` travel in its query string. Not
  captured — cloning thumbnails would be pure waste. Whether it also has JSON
  endpoints worth reading is unexplored.

**The lesson, recorded so it is not repeated:** the fixtures used to be
_invented_ — plausible-looking `?api=…&method=get` URLs. The tests passed
against them while the extension saw nothing, because both the code and its
tests shared one wrong assumption. A fixture that was never captured tests
nothing but your imagination. Capture real traffic first.

1. **Does the timeline lightbox route at all?** `#/…/item/<id>` is proven only
   for _folder_ views. No `#/personal_space/timeline/item/...` URL has been
   observed anywhere, and known prior art opens the timeline lightbox by
   double-click without ever mentioning the URL. **This is why `photo:changed`
   is network-derived (§4).** If it turns out the timeline does route, the
   router becomes a useful cross-check — but not a replacement, because of
   `cache_key`.
2. ~~**Does the Photos React bundle use `fetch`, `XHR`, or both?**~~
   **Answered 2026-07-17: XHR.** Captured on a live DSM 7 NAS — every observed
   call is `XMLHttpRequest`, no `fetch`. The `fetch` hook stays anyway: it costs
   nothing and one DSM update could change this.
3. **Are there other `Browse.Item` response shapes?** Our fixtures come from one
   DSM 7 NAS. Albums, shared links (`/mo/sharing/…`) and person/place views may
   differ.
4. **Is `SYNO.Foto` vs `SYNO.FotoTeam` the whole story?** There may be other
   method families (albums, search) that also identify the open photo.
   `SYNO.Foto.Browse.Item` (personal) is **inferred by symmetry** with the
   captured `SYNO.FotoTeam.Browse.Item` — plausible, but not yet observed. First
   run against a personal library confirms or breaks it.
5. **What is `POST webapi/entry.cgi` without a method?** Observed but
   unidentified — the method is presumably form-encoded in the body. If it turns
   out to carry photo data, the bridge would need to pass the request body
   through, which it currently does not.
6. **Does `/synofoto/api/v2/` serve anything but images?** Only
   `t/Thumbnail/get` has been seen. A JSON endpoint there could be useful, or a
   trap.
7. **Public sharing links.** `/mo/sharing/<id>` pages are unexamined. They may
   not use the same API at all.
8. **DSM version drift.** Everything here reflects DSM 7.x as of mid-2026.
   Synology owes us no stability, and this file is the record of what to re-check
   when something breaks.

---

## Map of the code

| Path       | Responsibility                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries/` | The 4 things Chrome loads. Thin wiring — logic lives below.                                                                                 |
| `core/`    | EventBus, logger, router, observer, settings, plugin lifecycle. Knows nothing about plugins.                                                |
| `bridge/`  | MAIN ↔ ISOLATED plumbing. The trust boundary.                                                                                               |
| `api/`     | **The only Synology-aware layer.** Method names and payload shapes live here and nowhere else — when DSM changes, this is the blast radius. |
| `ui/`      | Shadow-DOM primitives.                                                                                                                      |
| `plugins/` | One folder per feature. Imported only by `entries/content-isolated.ts`.                                                                     |
| `utils/`   | Pure helpers, no imports of ours.                                                                                                           |

**The invariant, restated:** `core/`, `bridge/`, `api/`, `ui/` and `utils/` must
never import `plugins/`. ESLint fails the build if they try
(`no-restricted-imports` in `eslint.config.js`). It is what keeps a plugin
deletable — remove the folder, remove one line — and it is the whole reason this
codebase can absorb a dozen features without becoming a graph.
