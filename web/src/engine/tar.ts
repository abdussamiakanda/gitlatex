/**
 * Minimal ustar reader + gzip helpers for shelf bundles.
 * Bundles are produced by scripts/lib/tar.mjs (regular files only).
 */

export interface TarEntry {
  path: string;
  data: Uint8Array;
}

const dec = new TextDecoder();

function readString(buf: Uint8Array, offset: number, len: number): string {
  let end = offset;
  while (end < offset + len && buf[end] !== 0) end++;
  return dec.decode(buf.subarray(offset, end));
}

function readOctal(buf: Uint8Array, offset: number, len: number): number {
  const s = readString(buf, offset, len).trim();
  return s ? parseInt(s, 8) : 0;
}

export function parseTar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const type = header[156];
    const prefix = readString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    off += 512;
    // '0' or NUL → regular file
    if (type === 0x30 || type === 0) out.push({ path, data: buf.slice(off, off + size) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
