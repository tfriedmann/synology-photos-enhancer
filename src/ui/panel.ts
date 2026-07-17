import { el } from '@/utils/dom';

/**
 * A titled container for plugin content — the shell a mini-map or an EXIF table
 * gets dropped into.
 *
 * `body` is handed back rather than kept private: a panel that tried to own its
 * children would need an API for every kind of content a future plugin might
 * hold. Owning the chrome and lending out the box is the smaller contract.
 */

export interface PanelOptions {
  readonly title: string;
  readonly children?: readonly Node[] | undefined;
  /** Adds a close button and calls this when it is pressed. */
  readonly onClose?: (() => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface Panel {
  readonly element: HTMLElement;
  /** Append your content here. */
  readonly body: HTMLElement;
  setTitle(title: string): void;
  remove(): void;
}

export function createPanel(options: PanelOptions): Panel {
  const title = el('h2', { className: 'spe-panel__title', text: options.title });

  const header = el('div', { className: 'spe-panel__header', children: [title] });

  if (options.onClose) {
    const close = el('button', {
      className: 'spe-button spe-button--ghost',
      text: '✕',
      attrs: { type: 'button', 'aria-label': 'Close' },
    });
    close.addEventListener(
      'click',
      options.onClose,
      options.signal ? { signal: options.signal } : undefined,
    );
    header.append(close);
  }

  const body = el('div', {
    className: 'spe-panel__body',
    ...(options.children ? { children: options.children } : {}),
  });

  const element = el('section', {
    className: 'spe-panel',
    children: [header, body],
  });

  return {
    element,
    body,
    setTitle(next) {
      title.textContent = next;
    },
    remove() {
      element.remove();
    },
  };
}
