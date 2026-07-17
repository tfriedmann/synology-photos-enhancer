import { el } from '@/utils/dom';

/**
 * The extension's single root in the page, isolated behind a shadow boundary.
 *
 * ## Why a shadow root is not optional
 *
 * Synology Photos ships a ~442 KB stylesheet. Rendering into the light DOM
 * means our CSS and theirs are in one cascade, and both directions hurt: their
 * rules restyle our buttons on a DSM update we did not ask for, and our rules
 * leak onto their app. A shadow root ends that argument permanently — which is
 * exactly the kind of decision that is cheap now and a rewrite later.
 *
 * One host for the whole extension, with a container per plugin inside it: one
 * stylesheet parse, one node in the page, and a single `dispose()` that removes
 * every trace of us.
 *
 * `mode: 'open'` is deliberate. `closed` would only inconvenience *us* during
 * debugging: the page can already reach anything we render, and pretending
 * otherwise buys no security.
 */

export const HOST_ELEMENT_ID = 'synology-photos-enhancer-root';

export interface ShadowHost {
  readonly root: ShadowRoot;
  /** A private container for one plugin. Repeat calls with the same id return the same node. */
  container(id: string): HTMLElement;
  /** Appends a stylesheet to the shadow root. */
  addStyles(css: string): void;
  /** Removes the host and everything in it. Idempotent. */
  dispose(): void;
}

export interface ShadowHostOptions {
  /** Base CSS, adopted before any plugin styles. */
  readonly css: string;
  /** Defaults to `document.documentElement` — `body` may not exist at `document_start`. */
  readonly mount?: Element | undefined;
}

function adopt(root: ShadowRoot, css: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
}

export function createShadowHost(options: ShadowHostOptions): ShadowHost {
  /* documentElement, not body: content scripts run at document_start, when
   * <body> does not exist yet. */
  const mount = options.mount ?? document.documentElement;

  /* A stale host can survive an extension reload during development. */
  document.getElementById(HOST_ELEMENT_ID)?.remove();

  const host = el('div', { attrs: { id: HOST_ELEMENT_ID } });
  const root = host.attachShadow({ mode: 'open' });
  adopt(root, options.css);
  mount.append(host);

  const containers = new Map<string, HTMLElement>();
  let disposed = false;

  return {
    root,

    container(id) {
      const existing = containers.get(id);
      if (existing) return existing;

      const node = el('div', {
        className: 'spe-plugin-container',
        attrs: { 'data-spe-plugin': id },
      });
      containers.set(id, node);
      root.append(node);
      return node;
    },

    addStyles(css) {
      adopt(root, css);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      containers.clear();
      host.remove();
    },
  };
}
