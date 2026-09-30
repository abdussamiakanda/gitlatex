/**
 * EngineClient — the UI thread's handle on the compile worker.
 *
 * - boots the worker lazily and reports download/initialisation progress,
 * - turns compile requests into promises,
 * - cancels a running build by terminating the worker (a TeX run inside
 *   WebAssembly cannot be interrupted cooperatively) and transparently
 *   restarts it — engine assets come from CacheStorage, so a restart is fast,
 * - guards against runaway documents (infinite macro loops) with a timeout.
 */
import type { CompileRequest, CompileResult, EngineInfo, FromWorker, Progress, ToWorker } from './protocol';

export type EngineState = 'idle' | 'booting' | 'ready' | 'compiling' | 'error';

export interface EngineSnapshot {
  state: EngineState;
  progress: Progress | null;
  info: EngineInfo | null;
  error: string | null;
}

export class CompileCancelledError extends Error {
  constructor(message = 'Compilation cancelled') {
    super(message);
    this.name = 'CompileCancelledError';
  }
}

type Listener = (s: EngineSnapshot) => void;

export interface EngineClientOptions {
  manifestUrl: string;
  shelfUrl: string | null;
  /** Abort a compile that runs longer than this (ms). */
  timeoutMs?: number;
}

export class EngineClient {
  private worker: Worker | null = null;
  private boot: Promise<EngineInfo> | null = null;
  private bootResolve: ((i: EngineInfo) => void) | null = null;
  private bootReject: ((e: Error) => void) | null = null;
  private pending = new Map<number, { resolve: (r: CompileResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private listeners = new Set<Listener>();
  private stdoutListeners = new Set<(chunk: string) => void>();
  private snapshot: EngineSnapshot = { state: 'idle', progress: null, info: null, error: null };

  constructor(private opts: EngineClientOptions) {}

  get state() {
    return this.snapshot;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  onStdout(fn: (chunk: string) => void): () => void {
    this.stdoutListeners.add(fn);
    return () => this.stdoutListeners.delete(fn);
  }

  private set(patch: Partial<EngineSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l(this.snapshot);
  }

  /** Point the engine at different asset URLs (settings change). Restarts the worker. */
  configure(opts: Partial<EngineClientOptions>) {
    this.opts = { ...this.opts, ...opts };
    this.terminate(new CompileCancelledError('Engine reconfigured'));
  }

  start(): Promise<EngineInfo> {
    if (this.boot) return this.boot;
    this.set({ state: 'booting', error: null, progress: { phase: 'init', message: 'Starting compiler…' } });
    const worker = new Worker(new URL('./tex.worker.ts', import.meta.url), { type: 'module', name: 'tex-compiler' });
    this.worker = worker;
    this.boot = new Promise<EngineInfo>((resolve, reject) => {
      this.bootResolve = resolve;
      this.bootReject = reject;
    });
    // Avoid unhandled-rejection noise; callers observe errors via compile() / state.
    this.boot.catch(() => undefined);
    worker.addEventListener('message', (e: MessageEvent<FromWorker>) => this.onMessage(e.data));
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      this.fail(`Compiler worker crashed: ${e.message || 'unknown error'}`);
    });
    this.post({ type: 'init', options: { manifestUrl: this.opts.manifestUrl, shelfUrl: this.opts.shelfUrl } });
    return this.boot;
  }

  private post(msg: ToWorker) {
    this.worker?.postMessage(msg);
  }

  private fail(message: string) {
    this.set({ state: 'error', error: message, progress: null });
    this.bootReject?.(new Error(message));
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.boot = null;
  }

  private onMessage(msg: FromWorker) {
    switch (msg.type) {
      case 'progress':
        this.set({ progress: msg.progress });
        break;
      case 'ready':
        this.set({ state: this.pending.size ? 'compiling' : 'ready', info: msg.info, progress: null });
        this.bootResolve?.(msg.info);
        break;
      case 'info':
        this.set({ info: msg.info });
        break;
      case 'stdout':
        for (const l of this.stdoutListeners) l(msg.line);
        break;
      case 'result': {
        const p = this.pending.get(msg.result.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.result.id);
          p.resolve(msg.result);
        }
        if (!this.pending.size) this.set({ state: 'ready', progress: null });
        this.post({ type: 'info' });
        break;
      }
      case 'error': {
        if (msg.fatal) {
          this.fail(msg.message);
          break;
        }
        if (msg.requestId !== undefined) {
          const p = this.pending.get(msg.requestId);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(msg.requestId);
            p.reject(new Error(msg.message));
          }
          if (!this.pending.size) this.set({ state: 'ready', progress: null });
        } else console.warn('[engine]', msg.message);
        break;
      }
      case 'cache-cleared':
        break;
    }
  }

  async compile(req: Omit<CompileRequest, 'id'>): Promise<CompileResult> {
    await this.start();
    const id = this.nextId++;
    this.set({ state: 'compiling', error: null });
    return new Promise<CompileResult>((resolve, reject) => {
      const timeoutMs = this.opts.timeoutMs ?? 180_000;
      const timer = setTimeout(() => {
        this.terminate(new CompileCancelledError(`Compilation timed out after ${Math.round(timeoutMs / 1000)} s — the document may contain an infinite loop.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      // Structured clone copies the files; the worker keeps its own copy.
      this.post({ type: 'compile', request: { ...req, id } });
    });
  }

  /** Abort the running compile (if any) by terminating the worker. */
  cancel() {
    if (this.pending.size) this.terminate(new CompileCancelledError());
  }

  private terminate(reason: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(reason);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.boot = null;
    this.set({ state: 'idle', progress: null });
  }

  clearCache(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve();
        return;
      }
      const w = this.worker;
      const onMsg = (e: MessageEvent<FromWorker>) => {
        if (e.data.type === 'cache-cleared') {
          w.removeEventListener('message', onMsg);
          resolve();
        }
      };
      w.addEventListener('message', onMsg);
      this.post({ type: 'clear-cache' });
    });
  }

  dispose() {
    this.terminate(new CompileCancelledError('Engine disposed'));
    this.listeners.clear();
  }
}
