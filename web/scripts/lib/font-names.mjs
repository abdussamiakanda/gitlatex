// SPDX-License-Identifier: MIT
/**
 * Read family / full / PostScript names from OpenType & TrueType fonts
 * (including .ttc collections) by parsing the `name` table directly.
 * Used by build-shelf to let the compile worker map a XeLaTeX/fontspec error
 * such as `The font "TeX Gyre Pagella" cannot be found` to the shelf bundle
 * that contains the font file.
 */

const WANTED = new Set([1, 4, 6, 16]); // family, full name, PostScript name, typographic family

function u16(b, o) {
  return (b[o] << 8) | b[o + 1];
}
function u32(b, o) {
  return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}

function decodeUtf16BE(b, o, len) {
  let s = '';
  for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(u16(b, o + i));
  return s;
}

function namesFromSfnt(b, base, out) {
  const numTables = u16(b, base + 4);
  for (let t = 0; t < numTables; t++) {
    const rec = base + 12 + t * 16;
    const tag = String.fromCharCode(b[rec], b[rec + 1], b[rec + 2], b[rec + 3]);
    if (tag !== 'name') continue;
    const off = u32(b, rec + 8);
    const count = u16(b, off + 2);
    const strings = off + u16(b, off + 4);
    for (let i = 0; i < count; i++) {
      const r = off + 6 + i * 12;
      const platform = u16(b, r);
      const encoding = u16(b, r + 2);
      const nameId = u16(b, r + 6);
      const len = u16(b, r + 8);
      const so = strings + u16(b, r + 10);
      if (!WANTED.has(nameId) || so + len > b.length) continue;
      let s = null;
      if (platform === 3 && (encoding === 1 || encoding === 10 || encoding === 0)) s = decodeUtf16BE(b, so, len);
      else if (platform === 0) s = decodeUtf16BE(b, so, len);
      else if (platform === 1 && encoding === 0) s = String.fromCharCode(...b.subarray(so, so + len));
      if (s && s.trim()) out.add(s.trim());
    }
  }
}

/**
 * @param {Uint8Array} bytes font file contents
 * @returns {string[]} distinct names (may be empty for non-SFNT files)
 */
export function readFontNames(bytes) {
  const out = new Set();
  try {
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (tag === 'ttcf') {
      const n = u32(bytes, 8);
      for (let i = 0; i < n && i < 64; i++) namesFromSfnt(bytes, u32(bytes, 12 + i * 4), out);
    } else if (tag === 'OTTO' || tag === 'true' || u32(bytes, 0) === 0x00010000) {
      namesFromSfnt(bytes, 0, out);
    }
  } catch {
    // Malformed fonts are simply not indexed by name.
  }
  return [...out];
}

/** Normalise a font name the way fontspec lookups are compared: case/space-insensitive. */
export const normaliseFontName = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
