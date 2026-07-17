/**
 * Generates the placeholder PNG icons.
 *
 * Hand-rolled PNG encoding rather than a dependency: these are flat-coloured
 * placeholders that will be replaced by a real design, and adding `sharp` (a
 * native binary) or `canvas` to `devDependencies` to draw a rounded square
 * would fail the project's own dependency test.
 *
 * Run with `node scripts/generate-icons.mjs`. Not part of the build — the icons
 * are committed, and regenerating them on every install would be churn.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* Deliberately NOT under `public/`: Vite copies that directory to the dist root
 * wholesale, while CRXJS separately resolves the manifest's icon paths as build
 * assets — so icons living there get emitted twice, under two different paths. */
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'icons');
const SIZES = [16, 32, 48, 128];

/** Extension accent, matching `--spe-color-accent`. */
const ACCENT = [0x2b, 0x7c, 0xff];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Draws the placeholder: an accent rounded square with a white aperture ring,
 * legible down to 16px.
 */
function pixels(size) {
  const rows = [];
  const centre = (size - 1) / 2;
  const radius = size * 0.18;
  const ringOuter = size * 0.3;
  const ringInner = size * 0.16;

  for (let y = 0; y < size; y += 1) {
    /* Each scanline is prefixed with its PNG filter type (0 = none). */
    const row = [0];

    for (let x = 0; x < size; x += 1) {
      const dx = Math.abs(x - centre);
      const dy = Math.abs(y - centre);
      const half = size / 2 - 0.5;

      /* Rounded-square mask: inside the straight edges, or within `radius` of
       * the corner arc centre. */
      const cx = Math.max(dx - (half - radius), 0);
      const cy = Math.max(dy - (half - radius), 0);
      const inSquare = Math.hypot(cx, cy) <= radius + 0.5;

      if (!inSquare) {
        row.push(0, 0, 0, 0);
        continue;
      }

      const distance = Math.hypot(x - centre, y - centre);
      const inRing = distance <= ringOuter && distance >= ringInner;
      const [r, g, b] = inRing ? WHITE : ACCENT;
      row.push(r, g, b, 255);
    }

    rows.push(Buffer.from(row));
  }

  return Buffer.concat(rows);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10–12: compression, filter, interlace — all zero.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png(size));
  process.stdout.write(`wrote ${file}\n`);
}
