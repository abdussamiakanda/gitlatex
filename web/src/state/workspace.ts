/**
 * Workspace — the in-memory model of the open project.
 *
 * The project is a folder on the gitlatex server's disk. Opening it loads
 * every file into memory; edits are written back in the background (text is
 * debounced, structural changes go out at once), through one serial queue so
 * the disk always sees operations in the order they were made. Git then sees
 * exactly what the editor shows.
 *
 * Empty folders are kept in the model by a hidden `.keep` placeholder that
 * exists only in memory; on disk they are just folders.
 */
import * as server from '../storage/server';
import type { FileKind, ProjectMeta } from '../types';
import type { CompileFile, TexEngine } from '../engine/protocol';
import { basename, dirname, isTextPath, normalisePath, stripExt } from '../utils/paths';
import { base64ToBytes, debounce } from '../utils/misc';
import { templateFiles, TEMPLATES } from '../templates';

export interface MemFile {
  path: string;
  kind: FileKind;
  text?: string;
  data?: Uint8Array;
  /** On disk but too large to load; shown in the tree, never sent to the compiler. */
  omitted?: boolean;
  updatedAt: number;
}

export const KEEP = '.keep';

type ChangeKind = 'tree' | 'content' | 'meta';

/** Per-project editor state that is not part of the project's files. */
interface LocalMeta {
  engine?: TexEngine;
  openTabs?: string[];
  activePath?: string | null;
}

const metaKey = (name: string) => `gitlatex.project.${name}`;
/** Shared with the classic UI (public/js/editor/mainfile.js). */
const mainFileKey = (name: string) => `gitlatex-mainfile:${name}`;

function readLocalMeta(name: string): LocalMeta & { mainFile?: string } {
  try {
    const meta = JSON.parse(localStorage.getItem(metaKey(name)) ?? '{}') as LocalMeta;
    return { ...meta, mainFile: localStorage.getItem(mainFileKey(name)) ?? undefined };
  } catch {
    return {};
  }
}

function writeLocalMeta(p: ProjectMeta) {
  try {
    const meta: LocalMeta = { engine: p.engine, openTabs: p.openTabs, activePath: p.activePath };
    localStorage.setItem(metaKey(p.id), JSON.stringify(meta));
    localStorage.setItem(mainFileKey(p.id), p.mainFile);
  } catch {
    /* storage full / disabled */
  }
}

function forgetLocalMeta(name: string) {
  try {
    localStorage.removeItem(metaKey(name));
    localStorage.removeItem(mainFileKey(name));
  } catch {
    /* ignore */
  }
}

/** Files TeX writes next to the main document; never fed back into a compile. */
const BUILD_OUTPUT = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|bcf|run\.xml|blg|nav|snm|vrb|xdv|synctex\.gz)$/i;

export class Workspace {
  /** Reports background write failures (set by the controller). */
  static onError: (err: unknown) => void = (err) => console.error(err);

  readonly files = new Map<string, MemFile>();
  private dirty = new Set<string>();
  private listeners = new Set<(kind: ChangeKind, path?: string) => void>();
  private queue: Promise<void> = Promise.resolve();
  private pendingOps = 0;

  private constructor(public project: ProjectMeta) {}

  // ---- lifecycle -------------------------------------------------------------

  static async open(name: string): Promise<Workspace> {
    const opened = await server.openProject(name);
    const local = readLocalMeta(opened.name);
    const meta: ProjectMeta = {
      id: opened.name,
      name: opened.name,
      createdAt: 0,
      updatedAt: Date.now(),
      mainFile: local.mainFile ?? 'main.tex',
      engine: local.engine ?? 'pdftex',
      hasGit: opened.hasGit,
      openTabs: local.openTabs,
      activePath: local.activePath,
    };
    const ws = new Workspace(meta);
    const now = Date.now();
    for (const f of opened.files) {
      if (f.omitted) ws.files.set(f.path, { path: f.path, kind: 'binary', omitted: true, updatedAt: now });
      else if (f.text !== undefined) ws.files.set(f.path, { path: f.path, kind: 'text', text: f.text, updatedAt: now });
      else ws.files.set(f.path, { path: f.path, kind: 'binary', data: base64ToBytes(f.base64 ?? ''), updatedAt: now });
    }
    for (const dir of opened.folders) {
      if (![...ws.files.keys()].some((p) => p.startsWith(dir + '/'))) {
        ws.files.set(`${dir}/${KEEP}`, { path: `${dir}/${KEEP}`, kind: 'text', text: '', updatedAt: now });
      }
    }
    if (!ws.files.has(meta.mainFile)) {
      meta.mainFile = guessMainFile(ws.textFiles()) ?? meta.mainFile;
      if (!local.engine) meta.engine = detectEngine(ws.getText(meta.mainFile) ?? '');
    }
    return ws;
  }

  /** Create a project folder from a template (or explicit files). Returns the project's name on disk. */
  static async create(
    name: string,
    templateId: string,
    explicit?: { path: string; text?: string; data?: Uint8Array }[],
    opts: { mainFile?: string; engine?: TexEngine; git?: boolean } = {},
  ): Promise<string> {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    const files = explicit ?? (await templateFiles(templateId));
    const mainFile =
      opts.mainFile ??
      (files.some((f) => f.path === (tpl?.mainFile ?? 'main.tex'))
        ? (tpl?.mainFile ?? 'main.tex')
        : (guessMainFile(files) ?? 'main.tex'));
    const created = await server.createProject(name, files, opts.git ?? true);
    const meta: ProjectMeta = {
      id: created.name,
      name: created.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mainFile,
      engine: opts.engine ?? tpl?.engine ?? 'pdftex',
      openTabs: [mainFile],
      activePath: mainFile,
    };
    writeLocalMeta(meta);
    return created.name;
  }

  static forget(name: string) {
    forgetLocalMeta(name);
  }

  /** Carry editor state over when the project folder is renamed. */
  static renamed(from: string, to: string) {
    const meta = readLocalMeta(from);
    forgetLocalMeta(from);
    try {
      localStorage.setItem(metaKey(to), JSON.stringify({ engine: meta.engine, openTabs: meta.openTabs, activePath: meta.activePath }));
      if (meta.mainFile) localStorage.setItem(mainFileKey(to), meta.mainFile);
    } catch {
      /* ignore */
    }
  }

  // ---- change notification -------------------------------------------------

  subscribe(fn: (kind: ChangeKind, path?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind, path?: string) {
    for (const l of this.listeners) l(kind, path);
  }

  // ---- persistence -----------------------------------------------------------

  /** Run a disk operation after every operation queued before it. */
  private enqueue(op: () => Promise<unknown>) {
    this.pendingOps++;
    this.queue = this.queue
      .then(op)
      .then(
        () => undefined,
        (err: unknown) => Workspace.onError(err),
      )
      .finally(() => {
        this.pendingOps--;
      });
  }

  private touch(path: string) {
    this.dirty.add(path);
    this.project.updatedAt = Date.now();
    this.scheduleSave();
  }

  private scheduleSave = debounce(() => void this.flush(), 700);

  /** Write pending edits now; resolves once the disk has everything. */
  async flush(): Promise<void> {
    this.scheduleSave.cancel();
    this.queueWrites(() => true);
    await this.queue;
  }

  /** Queue the pending writes of the dirty paths that match. */
  private queueWrites(match: (path: string) => boolean) {
    for (const p of [...this.dirty]) {
      if (!match(p)) continue;
      this.dirty.delete(p);
      const f = this.files.get(p);
      if (!f || basename(p) === KEEP) continue;
      const content = f.kind === 'text' ? (f.text ?? '') : f.data;
      if (content !== undefined) this.enqueue(() => server.writeFile(p, content));
    }
  }

  get hasPendingWrites() {
    return this.dirty.size > 0 || this.pendingOps > 0;
  }

  // ---- queries ---------------------------------------------------------------

  get(path: string) {
    return this.files.get(path);
  }

  getText(path: string): string | undefined {
    return this.files.get(path)?.text;
  }

  /** Visible file paths (without folder placeholders), sorted. */
  paths(): string[] {
    return [...this.files.keys()].filter((p) => basename(p) !== KEEP).sort();
  }

  /** All folders implied by the file paths (including empty ones). */
  folders(): string[] {
    const out = new Set<string>();
    for (const p of this.files.keys()) {
      let d = dirname(p);
      while (d) {
        out.add(d);
        d = dirname(d);
      }
    }
    return [...out].sort();
  }

  textFiles(ext?: string): { path: string; text: string }[] {
    const out: { path: string; text: string }[] = [];
    for (const f of this.files.values()) {
      if (f.kind === 'text' && f.text !== undefined && (!ext || f.path.endsWith(ext))) out.push({ path: f.path, text: f.text });
    }
    return out;
  }

  exists(path: string) {
    return this.files.has(path) || this.folders().includes(path);
  }

  /**
   * Snapshot of the project for the compiler (copies binary data). Build
   * output from earlier compiles (the PDF, .aux, .log, …) is left out: the
   * engine keeps its own, and a stale one from another engine can break a run.
   */
  compileFiles(): CompileFile[] {
    const pdf = stripExt(this.project.mainFile) + '.pdf';
    const out: CompileFile[] = [];
    for (const f of this.files.values()) {
      if (basename(f.path) === KEEP || f.omitted || f.path === pdf || BUILD_OUTPUT.test(f.path)) continue;
      if (f.kind === 'text') out.push({ path: f.path, data: f.text ?? '' });
      else if (f.data) out.push({ path: f.path, data: f.data });
    }
    return out;
  }

  // ---- mutations -------------------------------------------------------------

  setText(path: string, text: string) {
    const f = this.files.get(path);
    if (f && f.kind === 'text' && f.text === text) return;
    this.files.set(path, { path, kind: 'text', text, updatedAt: Date.now() });
    this.touch(path);
    this.emit(f ? 'content' : 'tree', path);
  }

  writeFile(path: string, content: string | Uint8Array): string {
    const p = normalisePath(path);
    if (!p) throw new Error(`Invalid file name: ${path}`);
    const existed = this.files.has(p);
    if (typeof content === 'string') this.files.set(p, { path: p, kind: 'text', text: content, updatedAt: Date.now() });
    else if (isTextPath(p) && !looksBinary(content)) {
      this.files.set(p, { path: p, kind: 'text', text: new TextDecoder().decode(content), updatedAt: Date.now() });
    } else this.files.set(p, { path: p, kind: 'binary', data: content, updatedAt: Date.now() });
    this.removeKeep(dirname(p));
    this.touch(p);
    this.emit(existed ? 'content' : 'tree', p);
    return p;
  }

  /** Record a file the server already wrote (e.g. the compiled PDF), without writing it back. */
  putClean(path: string, data: Uint8Array) {
    const existed = this.files.has(path);
    this.files.set(path, { path, kind: 'binary', data, updatedAt: Date.now() });
    this.removeKeep(dirname(path));
    if (!existed) this.emit('tree', path);
  }

  createFolder(path: string): string {
    const p = normalisePath(path);
    if (!p) throw new Error(`Invalid folder name: ${path}`);
    if (this.files.has(p)) throw new Error(`A file named "${p}" already exists`);
    if (!this.folders().includes(p)) {
      this.addKeep(p);
      this.enqueue(() => server.makeDir(p));
      this.emit('tree');
    }
    return p;
  }

  private addKeep(dir: string) {
    const keep = `${dir}/${KEEP}`;
    this.files.set(keep, { path: keep, kind: 'text', text: '', updatedAt: Date.now() });
  }

  private removeKeep(dir: string) {
    if (dir) this.files.delete(`${dir}/${KEEP}`);
  }

  /** Delete a file, or a folder and everything below it. Returns removed paths. */
  delete(path: string): string[] {
    const removed = [...this.files.keys()].filter((p) => p === path || p.startsWith(path + '/'));
    for (const p of removed) {
      this.files.delete(p);
      this.dirty.delete(p);
    }
    this.enqueue(() => server.deletePath(path));
    // The parent folder still exists on disk; keep showing it.
    const parent = dirname(path);
    if (parent && ![...this.files.keys()].some((p) => p.startsWith(parent + '/'))) this.addKeep(parent);
    this.project.updatedAt = Date.now();
    this.emit('tree');
    return removed.filter((p) => basename(p) !== KEEP);
  }

  /** Rename/move a file or folder. Returns [from, to] pairs of files moved. */
  rename(from: string, to: string): [string, string][] {
    const target = normalisePath(to);
    if (!target) throw new Error(`Invalid name: ${to}`);
    if (target === from) return [];
    if (this.files.has(target) || this.folders().includes(target)) throw new Error(`"${target}" already exists`);
    if (target.startsWith(from + '/')) throw new Error('Cannot move a folder into itself');
    const moves: [string, string][] = [];
    for (const p of [...this.files.keys()]) {
      if (p === from || p.startsWith(from + '/')) moves.push([p, target + p.slice(from.length)]);
    }
    if (!moves.length) throw new Error(`"${from}" does not exist`);
    // Pending writes land on the old path first (a file created a moment ago
    // may not be on disk yet), then the move carries everything over.
    this.queueWrites((p) => p === from || p.startsWith(from + '/'));
    this.enqueue(() => server.movePath(from, target));
    for (const [a, b] of moves) {
      const f = this.files.get(a)!;
      this.files.delete(a);
      this.files.set(b, { ...f, path: b, updatedAt: Date.now() });
    }
    this.removeKeep(dirname(target));
    const parent = dirname(from);
    if (parent && ![...this.files.keys()].some((p) => p.startsWith(parent + '/'))) this.addKeep(parent);
    if (this.project.mainFile === from || this.project.mainFile.startsWith(from + '/')) {
      this.project.mainFile = target + this.project.mainFile.slice(from.length);
      writeLocalMeta(this.project);
    }
    this.scheduleSave();
    this.emit('tree');
    return moves.filter(([a]) => basename(a) !== KEEP);
  }

  updateMeta(patch: Partial<ProjectMeta>) {
    Object.assign(this.project, patch, { updatedAt: Date.now() });
    writeLocalMeta(this.project);
    this.emit('meta');
  }
}

/** Binary sniffing: NUL bytes in the first 8 KB mean "not text". */
export function looksBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}

/** Pick the most plausible root document: the one with \documentclass, preferring main.tex. */
export function guessMainFile(files: { path: string; text?: string }[]): string | null {
  const roots = files.filter((f) => f.path.endsWith('.tex') && f.text && /\\documentclass/.test(f.text));
  if (!roots.length) return files.find((f) => f.path.endsWith('.tex'))?.path ?? null;
  const pref = roots.find((f) => /(^|\/)main\.tex$/.test(f.path)) ?? roots.find((f) => !f.path.includes('/'));
  return (pref ?? roots[0]).path;
}

/** fontspec/unicode-math/polyglossia ⇒ XeLaTeX; otherwise pdfLaTeX. */
export function detectEngine(main: string): TexEngine {
  return /\\usepackage(\[[^\]]*\])?\{(fontspec|unicode-math|polyglossia|xeCJK)\}/.test(main) ? 'xetex' : 'pdftex';
}
