# Contributing

Thanks for considering it. This project is small and intends to stay
understandable, so the bar is "would someone grasp this in a year without asking
you".

## Getting set up

**Node 22.12+** (CI uses Node 24 LTS; `.nvmrc` pins it).

```bash
npm install
npm run dev      # Vite + HMR
npm run verify   # what CI runs: format + lint + typecheck + test + build
```

Load `dist/` unpacked at `chrome://extensions` (Developer mode → Load unpacked).

### ⚠️ Do not run `npm install typescript`

`typescript` is pinned to **`6.0.3`, exactly**, with no `^`.

TypeScript 7 (the native Go port) is `latest` on npm but ships **no programmatic
API** until 7.1. `typescript-eslint` declares a `<6.1.0` peer range and refuses
it; forced through, ESLint dies with `Cannot read properties of undefined
(reading 'Cjs')`. The upstream issue is closed as _not planned_ — the fix must
come from TypeScript.

Unpin it when typescript-eslint announces TS 7 support. Not before.

## Writing a plugin

This is the main thing you might want to do, and it is meant to be small.

### 1. Create the folder

`src/plugins/myFeature/index.ts`:

```ts
import { definePlugin } from '@/core/plugin';

export default definePlugin({
  id: 'my-feature',
  name: 'My feature',
  description: 'One line, shown in the popup.',
  enabledByDefault: true,

  setup({ bus, log, ui, signal }) {
    bus.on(
      'photo:changed',
      ({ item, gps }) => {
        if (!gps) return;
        log.debug('photo', item.id, gps);
        // ...render into ui.container
      },
      { signal },
    );
  },
});
```

### 2. Register it

In `src/plugins/index.ts`, import it and add it to the array. **That is the whole
wiring.**

```ts
import myFeature from './myFeature';

export const plugins: readonly Plugin[] = [devProbe, myFeature];
```

### The rules

1. **Never import another plugin.** Use the EventBus. ESLint enforces this. Two
   plugins that need to agree do so through an event, not an import — which is
   what keeps ten plugins from becoming a graph.
2. **Never import a plugin from `core/`, `api/`, `bridge/`, `ui/` or `utils/`.**
   Also ESLint-enforced. The arrow points one way, permanently.
3. **Pass `signal` to everything.** Every listener, timer and `waitForElement`.
   Then teardown is automatic and you need no `teardown()`. Anything you register
   without it, you own forever.
4. **Never `innerHTML`.** Filenames and album titles come from a NAS. Use
   `el()` from `@/utils/dom`, or `textContent`.
5. **Never select by visible text.** Synology localises tooltips and labels;
   matching `"Delete"` breaks for every non-English user. Class names only.
6. **Never `console.*`.** Use `ctx.log` — namespaced, and silenceable by the user.
7. **Keep Synology knowledge in `src/api/`.** Method names and payload shapes go
   there so that when DSM changes, one file is the blast radius.

### Events available

| Event           | When                                                     |
| --------------- | -------------------------------------------------------- |
| `photo:changed` | The open photo changed. Carries `item`, `space`, `gps`.  |
| `route:changed` | Hash route changed (also on `pushState`/`replaceState`). |
| `api:response`  | A raw Synology `/webapi/` response. `body` is `unknown`. |
| `dom:mutation`  | A batch of DOM mutations, coalesced per animation frame. |

Prefer `photo:changed` over `api:response` — the parsing is done and the traps
(§4 of the architecture doc) are already handled.

For DOM work, prefer `waitForElement()` over `dom:mutation` + a guess. And never
`setTimeout(fn, 50)`: it is a race that passes on your machine and fails on a
cold cache.

### Try it

Turn on **Developer probe** in the popup and set log level to `debug`. It logs
every event and is the fastest way to see what your plugin will receive.

## Tests

Vitest + happy-dom. Everything except `entries/` is unit-testable, which is why
`entries/` is kept nearly empty.

```bash
npm test
npm run test:watch
```

What deserves a test:

- Anything parsing a Synology payload — use real captured shapes
  (`tests/fixtures/synology.ts`), not tidied-up ones. A fixture "cleaned up"
  into something convenient stops testing reality.
- Anything that must not break the host page.
- Any bug you fix: a test that fails before your fix.

## Pull requests

- `npm run verify` must pass.
- One logical change per PR. A new plugin is one PR.
- Update `CHANGELOG.md` under `[Unreleased]`.
- If you make an architectural decision, record the _why_ in
  `docs/ARCHITECTURE.md`. Future-you will not remember, and that file is the
  reason this project can survive being put down for six months.
- If you learn something about Synology's behaviour — especially anything in
  **§8 "What we do not know"** — update it. A confirmed unknown is a real
  contribution, even with no code.

## Especially useful contributions

Synology documents none of this API, so **observations from a NAS other than the
author's are genuinely valuable**:

- A different DSM version.
- Locales other than English/French — text-selector bugs hide here.
- Shared albums, public sharing links (`/mo/sharing/…`), person and place views.
- Anything answering an open question in §8 of `docs/ARCHITECTURE.md` — the
  timeline lightbox routing question above all.

## Code style

Prettier and ESLint decide; `npm run verify` is the arbiter. Beyond that:

- Comments explain **why**, not what. If a line needs a comment to say what it
  does, rename something instead.
- JSDoc on anything public — especially the trap you just spent an hour on.
- Small modules, explicit names.

## Reporting bugs

Include: DSM version, browser + version, the NAS URL **shape** (`https://host:5001`
— not your real address), personal or shared space, and the console output with
**Developer probe** on at `debug`.

## License

MIT. By contributing you agree your work ships under it.
