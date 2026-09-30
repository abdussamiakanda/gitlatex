/**
 * Local machine storage: download files / whole projects as .zip, and import
 * files, folders or .zip archives via the HTML5 File API.
 */
import { unzipSync, zipSync, strToU8 } from 'fflate';
import type { Workspace } from '../state/workspace';
import { downloadBlob } from '../utils/misc';
import { basename, normalisePath, isTextPath } from '../utils/paths';
import { looksBinary } from '../state/workspace';

export interface ImportedFile {
  path: string;
  text?: string;
  data?: Uint8Array;
}

export function downloadText(path: string, text: string) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), basename(path));
}

export function downloadBytes(filename: string, data: Uint8Array, type = 'application/octet-stream') {
  downloadBlob(new Blob([data as BlobPart], { type }), filename);
}

export function projectZip(ws: Workspace, pdf?: Uint8Array | null): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const p of ws.paths()) {
    const f = ws.get(p)!;
    entries[p] = f.kind === 'text' ? strToU8(f.text ?? '') : (f.data ?? new Uint8Array());
  }
  if (pdf) entries[`${ws.project.mainFile.replace(/\.tex$/, '')}.pdf`] = pdf;
  return zipSync(entries, { level: 6 });
}

export function downloadProjectZip(ws: Workspace, pdf?: Uint8Array | null) {
  const safe = ws.project.name.replace(/[^\w.-]+/g, '_') || 'project';
  downloadBytes(`${safe}.zip`, projectZip(ws, pdf), 'application/zip');
}

function decode(path: string, data: Uint8Array): ImportedFile {
  if (isTextPath(path) && !looksBinary(data)) return { path, text: new TextDecoder().decode(data) };
  return { path, data };
}

/** Unpack a .zip archive, dropping OS junk and a common top-level folder. */
export function unzipProject(data: Uint8Array): ImportedFile[] {
  const raw = unzipSync(data);
  let entries = Object.entries(raw).filter(([p, d]) => !p.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(p) && d);
  // Strip a single wrapping directory (common for GitHub/Overleaf exports).
  const tops = new Set(entries.map(([p]) => p.split('/')[0]));
  if (tops.size === 1 && entries.every(([p]) => p.includes('/'))) {
    const top = [...tops][0] + '/';
    entries = entries.map(([p, d]) => [p.slice(top.length), d]);
  }
  const out: ImportedFile[] = [];
  for (const [p, d] of entries) {
    const path = normalisePath(p);
    if (path) out.push(decode(path, d));
  }
  return out;
}

/** Read files chosen via <input type=file> or dropped on the page. */
export async function readFileList(list: FileList | File[], targetDir = ''): Promise<ImportedFile[]> {
  const out: ImportedFile[] = [];
  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name) && list.length === 1) return unzipProject(bytes);
    const path = normalisePath(targetDir ? `${targetDir}/${rel}` : rel);
    if (path) out.push(decode(path, bytes));
  }
  return out;
}

/** Recursively read a dropped directory (DataTransferItem.webkitGetAsEntry). */
export async function readDataTransfer(dt: DataTransfer, targetDir = ''): Promise<ImportedFile[]> {
  const items = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!items.length) return readFileList(dt.files, targetDir);
  const files: File[] = [];
  const paths: string[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      files.push(f);
      paths.push(prefix + f.name);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of items) await walk(e, '');
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) return unzipProject(new Uint8Array(await files[0].arrayBuffer()));
  const out: ImportedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const path = normalisePath(targetDir ? `${targetDir}/${paths[i]}` : paths[i]);
    if (path) out.push(decode(path, new Uint8Array(await files[i].arrayBuffer())));
  }
  return out;
}

export function pickFiles(opts: { accept?: string; multiple?: boolean; directory?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (opts.accept) input.accept = opts.accept;
    input.multiple = opts.multiple ?? true;
    if (opts.directory) input.setAttribute('webkitdirectory', '');
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
