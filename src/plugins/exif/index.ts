import { SELECTORS } from '@/api/selectors';
import { definePlugin } from '@/core/plugin';
import type { SynoExif } from '@/types/synology';
import { injectPageStyles } from '@/ui/pageStyles';
import { el } from '@/utils/dom';

import { exifRows } from './rows';

/**
 * Shows the camera settings — the EXIF that Synology reads but does not display.
 *
 * The payload already carries `additional.exif` (camera, lens, focal length,
 * aperture, shutter, ISO); Synology's own info panel just never shows it. This
 * plugin adds a section to that panel with the values.
 *
 * ## Why a separate plugin (and not part of `location`)
 *
 * It fails both merge tests from `docs/ARCHITECTURE.md` §6: it owns a *different*
 * node (its own section in the info panel, not the address line), and it shares
 * *no setting* with `location`. It is genuinely a separate feature. Its only
 * common ground with `location` — needing to read Synology's DOM — goes through
 * `api/selectors.ts`, not a cross-plugin import.
 *
 * ## Why no privacy caveat, unlike the map preview
 *
 * The EXIF is already in the payload the page fetched; showing it sends nothing
 * anywhere. So it renders inline and is on by default — the opposite of the map
 * preview, which reaches out to a third party for tiles.
 *
 * ## Staleness
 *
 * The section is keyed to the current photo's id via a data attribute. When the
 * user moves to another photo the old section is replaced, so the panel never
 * shows one photo's camera under another's — the same failure the address line
 * guards against by reading state at click time.
 */

const PLUGIN_ID = 'exif';
const SECTION_CLASS = 'spe-exif-section';
const PHOTO_ATTR = 'data-spe-exif-photo';

/* The section lives in Synology's panel (light DOM), so it is styled via
 * `injectPageStyles` with `spe-`-namespaced selectors, per `pageStyles.ts`. It
 * borrows the panel's own spacing rather than Synology's classes, so a DSM
 * restyle cannot reach in. */
const STYLES = `
.${SECTION_CLASS} {
  padding: 8px 0;
}
.spe-exif-title {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}
.spe-exif-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 1px 0;
  font-size: 13px;
}
.spe-exif-row-label {
  opacity: 0.6;
  white-space: nowrap;
}
.spe-exif-row-value {
  text-align: right;
  overflow-wrap: anywhere;
}
`;

function buildSection(exif: SynoExif, photoId: number): HTMLElement | undefined {
  const rows = exifRows(exif);
  if (rows.length === 0) return undefined;

  const section = el('section', { className: SECTION_CLASS });
  section.setAttribute(PHOTO_ATTR, String(photoId));
  section.append(el('h3', { className: 'spe-exif-title', text: 'Camera' }));

  for (const row of rows) {
    section.append(
      el('div', {
        className: 'spe-exif-row',
        children: [
          el('span', { className: 'spe-exif-row-label', text: row.label }),
          el('span', { className: 'spe-exif-row-value', text: row.value }),
        ],
      }),
    );
  }
  return section;
}

export default definePlugin({
  id: PLUGIN_ID,
  name: 'Camera details',
  description: 'Shows the full EXIF (camera, lens, aperture, shutter, ISO) in the info panel.',
  enabledByDefault: true,

  setup({ bus, log, signal }) {
    let exif: SynoExif | undefined;
    let photoId: number | undefined;

    injectPageStyles(PLUGIN_ID, STYLES, signal);

    const removeSection = (): void => {
      for (const node of document.querySelectorAll(`.${SECTION_CLASS}`)) node.remove();
    };

    /**
     * Ensures the panel shows the current photo's EXIF. Idempotent, and cheap on
     * repeat: if the section already there is for this photo, it does nothing.
     */
    const render = (): void => {
      const panel = document.querySelector(SELECTORS.infoTabPanel);
      if (!panel) return;

      if (!exif || photoId === undefined) {
        removeSection();
        return;
      }

      const existing = panel.querySelector(`.${SECTION_CLASS}`);
      if (existing?.getAttribute(PHOTO_ATTR) === String(photoId)) return; // already current

      /* Stale (wrong photo) or missing after a React rebuild: replace it. */
      removeSection();
      const section = buildSection(exif, photoId);
      if (!section) return;

      /* After the last general section (date, size, location), before tags and
       * title — grouped with the other technical facts. */
      const sections = panel.querySelectorAll(SELECTORS.infoGeneralSection);
      const last = sections[sections.length - 1];
      if (last) last.after(section);
      else panel.append(section);

      log.debug('EXIF section added for photo', photoId);
    };

    bus.on(
      'photo:changed',
      (payload) => {
        exif = payload.item.additional?.exif;
        photoId = payload.item.id;
        render();
      },
      { signal },
    );

    /* The panel is React-rebuilt and often arrives after `photo:changed`. */
    bus.on('dom:mutation', render, { signal });
  },

  /* `signal` retires the subscriptions and the stylesheet; the section lives in
   * Synology's DOM, so it is removed by hand. */
  teardown() {
    for (const node of document.querySelectorAll(`.${SECTION_CLASS}`)) node.remove();
  },
});
