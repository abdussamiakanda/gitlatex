/**
 * SyncTeX parser with forward (source → PDF) and inverse (PDF → source)
 * search. pdfTeX/XeTeX write `<job>.synctex.gz`; coordinates are in scaled
 * points relative to the top-left corner of the page, which we convert to
 * PDF big points (1 bp = 65781.76 sp).
 */
import { toProjectPath } from './log-parser';

export interface SyncBox {
  page: number;
  tag: number;
  line: number;
  /** Left edge, baseline (from top), width, height (above baseline), depth — in PDF points. */
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
  /** True for real boxes (hbox/void box); false for points (glue, kern, math…). */
  box: boolean;
}

export interface SyncRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SP_PER_BP = 65781.76;

export interface SyncTexOptions {
  /** Project path of the main document, e.g. `thesis/main.tex`. */
  mainFile?: string;
  /** Every file in the project: absolute paths are matched against these. */
  files?: Iterable<string>;
}

const ENGINE_ROOT = '/home/web_user/project/';
const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:\//.test(p);

/**
 * Map the input paths of a SyncTeX file to project paths.
 *
 * The in-browser engine writes /home/web_user/project/…; a local TeX writes
 * absolute paths on this machine (C:\…\repos\paper\./main.tex); a Compiler
 * API writes paths in its own temp folder; and the server rewrites the saved
 * file to local absolute paths. The main file's own record tells where the
 * project root is in that layout; inputs under it map by their relative path.
 * Without it, an absolute path maps to the longest project file it ends with.
 */
export function resolveInputs(raw: Map<number, string>, mainDir: string, opts: SyncTexOptions = {}): Map<number, string> {
  const out = new Map<number, string>();
  const files = new Map<string, string>();
  for (const f of opts.files ?? []) files.set(f.toLowerCase(), f);
  const norm = (p: string) => p.trim().replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/\.\//g, '/').replace(/\/{2,}/g, '/');

  // Where the project root is, in the layout this file was written in.
  let root: string | null = null;
  const main = opts.mainFile?.toLowerCase();
  if (main) {
    for (const p of raw.values()) {
      const n = norm(p).toLowerCase();
      if (isAbsolute(n) && !n.startsWith(ENGINE_ROOT) && n.endsWith('/' + main)) {
        root = n.slice(0, n.length - main.length);
        break;
      }
    }
  }

  for (const [tag, p] of raw) {
    const n = norm(p);
    let path: string | undefined;
    if (n.startsWith(ENGINE_ROOT) || !isAbsolute(n)) path = toProjectPath(n, mainDir);
    else {
      const lower = n.toLowerCase();
      if (root && lower.startsWith(root)) path = files.get(lower.slice(root.length)) ?? n.slice(root.length);
      else if (files.size) {
        let best = '';
        for (const [key, f] of files) if ((lower === key || lower.endsWith('/' + key)) && f.length > best.length) best = f;
        path = best || undefined;
      }
    }
    if (path && SOURCE.test(path)) out.set(tag, files.get(path.toLowerCase()) ?? path);
  }
  return out;
}
/** Only sources a user can edit are navigation targets (not .aux/.bbl/.out/.toc…). */
const SOURCE = /\.(tex|sty|cls|ltx|tikz|pgf)$/i;
const RECORD = /^([[(vhxkg$])(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;

export class SyncTex {
  readonly inputs = new Map<number, string>();
  readonly boxes: SyncBox[] = [];
  private byFile = new Map<string, SyncBox[]>();

  static async fromGzip(data: Uint8Array, mainDir = '', opts: SyncTexOptions = {}): Promise<SyncTex> {
    // Accept plain (uncompressed) SyncTeX too, as some Compiler APIs send it.
    if (data[0] !== 0x1f || data[1] !== 0x8b) return SyncTex.parse(new TextDecoder('latin1').decode(data), mainDir, opts);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return SyncTex.parse(await new Response(stream).text(), mainDir, opts);
  }

  static parse(text: string, mainDir = '', opts: SyncTexOptions = {}): SyncTex {
    const s = new SyncTex();
    const raw = new Map<number, string>();
    let unit = 1;
    let mag = 1000;
    let xOff = 0;
    let yOff = 0;
    let page = 0;
    let inContent = false;
    const lines = text.split('\n');
    for (const line of lines) {
      if (!inContent) {
        const input = /^Input:(\d+):(.*)$/.exec(line);
        if (input) {
          raw.set(Number(input[1]), input[2]);
          continue;
        }
        const kv = /^(Unit|Magnification|X Offset|Y Offset):(-?\d+)/.exec(line);
        if (kv) {
          const v = Number(kv[2]);
          if (kv[1] === 'Unit') unit = v;
          else if (kv[1] === 'Magnification') mag = v || 1000;
          else if (kv[1] === 'X Offset') xOff = v;
          else yOff = v;
          continue;
        }
        if (line.startsWith('Content:')) inContent = true;
        continue;
      }
      const c = line[0];
      if (c === '{') {
        page = Number(line.slice(1));
        continue;
      }
      if (c === '}' || c === ']' || c === ')' || c === '!') continue;
      if (line.startsWith('Postamble')) break;
      if (line.startsWith('Input:')) {
        const input = /^Input:(\d+):(.*)$/.exec(line);
        if (input) raw.set(Number(input[1]), input[2]);
        continue;
      }
      const m = RECORD.exec(line);
      if (!m) continue;
      const k = (unit * (mag / 1000)) / SP_PER_BP;
      const isBox = c === '[' || c === '(' || c === 'v' || c === 'h';
      const box: SyncBox = {
        page,
        tag: Number(m[2]),
        line: Number(m[3]),
        x: (Number(m[4]) + xOff) * k,
        y: (Number(m[5]) + yOff) * k,
        w: m[6] ? Number(m[6]) * k : 0,
        h: m[7] ? Number(m[7]) * k : 0,
        d: m[8] ? Number(m[8]) * k : 0,
        box: isBox && c !== '[', // vboxes span whole pages — too coarse for navigation
      };
      if (c === '[') continue;
      s.boxes.push(box);
    }
    for (const [tag, path] of resolveInputs(raw, mainDir, opts)) s.inputs.set(tag, path);
    for (const b of s.boxes) {
      const file = s.inputs.get(b.tag);
      if (!file) continue;
      if (!s.byFile.has(file)) s.byFile.set(file, []);
      s.byFile.get(file)!.push(b);
    }
    return s;
  }

  /** Source → PDF: rectangles to highlight for `file:line`. */
  forward(file: string, line: number): SyncRect[] {
    const recs = this.byFile.get(file);
    if (!recs?.length) return [];
    let best = recs.filter((b) => b.line === line);
    if (!best.length) {
      // Nearest line that produced output (prefer the next one — e.g. a \begin line).
      let bestDist = Infinity;
      for (const b of recs) {
        const dist = b.line >= line ? b.line - line : (line - b.line) * 1.5;
        if (dist < bestDist) bestDist = dist;
      }
      best = recs.filter((b) => (b.line >= line ? b.line - line : (line - b.line) * 1.5) === bestDist);
    }
    const boxes = best.filter((b) => b.box && b.w > 0);
    const use = boxes.length ? boxes : best;
    // Merge into one rectangle per page.
    const byPage = new Map<number, SyncRect>();
    for (const b of use) {
      const top = b.y - (b.box ? b.h : 10);
      const bottom = b.y + (b.box ? b.d : 2);
      const r = byPage.get(b.page);
      const right = b.x + Math.max(b.w, 4);
      if (!r) byPage.set(b.page, { page: b.page, x: b.x, y: top, w: right - b.x, h: bottom - top });
      else {
        const x1 = Math.min(r.x, b.x);
        const y1 = Math.min(r.y, top);
        const x2 = Math.max(r.x + r.w, right);
        const y2 = Math.max(r.y + r.h, bottom);
        Object.assign(r, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      }
    }
    return [...byPage.values()].sort((a, b) => a.page - b.page);
  }

  /** PDF → source: the input line that produced the content at (x, y) on `page` (PDF points from top-left). */
  inverse(page: number, x: number, y: number): { file: string; line: number } | null {
    let best: SyncBox | null = null;
    let bestArea = Infinity;
    for (const b of this.boxes) {
      if (b.page !== page || !b.box) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y - b.h && y <= b.y + b.d) {
        const area = b.w * (b.h + b.d);
        if (area < bestArea && this.inputs.has(b.tag)) {
          best = b;
          bestArea = area;
        }
      }
    }
    if (!best) {
      let bestDist = Infinity;
      for (const b of this.boxes) {
        if (b.page !== page || !this.inputs.has(b.tag)) continue;
        const dx = x < b.x ? b.x - x : x > b.x + b.w ? x - b.x - b.w : 0;
        const dy = y < b.y - b.h ? b.y - b.h - y : y > b.y + b.d ? y - b.y - b.d : 0;
        const dist = dx * dx + dy * dy * 4;
        if (dist < bestDist) {
          bestDist = dist;
          best = b;
        }
      }
    }
    if (!best) return null;
    // A line box carries the tag/line where its *paragraph* ended, which can be
    // far from the clicked text (e.g. after an \input). The glue/kern/glyph
    // records on the same baseline carry the precise origin: use the last one
    // that starts left of the click.
    if (best.box) {
      const box = best;
      let point: SyncBox | null = null;
      for (const b of this.boxes) {
        if (b.page !== page || b.box || Math.abs(b.y - box.y) > 0.5 || !this.inputs.has(b.tag)) continue;
        if (b.x < box.x - 0.5 || b.x > box.x + box.w + 0.5) continue;
        if (b.x <= x + 0.5 && (!point || b.x > point.x)) point = b;
      }
      if (point) best = point;
    }
    const file = this.inputs.get(best.tag);
    return file ? { file, line: best.line } : null;
  }
}
