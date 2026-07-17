import { el } from '@/utils/dom';

/**
 * A small floating overlay anchored to an element in the page — the shell for
 * things like a map preview on hover.
 *
 * Not to be confused with the *extension* popup (the toolbar one), which lives
 * in `src/entries/popup/`. This one renders inside the page.
 *
 * The anchor lives in Synology's light DOM while the popup lives in our shadow
 * root, so positioning goes through viewport coordinates: `getBoundingClientRect`
 * plus `position: fixed` on the host. That sidesteps every `overflow: hidden`
 * and stacking context in the app's tree — which a `position: absolute` popup
 * parked next to its anchor would keep losing fights with.
 */

export interface PopupOptions {
  readonly children?: readonly Node[] | undefined;
  /** Distance from the anchor, in px. */
  readonly offset?: number | undefined;
  /** Closes on Escape and on a click outside. Defaults to `true`. */
  readonly dismissible?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface Popup {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  /** Shows the popup positioned under `anchor`. */
  showAt(anchor: Element): void;
  hide(): void;
  readonly visible: boolean;
  remove(): void;
}

export function createPopup(options: PopupOptions = {}): Popup {
  const offset = options.offset ?? 8;
  const dismissible = options.dismissible ?? true;

  const body = el('div', options.children ? { children: options.children } : {});

  const element = el('div', {
    className: 'spe-popup',
    attrs: { role: 'dialog', hidden: true },
    children: [body],
  });

  let visible = false;

  const hide = (): void => {
    if (!visible) return;
    visible = false;
    element.hidden = true;
    options.onClose?.();
  };

  const position = (anchor: Element): void => {
    const rect = anchor.getBoundingClientRect();

    /* Measure before deciding: the popup must be laid out to know its size. */
    element.hidden = false;
    const own = element.getBoundingClientRect();

    /* Flip above the anchor when there is no room below, and clamp to the
     * viewport so the popup is never half off-screen. */
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < own.height + offset && rect.top > own.height + offset
        ? rect.top - own.height - offset
        : rect.bottom + offset;

    const maxLeft = Math.max(0, window.innerWidth - own.width - offset);
    const left = Math.min(Math.max(offset, rect.left), maxLeft);

    element.style.top = `${String(Math.round(top))}px`;
    element.style.left = `${String(Math.round(left))}px`;
  };

  if (dismissible) {
    const listenerOptions = options.signal ? { signal: options.signal } : undefined;

    document.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key === 'Escape') hide();
      },
      listenerOptions,
    );

    /* Capture phase: Synology's own handlers routinely stop propagation, so a
     * bubbling listener would never hear the click that should dismiss us. */
    document.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        if (!visible) return;
        /* composedPath crosses the shadow boundary; `contains` would not see
         * that the click landed on our own content. */
        if (event.composedPath().includes(element)) return;
        hide();
      },
      { capture: true, ...(options.signal ? { signal: options.signal } : {}) },
    );
  }

  return {
    element,
    body,

    showAt(anchor) {
      visible = true;
      position(anchor);
    },

    hide,

    get visible() {
      return visible;
    },

    remove() {
      element.remove();
    },
  };
}
