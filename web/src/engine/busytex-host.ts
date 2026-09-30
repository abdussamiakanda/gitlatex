/**
 * BusyTexHost — drives the BusyTeX WebAssembly binary inside a Web Worker.
 *
 * BusyTeX is a single Emscripten program that bundles TeX Live's pdfTeX,
 * XeTeX, LuaHBTeX, bibtex8, makeindex and xdvipdfmx behind a busybox-style
 * dispatcher: `callMain(['pdflatex', ...args])` runs pdfTeX exactly like a
 * native command line would.
 *
 * Two tricks make that work in a long-lived worker:
 *
 *  1. **Memory snapshots.** TeX programs keep global state and are not
 *     re-entrant. Right after start-up the first `memHeaderBytes` of linear
 *     memory hold all static data while the rest is zero, so we snapshot that
 *     header and restore it (zeroing everything else) after every tool run.
 *     Each invocation therefore starts from a pristine process image in
 *     microseconds instead of re-instantiating a 29 MB module.
 *
 *  2. **Emscripten data packages.** TeX Live is mounted from LZ4-compressed
 *     `file_packager` packages whose loader scripts expect a global object
 *     named `BusytexPipeline`. We provide that object as a shim whose
 *     prototype is the live Module, so the loaders can create files and
 *     register run-dependencies. The files are decompressed lazily on read.
 */
import type { EngineDataPackage, EngineManifest } from './manifest';
import { cachedFetch } from './cache';

/* eslint-disable @typescript-eslint/no-explicit-any */
type EmModule = any;

declare global {
  // Emscripten MODULARIZE factory defined by busytex.js
  var busytex: ((moduleArg: object) => Promise<EmModule>) | undefined;
  // Global the Emscripten data package loaders attach to (see file header)
  var BusytexPipeline: Record<string, any> | undefined;
}

export const ENGINE_CACHE = 'texbrowser-engine-v1';
export const SHELF_ROOT = '/texmf-shelf';
export const PROJECT_ROOT = '/home/web_user/project';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
}

export interface HostCallbacks {
  onProgress?: (message: string, loaded?: number, total?: number) => void;
  onStdout?: (line: string) => void;
}

/** Evaluate a classic (non-module) script in the worker's global scope. */
function evalGlobal(code: string, url: string) {
  const indirectEval = globalThis.eval;
  indirectEval(`${code}\n//# sourceURL=${url}`);
}

export class BusyTexHost {
  readonly loaded = new Set<string>();
  broken = false;
  private header!: Uint8Array;
  private stdout: string[] = [];
  private stderr: string[] = [];
  private streaming = false;
  private pendingDeps = new Map<string, () => void>();

  private constructor(
    readonly manifest: EngineManifest,
    readonly baseUrl: string,
    private readonly cb: HostCallbacks,
    public Module: EmModule,
  ) {}

  /** Absolute URL of an engine asset, with a content hash for cache busting. */
  static assetUrl(manifest: EngineManifest, baseUrl: string, name: string): string {
    const u = new URL(manifest.base + name, baseUrl);
    const h = manifest.hashes?.[name];
    if (h) u.searchParams.set('v', h);
    return u.href;
  }

  static async create(
    manifest: EngineManifest,
    manifestUrl: string,
    packages: EngineDataPackage[],
    extraEnv: Record<string, string>,
    cb: HostCallbacks = {},
  ): Promise<BusyTexHost> {
    const url = (name: string) => BusyTexHost.assetUrl(manifest, manifestUrl, name);

    // 1. Engine glue + WebAssembly binary (cached in CacheStorage for offline use).
    cb.onProgress?.('Downloading TeX engine…', 0, manifest.wasmBytes);
    const [wasmModule] = await Promise.all([
      cachedFetch(url(manifest.wasm), ENGINE_CACHE, {
        immutable: true,
        onProgress: (l, t) => cb.onProgress?.('Downloading TeX engine…', l, t || manifest.wasmBytes),
      })
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          cb.onProgress?.('Compiling WebAssembly…');
          return WebAssembly.compile(buf);
        }),
      globalThis.busytex
        ? Promise.resolve()
        : cachedFetch(url(manifest.js), ENGINE_CACHE, { immutable: true })
            .then((r) => r.text())
            .then((code) => evalGlobal(code, url(manifest.js))),
    ]);
    if (!globalThis.busytex) throw new Error('busytex.js did not define the busytex() factory');

    // 2. Data package shim (see header comment).
    const shim: Record<string, any> = {
      preRun: [] as Array<() => void>,
      calledRun: false,
      expectedDataFileDownloads: 0,
      locateFile: (name: string) => {
        const pkg = manifest.packages.find((p) => p.data === name || name.endsWith('/' + p.data));
        return url(pkg ? pkg.data : name);
      },
    };
    globalThis.BusytexPipeline = shim;

    let host: BusyTexHost | null = null;
    const env = { ...manifest.env, ...extraEnv };

    const M: EmModule = {
      thisProgram: '/bin/busytex',
      noInitialRun: true,
      print: (text: string) => host?.onOut(text, false),
      printErr: (text: string) => host?.onOut(text, true),
      setStatus: (text: string) => {
        const m = /Downloading data\.\.\. \((\d+)\/(\d+)\)/.exec(text);
        if (m) cb.onProgress?.('Downloading TeX Live packages…', Number(m[1]), Number(m[2]));
        else if (text) cb.onProgress?.(text);
      },
      monitorRunDependencies: (left: number) => {
        if (left) cb.onProgress?.(`Mounting TeX Live (${left} pending)…`);
      },
      preRun: [
        () => {
          Object.assign(M.ENV, env);
          for (const dir of [PROJECT_ROOT, SHELF_ROOT, '/tmp']) mkdirp(M.FS, dir);
        },
        () => {
          Object.setPrototypeOf(shim, M);
          for (const run of shim.preRun.splice(0)) run();
        },
      ],
      instantiateWasm(imports: WebAssembly.Imports, success: (i: WebAssembly.Instance) => void) {
        WebAssembly.instantiate(wasmModule, imports).then(success, (err) => {
          throw new Error(`Failed to instantiate the TeX engine: ${String(err)}`);
        });
        return {};
      },
    };

    // Route completion of data package downloads to promises (used for late mounting).
    shim.removeRunDependency = (id: string) => {
      M.removeRunDependency(id);
      host?.pendingDeps.get(id)?.();
    };

    // 3. Queue the loaders of the packages to mount at start-up.
    for (const pkg of packages) {
      const code = await (await cachedFetch(url(pkg.js), ENGINE_CACHE, { immutable: true })).text();
      evalGlobal(code, url(pkg.js));
    }

    cb.onProgress?.('Starting TeX engine…');
    const Module = await globalThis.busytex(M);
    host = new BusyTexHost(manifest, manifestUrl, cb, Module);
    shim.calledRun = true; // loaders evaluated from now on mount into the running module
    for (const p of packages) host.loaded.add(p.id);
    host.snapshot();
    return host;
  }

  private snapshot() {
    const size = this.manifest.memHeaderBytes;
    const heap: Uint8Array = this.Module.HEAPU8;
    // Everything beyond the header must still be zero for the snapshot to be complete.
    for (let i = size; i < heap.length; i += 4096) {
      if (heap[i] !== 0) throw new Error(`Memory header (${size} bytes) is too small for this engine build`);
    }
    this.header = heap.slice(0, size);
  }

  private onOut(text: string, isErr: boolean) {
    (isErr ? this.stderr : this.stdout).push(text);
    if (this.streaming) this.cb.onStdout?.(text);
  }

  /**
   * Mount an additional data package into the running engine. Emscripten's
   * loader runs immediately because `calledRun` is true; we wait for its
   * run-dependency to be released.
   */
  async loadPackage(pkg: EngineDataPackage): Promise<void> {
    if (this.loaded.has(pkg.id)) return;
    const url = BusyTexHost.assetUrl(this.manifest, this.baseUrl, pkg.js);
    const code = await (await cachedFetch(url, ENGINE_CACHE, { immutable: true })).text();
    const base = /var PACKAGE_NAME = '([^']+)'/.exec(code)?.[1] ?? pkg.data;
    const depId = `datafile_${base}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out mounting ${pkg.id}`)), 180_000);
      this.pendingDeps.set(depId, () => {
        clearTimeout(timer);
        this.pendingDeps.delete(depId);
        resolve();
      });
      try {
        evalGlobal(code, url);
      } catch (err) {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    this.loaded.add(pkg.id);
  }

  /** Run one BusyTeX applet (pdflatex, xelatex, bibtex8, …) and reset the process image. */
  run(args: string[], stream = true): RunResult {
    if (this.broken) throw new Error('The TeX engine crashed and must be restarted');
    const M = this.Module;
    this.stdout = [];
    this.stderr = [];
    this.streaming = stream;
    const t0 = performance.now();
    let exitCode: number;
    try {
      exitCode = M.callMain(args);
    } catch (err: any) {
      if (err && typeof err.status === 'number') exitCode = err.status;
      else {
        this.broken = true;
        throw new Error(`TeX engine crashed while running ${args[0]}: ${String(err?.message ?? err)}`);
      }
    } finally {
      this.streaming = false;
    }
    try {
      M._flush_streams?.();
    } catch {
      /* ignore */
    }
    // Restore the pristine process image for the next invocation (~70 ms for a 512 MB heap).
    const heap: Uint8Array = M.HEAPU8;
    heap.fill(0);
    heap.set(this.header);
    return { exitCode, stdout: this.stdout.join('\n'), stderr: this.stderr.join('\n'), ms: performance.now() - t0 };
  }

  // ---- filesystem helpers -------------------------------------------------

  get FS(): any {
    return this.Module.FS;
  }

  exists(path: string): boolean {
    return this.FS.analyzePath(path).exists;
  }

  writeFile(path: string, data: string | Uint8Array) {
    mkdirp(this.FS, path.slice(0, path.lastIndexOf('/')) || '/');
    this.FS.writeFile(path, data);
  }

  readText(path: string): string | null {
    return this.exists(path) ? (this.FS.readFile(path, { encoding: 'utf8' }) as string) : null;
  }

  readBytes(path: string): Uint8Array | null {
    return this.exists(path) ? (this.FS.readFile(path) as Uint8Array) : null;
  }

  unlink(path: string) {
    if (this.exists(path)) this.FS.unlink(path);
  }

  /** Recursively list regular files under `dir` (paths relative to dir). */
  listFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (abs: string, rel: string) => {
      for (const name of this.FS.readdir(abs) as string[]) {
        if (name === '.' || name === '..') continue;
        const a = `${abs}/${name}`;
        const r = rel ? `${rel}/${name}` : name;
        if (this.FS.isDir(this.FS.stat(a).mode)) walk(a, r);
        else out.push(r);
      }
    };
    if (this.exists(dir)) walk(dir, '');
    return out;
  }

  /** Remove everything inside `dir` (the directory itself stays). */
  clearDir(dir: string) {
    const rm = (abs: string) => {
      for (const name of this.FS.readdir(abs) as string[]) {
        if (name === '.' || name === '..') continue;
        const a = `${abs}/${name}`;
        if (this.FS.isDir(this.FS.stat(a).mode)) {
          rm(a);
          this.FS.rmdir(a);
        } else this.FS.unlink(a);
      }
    };
    if (this.exists(dir)) rm(dir);
  }

  /**
   * Write a kpathsea `ls-R` filename database for a tree. Without it, every
   * file lookup (including misses such as optional .cfg files) makes kpathsea
   * walk the whole directory tree — the dominant cost of a TeX run in WASM.
   * With it, lookups are hash-table hits.
   */
  writeLsR(root: string) {
    if (!this.exists(root)) return;
    const lines = ['% ls-R -- filename database for kpathsea; do not change this line.', ''];
    const walk = (abs: string, rel: string) => {
      const names = (this.FS.readdir(abs) as string[]).filter((n) => n !== '.' && n !== '..' && n !== 'ls-R');
      lines.push(`${rel}:`, ...names, '');
      for (const n of names) {
        const a = `${abs}/${n}`;
        if (this.FS.isDir(this.FS.stat(a).mode)) walk(a, `${rel}/${n}`);
      }
    };
    walk(root, '.');
    this.FS.writeFile(`${root}/ls-R`, lines.join('\n'));
  }

  chdir(dir: string) {
    mkdirp(this.FS, dir);
    this.FS.chdir(dir);
  }
}

export function mkdirp(FS: any, dir: string) {
  let cur = '';
  for (const part of dir.split('/')) {
    if (!part) continue;
    cur += '/' + part;
    if (!FS.analyzePath(cur).exists) FS.mkdir(cur);
  }
}
