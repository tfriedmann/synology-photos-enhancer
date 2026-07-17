/**
 * Minimal DOM construction helpers.
 *
 * Small on purpose: this is not a UI framework, and it must not grow into one.
 * It exists so plugins have an obvious alternative to `innerHTML` — which, on a
 * page whose content comes from a NAS, means every filename and album title
 * would be an injection site. `textContent` and real nodes cannot be tricked.
 */

type Attributes = Readonly<Record<string, string | number | boolean | undefined>>;

export interface ElementOptions {
  readonly className?: string | undefined;
  /** Set via `textContent`, never parsed as HTML. */
  readonly text?: string | undefined;
  readonly attrs?: Attributes | undefined;
  readonly style?: Readonly<Partial<CSSStyleDeclaration>> | undefined;
  readonly children?: readonly Node[] | undefined;
}

/**
 * Creates an element.
 *
 * @example
 * el('a', { className: 'spe-link', text: 'Open in Maps', attrs: { href, target: '_blank' } })
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;

  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value === undefined || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }

  if (options.style) Object.assign(node.style, options.style);
  if (options.children) node.append(...options.children);

  return node;
}

/** Removes a node if it is still attached. Safe to call twice. */
export function remove(node: ChildNode | null | undefined): void {
  node?.remove();
}

/**
 * Marks a node as ours and reports whether it was already marked.
 *
 * React rebuilds Synology's panels constantly, so plugins re-run their
 * injection on every mutation batch. This is the "have I already done this?"
 * check, done with a data attribute rather than a class the app might also use.
 *
 * @returns `true` if this call did the marking, `false` if it was already there.
 */
export function markOnce(node: Element, marker: string): boolean {
  const attribute = `data-spe-${marker}`;
  if (node.hasAttribute(attribute)) return false;
  node.setAttribute(attribute, '');
  return true;
}
