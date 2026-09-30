/// <reference lib="webworker" />
/**
 * The compile worker. All TeX work happens here, off the UI thread, so the
 * editor stays perfectly responsive even during a multi-pass build.
 *
 * Lifecycle: `init` → (`compile` | `info` | `clear-cache`)*.
 * Compiles are serialised; the UI coalesces rapid requests and can cancel a
 * runaway build by terminating this worker (TeX in WASM cannot be interrupted).
 */
import { BusyTexHost, SHELF_ROOT } from './busytex-host';
import { clearCaches } from './cache';
import { TexCompiler } from './compiler';
import { loadManifest, type EngineManifest } from './manifest';
import type { CompileRequest, EngineInfo, FromWorker, InitOptions, Progress, ToWorker } from './protocol';
import { PackageShelf } from './shelf';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let options: InitOptions | null = null;
let manifest: EngineManifest | null = null;
let shelf: PackageShelf | null = null;
let compiler: TexCompiler | null = null;
let initMs = 0;
let ready: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const progress = (p: Progress) => post({ type: 'progress', progress: p });

// Batch stdout lines so a chatty TeX run doesn't flood the UI thread.
let stdoutBuffer: string[] = [];
let stdoutTimer: ReturnType<typeof setTimeout> | null = null;
function stdout(line: string) {
  stdoutBuffer.push(line);
  if (!stdoutTimer) {
    stdoutTimer = setTimeout(() => {
      post({ type: 'stdout', line: stdoutBuffer.join('\n') });
      stdoutBuffer = [];
      stdoutTimer = null;
    }, 100);
  }
}

/** fonts.conf that also covers the add-on and shelf trees, so XeTeX can find those fonts by name. */
function writeFontConfig(host: BusyTexHost) {
  const dirs = ['/texlive/texmf-dist', '/texmf/texmf-dist', SHELF_ROOT].flatMap((root) =>
    ['opentype', 'truetype', 'type1'].map((t) => `  <dir>${root}/fonts/${t}</dir>`),
  );
  host.writeFile(
    `${SHELF_ROOT}/fonts.conf`,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n${dirs.join('\n')}\n  <cachedir>/tmp/fontconfig</cachedir>\n</fontconfig>\n`,
  );
}

async function createHost(): Promise<BusyTexHost> {
  if (!manifest || !options) throw new Error('Engine not initialised');
  const env: Record<string, string> = {
    // Also use ls-R databases for the add-on trees (written by the host), so
    // kpathsea never falls back to slow recursive directory searches.
    TEXMFDBS: `{!!$TEXMFLOCAL,!!$TEXMFSYSCONFIG,!!$TEXMFSYSVAR,!!$TEXMFDIST,!!${SHELF_ROOT}}`,
  };
  if (shelf) {
    // kpathsea searches auxiliary trees *before* the main TEXMF trees.
    env.TEXMFAUXTREES = `${SHELF_ROOT},`;
    env.FONTCONFIG_FILE = `${SHELF_ROOT}/fonts.conf`;
  }
  const host = await BusyTexHost.create(
    manifest,
    options.manifestUrl,
    manifest.packages.filter((p) => p.preload),
    env,
    {
      onProgress: (message, loaded, total) => progress({ phase: loaded !== undefined ? 'download' : 'init', message, loaded, total }),
      onStdout: stdout,
    },
  );
  if (shelf) writeFontConfig(host);
  host.writeLsR('/texmf/texmf-dist');
  host.writeLsR(SHELF_ROOT);
  return host;
}

async function init(opts: InitOptions) {
  const t0 = performance.now();
  options = opts;
  progress({ phase: 'init', message: 'Loading engine manifest…' });
  manifest = await loadManifest(opts.manifestUrl);
  if (opts.shelfUrl) {
    try {
      shelf = await PackageShelf.open(opts.shelfUrl);
    } catch (err) {
      // The shelf is optional: without it the engine still compiles everything in its base collections.
      console.warn('Package shelf unavailable:', err);
      shelf = null;
    }
  }
  const host = await createHost();
  compiler = new TexCompiler(host, manifest, shelf, { progress, stdout });
  initMs = Math.round(performance.now() - t0);
  post({ type: 'ready', info: await info() });
}

async function info(): Promise<EngineInfo> {
  return {
    name: manifest?.name ?? 'unknown',
    texlive: manifest?.texlive ?? '',
    engines: manifest?.engines ?? ['pdftex'],
    collections: (manifest?.packages ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      bytes: p.bytes,
      loaded: compiler?.host.loaded.has(p.id) ?? false,
    })),
    shelf: {
      enabled: !!shelf,
      label: shelf?.index.label ?? null,
      bundles: shelf?.size ?? 0,
      cached: shelf ? await shelf.cachedCount() : 0,
    },
    initMs,
  };
}

async function compile(request: CompileRequest) {
  if (!ready) throw new Error('Engine not initialised');
  await ready;
  if (!compiler) throw new Error('Engine failed to initialise');
  try {
    const result = await compiler.compile(request);
    const transfer: Transferable[] = [];
    if (result.pdf) transfer.push(result.pdf.buffer);
    if (result.synctex) transfer.push(result.synctex.buffer);
    post({ type: 'result', result }, transfer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (compiler.host.broken) {
      // WebAssembly aborted (e.g. out of memory): rebuild the engine for the next compile.
      progress({ phase: 'init', message: 'Restarting TeX engine after a crash…' });
      compiler.reset(await createHost());
    }
    post({ type: 'error', message, fatal: false, requestId: request.id });
  }
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      ready ??= init(msg.options).catch((err) => {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err), fatal: true });
        throw err;
      });
      break;
    case 'compile':
      queue = queue.then(() => compile(msg.request)).catch(() => undefined);
      break;
    case 'info':
      void info().then((i) => post({ type: 'info', info: i }));
      break;
    case 'clear-cache':
      void (async () => {
        await clearCaches();
        await new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase('EM_PRELOAD_CACHE');
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        });
        post({ type: 'cache-cleared' });
      })();
      break;
  }
});

self.addEventListener('unhandledrejection', (e) => {
  post({ type: 'error', message: `Worker: ${String((e.reason as Error)?.message ?? e.reason)}`, fatal: false });
});
