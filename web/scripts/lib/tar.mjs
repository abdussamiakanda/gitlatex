// SPDX-License-Identifier: MIT
/**
 * Minimal POSIX ustar writer (build time). The browser-side reader lives in
 * src/engine/tar.ts. We only need regular files, so the format is tiny.
 */

const enc = new TextEncoder();

function writeString(buf, offset, len, str) {
  const bytes = enc.encode(str);
  buf.set(bytes.subarray(0, len), offset);
}

function writeOctal(buf, offset, len, value) {
  const s = value.toString(8).padStart(len - 1, '0') + '\0';
  writeString(buf, offset, len, s);
}

/** Split a path into ustar (prefix, name) respecting the 155/100 byte limits. */
function splitPath(path) {
  if (enc.encode(path).length <= 100) return ['', path];
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== '/') continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (enc.encode(prefix).length <= 155 && enc.encode(name).length <= 100) return [prefix, name];
  }
  throw new Error(`Path too long for ustar: ${path}`);
}

/**
 * @param {{path: string, data: Uint8Array}[]} entries
 * @returns {Uint8Array} tar archive bytes
 */
export function createTar(entries) {
  const chunks = [];
  let total = 0;
  for (const { path, data } of entries) {
    const header = new Uint8Array(512);
    const [prefix, name] = splitPath(path);
    writeString(header, 0, 100, name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, 0); // deterministic mtime
    header.fill(0x20, 148, 156); // checksum placeholder = spaces
    header[156] = 0x30; // '0' regular file
    writeString(header, 257, 6, 'ustar\0');
    writeString(header, 263, 2, '00');
    writeString(header, 345, 155, prefix);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    writeString(header, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    chunks.push(header, data);
    total += 512 + data.length;
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      total += pad;
    }
  }
  chunks.push(new Uint8Array(1024));
  total += 1024;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
