import { el } from '@/utils/dom';

/**
 * A button. Styled by `.spe-button` in `styles/main.css`.
 *
 * The point of having this at all is that plugins should not each re-derive
 * what a button is — including the accessibility bits that are easy to forget:
 * a real `<button>` (focusable, Enter/Space, announced), an explicit
 * `type="button"` so it never submits a form Synology owns, and a label that is
 * always set as text rather than markup.
 */

export interface ButtonOptions {
  readonly label: string;
  readonly onClick: (event: MouseEvent) => void;
  /** Rendered before the label; use text or an emoji, not markup. */
  readonly icon?: string | undefined;
  readonly variant?: 'primary' | 'ghost' | undefined;
  /** Tooltip and accessible name when the visible label is not enough. */
  readonly title?: string | undefined;
  /** Ties the listener to a plugin's lifetime. */
  readonly signal?: AbortSignal | undefined;
}

export function createButton(options: ButtonOptions): HTMLButtonElement {
  const classes = ['spe-button'];
  if (options.variant === 'ghost') classes.push('spe-button--ghost');

  const button = el('button', {
    className: classes.join(' '),
    /* Without this a button inside a form defaults to type="submit". The page's
     * form is not ours to submit. */
    attrs: { type: 'button', ...(options.title !== undefined ? { title: options.title } : {}) },
  });

  if (options.icon !== undefined) {
    button.append(el('span', { text: options.icon, attrs: { 'aria-hidden': 'true' } }));
  }
  button.append(el('span', { text: options.label }));

  button.addEventListener(
    'click',
    options.onClick,
    options.signal ? { signal: options.signal } : undefined,
  );

  return button;
}
