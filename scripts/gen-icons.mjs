#!/usr/bin/env node
/**
 * Generates static/icon-192.png and static/icon-512.png using only Node.js
 * built-ins (no external dependencies).
 *
 * Design: dark (#0f172a) background, amber (#f59e0b) dollar-sign glyph.
 */

import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

// ── colours ──────────────────────────────────────────────────────────────────
const BG = [15, 23, 42];      // #0f172a
const FG = [245, 158, 11];    // #f59e0b

// ── CRC-32 ───────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

// ── PNG encoder (RGB, no alpha) ───────────────────────────────────────────────
function encodePNG(size, pixels /* Buffer, RGB, row-major */) {
  const rowBytes = size * 3;
  // prepend filter-byte 0 (None) to each row
  const scanlines = Buffer.allocUnsafe(size * (rowBytes + 1));
  for (let y = 0; y < size; y++) {
    scanlines[y * (rowBytes + 1)] = 0;
    pixels.copy(scanlines, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── pixel helpers ─────────────────────────────────────────────────────────────
function fillBackground(pixels, size, color) {
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3]     = color[0];
    pixels[i * 3 + 1] = color[1];
    pixels[i * 3 + 2] = color[2];
  }
}

function setPixel(pixels, size, x, y, color) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 3;
  pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2];
}

function fillRect(pixels, size, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      setPixel(pixels, size, x + dx, y + dy, color);
}

function fillCircle(pixels, size, cx, cy, r, color) {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r2)
        setPixel(pixels, size, Math.round(cx + dx), Math.round(cy + dy), color);
}

function fillRoundedRect(pixels, size, x, y, w, h, r, color) {
  fillRect(pixels, size, x + r, y,     w - 2*r, h,     color);
  fillRect(pixels, size, x,     y + r, w,       h-2*r, color);
  fillCircle(pixels, size, x + r,     y + r,     r, color);
  fillCircle(pixels, size, x + w - r, y + r,     r, color);
  fillCircle(pixels, size, x + r,     y + h - r, r, color);
  fillCircle(pixels, size, x + w - r, y + h - r, r, color);
}

// ── Dollar-sign glyph ─────────────────────────────────────────────────────────
// Drawn as a 9-column × 13-row bitmap, scaled and centred.
//  0 = background   1 = foreground
const DOLLAR_ROWS = [
  [0,0,1,1,1,1,1,0,0],  // 0
  [0,1,1,0,0,0,1,1,0],  // 1
  [0,1,1,0,0,0,0,0,0],  // 2
  [0,1,1,0,0,0,0,0,0],  // 3
  [0,0,1,1,1,1,0,0,0],  // 4
  [0,0,0,0,0,1,1,0,0],  // 5
  [0,0,0,0,0,0,1,1,0],  // 6
  [0,0,0,0,0,0,1,1,0],  // 7
  [0,1,1,0,0,0,1,1,0],  // 8
  [0,0,1,1,1,1,1,0,0],  // 9
];
const GLYPH_COLS = DOLLAR_ROWS[0].length;  // 9
const GLYPH_ROWS = DOLLAR_ROWS.length;     // 10

function drawDollarSign(pixels, size, scale, color) {
  const gw = GLYPH_COLS * scale;
  const gh = GLYPH_ROWS * scale;

  // Centre glyph
  const ox = Math.round((size - gw) / 2);
  const oy = Math.round((size - gh) / 2);

  // Vertical bar (runs full height of glyph + one scale above/below)
  const barX = ox + Math.round((GLYPH_COLS / 2) * scale - scale / 2);
  fillRect(pixels, size, barX, oy - scale, scale, gh + 2 * scale, color);

  // Glyph pixels
  for (let r = 0; r < GLYPH_ROWS; r++) {
    for (let c = 0; c < GLYPH_COLS; c++) {
      if (DOLLAR_ROWS[r][c]) {
        fillRect(pixels, size, ox + c * scale, oy + r * scale, scale, scale, color);
      }
    }
  }
}

// ── Icon generator ────────────────────────────────────────────────────────────
function makeIcon(size) {
  const pixels = Buffer.allocUnsafe(size * size * 3);
  fillBackground(pixels, size, BG);

  // Rounded-square "badge" in a slightly lighter surface colour
  const pad  = Math.round(size * 0.08);
  const rr   = Math.round(size * 0.18);
  fillRoundedRect(pixels, size, pad, pad, size - 2*pad, size - 2*pad, rr, [30, 41, 59]); // #1e293b

  // Dollar sign: scale so glyph is ~50% of icon width
  const glyphTargetWidth = Math.round(size * 0.50);
  const scale = Math.max(1, Math.round(glyphTargetWidth / GLYPH_COLS));
  drawDollarSign(pixels, size, scale, FG);

  return encodePNG(size, pixels);
}

// ── Write files ───────────────────────────────────────────────────────────────
writeFileSync(new URL('../static/icon-192.png', import.meta.url), makeIcon(192));
writeFileSync(new URL('../static/icon-512.png', import.meta.url), makeIcon(512));
console.log('✓ static/icon-192.png');
console.log('✓ static/icon-512.png');
