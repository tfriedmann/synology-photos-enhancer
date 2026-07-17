import { describe, expect, it } from 'vitest';

import { exifRows } from '@/plugins/exif/rows';

import { REAL_EXIF } from '../fixtures/synology';

describe('exifRows', () => {
  it('labels the real values in reading order, verbatim', () => {
    /* Camera and lens first, then the four exposure settings a photographer
     * reads together. Values pass through untouched — Synology pre-formats. */
    expect(exifRows(REAL_EXIF)).toEqual([
      { label: 'Camera', value: 'iPhone 14 Pro Max' },
      { label: 'Lens', value: 'iPhone 14 Pro Max back triple camera 6.86mm f/1.78' },
      { label: 'Focal length', value: '6.9 mm' },
      { label: 'Aperture', value: 'F1.8' },
      { label: 'Shutter', value: '1/60 s' },
      { label: 'ISO', value: '160' },
    ]);
  });

  it('omits absent fields, keeping the rest in order', () => {
    expect(exifRows({ camera: 'Leica M6', iso: '400' })).toEqual([
      { label: 'Camera', value: 'Leica M6' },
      { label: 'ISO', value: '400' },
    ]);
  });

  it('stringifies a numeric value', () => {
    expect(exifRows({ iso: 160 })).toEqual([{ label: 'ISO', value: '160' }]);
  });

  it('drops blank values', () => {
    expect(exifRows({ camera: '   ', lens: 'Nokton' })).toEqual([
      { label: 'Lens', value: 'Nokton' },
    ]);
  });

  it('returns nothing for empty EXIF', () => {
    expect(exifRows({})).toEqual([]);
  });
});
