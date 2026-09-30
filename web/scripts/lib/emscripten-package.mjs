// SPDX-License-Identifier: MIT
/**
 * Utilities for reading Emscripten `file_packager` data packages at build time.
 *
 * BusyTeX ships its TeX Live tree as Emscripten data packages: a `<name>.js`
 * loader (which embeds the file list as JSON) plus a `<name>.data` blob that is
 * LZ4-compressed in fixed-size chunks (Emscripten's MiniLZ4 codec).
 *
 * The browser never needs this module — Emscripten decompresses lazily at
 * runtime. We use it in Node to:
 *   - list every file the engine already ships (so the package shelf never
 *     shadows a base file with a different version),
 *   - compute which LaTeX packages each data package provides,
 *   - extract individual files (e.g. the base `pdftex.map`) for merging.
 */
import fs from 'node:fs';

/**
 * Parse the metadata embedded in a data package loader script.
 * @param {string} js contents of `<name>.js`
 * @returns {{ files: {filename: string, start: number, end: number}[], remotePackageSize: number,
 *             packageUuid: string, compressed: any | null, remotePackageBase: string | null }}
 */
export function parseDataPackageLoader(js) {
  const marker = 'loadPackage({"files":';
  const at = js.lastIndexOf(marker);
  if (at < 0) throw new Error('Not an Emscripten data package loader (no loadPackage({"files": ...}) call)');
  // The argument is a JSON object literal terminated by `});`
  const start = at + 'loadPackage('.length;
  const end = js.indexOf('});', start);
  const metadata = JSON.parse(js.slice(start, end + 1));

  // LZ4 packages embed `var compressedData = {...};`
  let compressed = null;
  const cd = js.indexOf('var compressedData = ');
  if (cd >= 0) {
    const s = cd + 'var compressedData = '.length;
    const e = js.indexOf('\n', s);
    const literal = js.slice(s, e).trim().replace(/;$/, '');
    compressed = JSON.parse(literal);
  }
  const base = /var REMOTE_PACKAGE_BASE = '([^']+)'/.exec(js);
  return {
    files: metadata.files,
    remotePackageSize: metadata.remote_package_size,
    packageUuid: metadata.package_uuid,
    compressed,
    remotePackageBase: base ? base[1] : null,
  };
}

/**
 * MiniLZ4 block decompression, as used by Emscripten's LZ4 filesystem.
 * Port of third_party/mini-lz4.js (BSD-2-Clause, Pierre Curto / Emscripten).
 * @param {Uint8Array} source compressed block
 * @param {Uint8Array} dest output buffer (at least CHUNK_SIZE bytes)
 * @returns {number} number of bytes written
 */
export function lz4UncompressBlock(source, dest) {
  const n = source.length;
  let i = 0;
  let j = 0;
  while (i < n) {
    const token = source[i++];
    let literals = token >> 4;
    if (literals > 0) {
      let l = literals + 240;
      while (l === 255) {
        l = source[i++];
        literals += l;
      }
      const end = i + literals;
      while (i < end) dest[j++] = source[i++];
      if (i === n) return j;
    }
    const offset = source[i++] | (source[i++] << 8);
    if (offset === 0 || offset > j) return j;
    let matchLength = token & 0xf;
    let l = matchLength + 240;
    while (l === 255) {
      l = source[i++];
      matchLength += l;
    }
    let pos = j - offset;
    const end = j + matchLength + 4;
    while (j < end) dest[j++] = dest[pos++];
  }
  return j;
}

/**
 * Random-access reader over a (possibly LZ4-compressed) data package.
 */
export class DataPackageReader {
  /**
   * @param {string} jsPath path to `<name>.js`
   * @param {string} dataPath path to `<name>.data`
   */
  constructor(jsPath, dataPath) {
    this.meta = parseDataPackageLoader(fs.readFileSync(jsPath, 'utf8'));
    this.data = new Uint8Array(fs.readFileSync(dataPath));
    this.byName = new Map(this.meta.files.map((f) => [f.filename, f]));
    const c = this.meta.compressed;
    if (c) {
      const cachedCount = c.cachedIndexes.length;
      this.chunkSize = cachedCount > 0 ? (this.data.length - c.cachedOffset) / cachedCount : 2048;
      this.chunkCache = new Map();
    }
  }

  /** @param {number} index */
  chunk(index) {
    const c = this.meta.compressed;
    let out = this.chunkCache.get(index);
    if (out) return out;
    const off = c.offsets[index];
    const size = c.sizes[index];
    if (c.successes[index]) {
      out = new Uint8Array(this.chunkSize);
      lz4UncompressBlock(this.data.subarray(off, off + size), out);
    } else {
      out = this.data.subarray(off, off + this.chunkSize);
    }
    if (this.chunkCache.size > 256) this.chunkCache.clear();
    this.chunkCache.set(index, out);
    return out;
  }

  /**
   * Read a file's bytes from the package.
   * @param {string} filename absolute path inside the virtual FS, e.g. /texlive/texmf-dist/web2c/texmf.cnf
   * @returns {Uint8Array}
   */
  read(filename) {
    const f = this.byName.get(filename);
    if (!f) throw new Error(`${filename} not in package`);
    if (!this.meta.compressed) return this.data.subarray(f.start, f.end);
    const out = new Uint8Array(f.end - f.start);
    let written = 0;
    for (let pos = f.start; pos < f.end; ) {
      const ci = Math.floor(pos / this.chunkSize);
      const chunk = this.chunk(ci);
      const inChunk = pos - ci * this.chunkSize;
      const take = Math.min(this.chunkSize - inChunk, f.end - pos);
      out.set(chunk.subarray(inChunk, inChunk + take), written);
      written += take;
      pos += take;
    }
    return out;
  }
}
