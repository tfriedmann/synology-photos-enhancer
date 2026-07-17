import type { SynoExif } from '@/types/synology';

/**
 * Turns an EXIF object into labelled display rows.
 *
 * Deliberately not a "formatter": Synology already formats the values
 * (`"F1.8"`, `"1/60 s"`, `"6.9 mm"`), so reformatting them would only risk
 * mangling what is already correct. This just labels the fields it recognises,
 * in a sensible reading order, and drops the ones that are absent.
 *
 * `String()` on every value keeps it correct if some device returns a bare
 * number instead of a pre-formatted string.
 */

export interface ExifRow {
  readonly label: string;
  readonly value: string;
}

/* Order matters: body, then the four exposure settings a photographer reads
 * together. Labels stay in English, like the rest of the extension UI. */
const FIELDS: readonly { readonly key: keyof SynoExif; readonly label: string }[] = [
  { key: 'camera', label: 'Camera' },
  { key: 'lens', label: 'Lens' },
  { key: 'focal_length', label: 'Focal length' },
  { key: 'aperture', label: 'Aperture' },
  { key: 'exposure_time', label: 'Shutter' },
  { key: 'iso', label: 'ISO' },
];

export function exifRows(exif: SynoExif): readonly ExifRow[] {
  const rows: ExifRow[] = [];
  for (const { key, label } of FIELDS) {
    const raw = exif[key];
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (value === '') continue;
    rows.push({ label, value });
  }
  return rows;
}
