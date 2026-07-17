import { el } from '@/utils/dom';

/**
 * Injects a stylesheet into the **page's** DOM, not our shadow root.
 *
 * ## Why this exists at all
 *
 * `shadowHost.ts` explains at length why extension UI lives behind a shadow
 * boundary. This is the one case that argument does not cover: a plugin that
 * *augments Synology's own UI in place* — making their address line clickable,
 * say — styles a node inside their tree. A shadow root cannot reach it.
 *
 * So this is a deliberate, narrow exception, and it comes with conditions:
 *
 * - **Every selector must be `spe-`-namespaced**, and must only ever match
 *   elements or classes we added ourselves. Never style a `.synofoto-*`
 *   selector — that is the leakage the shadow root exists to prevent, and a DSM
 *   update would silently restyle the app.
 * - **Keep it to a few rules.** A plugin needing real UI should render into
 *   `ctx.ui.container` (shadow root) instead. This is for a link's colour, not
 *   for a layout.
 * - **Always pass `signal`.** The stylesheet is removed on teardown, so
 *   disabling a plugin leaves nothing behind.
 *
 * Deduplicated by `id`: repeated calls with the same id replace nothing and add
 * nothing, so a plugin can call it defensively on every render.
 *
 * @param id Stable, unique per plugin, e.g. `'google-maps'`.
 * @param css The stylesheet.
 * @param signal Removes the styles when aborted.
 */
export function injectPageStyles(id: string, css: string, signal?: AbortSignal): void {
  const elementId = `spe-styles-${id}`;

  if (document.getElementById(elementId)) return;

  const style = el('style', { text: css, attrs: { id: elementId } });

  /* <head> exists by the time a plugin runs (the core bootstraps after
   * document_start), but falling back to documentElement costs one `??` and
   * removes a whole class of "worked on my machine" failure. */
  ((document.head as HTMLElement | null) ?? document.documentElement).append(style);

  signal?.addEventListener(
    'abort',
    () => {
      style.remove();
    },
    { once: true },
  );
}
