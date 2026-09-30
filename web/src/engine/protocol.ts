/**
 * Message protocol between the UI thread (EngineClient) and the compile
 * worker (tex.worker.ts). Everything that crosses the thread boundary is
 * declared here so both sides stay in sync.
 */

/** TeX engines available in the BusyTeX binary. */
export type TexEngine = 'pdftex' | 'xetex' | 'luatex';

export const ENGINE_LABELS: Record<TexEngine, string> = {
  pdftex: 'pdfLaTeX',
  xetex: 'XeLaTeX',
  luatex: 'LuaLaTeX',
};

/** A project file handed to the compiler. Text files are sent as strings. */
export interface CompileFile {
  path: string;
  data: string | Uint8Array;
}

export interface CompileRequest {
  /** Monotonic request id, echoed in the result. */
  id: number;
  /** Complete project snapshot; the worker diff-syncs it into its virtual FS. */
  files: CompileFile[];
  /** Path of the root document, e.g. `main.tex` or `thesis/main.tex`. */
  mainFile: string;
  engine: TexEngine;
  /** Run BibTeX automatically when the .aux file asks for it. */
  bibtex: 'auto' | 'always' | 'never';
  /** Run makeindex when an .idx file is produced. */
  makeindex: boolean;
  /** Upper bound on TeX passes (references, TOC, bibliography). */
  maxPasses: number;
  /** Stop at the first TeX error instead of producing a best-effort PDF. */
  haltOnError: boolean;
  /** Emit SyncTeX data for editor ⇄ PDF navigation. */
  synctex: boolean;
  /** Delete auxiliary files (aux/toc/bbl/…) before compiling. */
  clean: boolean;
  /** Allow fetching missing packages/fonts from the on-demand shelf. */
  useShelf: boolean;
}

export type CompileStatus = 'success' | 'warnings' | 'errors' | 'failed';

export interface CompileStep {
  tool: string;
  args: string[];
  exitCode: number;
  ms: number;
}

export interface CompileResult {
  id: number;
  status: CompileStatus;
  pdf: Uint8Array | null;
  /** gzip-compressed SyncTeX data (`<job>.synctex.gz`). */
  synctex: Uint8Array | null;
  /** The TeX log of the final pass. */
  log: string;
  /** BibTeX log (.blg), if BibTeX ran. */
  bibtexLog: string | null;
  /** Concatenated console transcript of every tool invocation. */
  transcript: string;
  /** Contents of the main .aux file (used for label/citation completion). */
  aux: string | null;
  steps: CompileStep[];
  passes: number;
  /** Names of shelf bundles fetched during this compile. */
  fetched: string[];
  /** Files TeX asked for that could not be found anywhere. */
  unresolved: string[];
  /** Data packages mounted in the engine (TeX Live collections). */
  collections: string[];
  /** Structured, human-oriented notices produced by the orchestrator. */
  notices: string[];
  durationMs: number;
  jobName: string;
}

export interface EngineInfo {
  name: string;
  texlive: string;
  engines: TexEngine[];
  collections: { id: string; label: string; bytes: number; loaded: boolean }[];
  shelf: { enabled: boolean; label: string | null; bundles: number; cached: number };
  initMs: number;
}

export interface InitOptions {
  /** Absolute URL of `engine/manifest.json`. */
  manifestUrl: string;
  /** Absolute URL of `shelf/index.json`, or null to disable on-demand packages. */
  shelfUrl: string | null;
}

// ---------------------------------------------------------------------------

export type ToWorker =
  | { type: 'init'; options: InitOptions }
  | { type: 'compile'; request: CompileRequest }
  | { type: 'clear-cache' }
  | { type: 'info' };

export type Progress = {
  phase: 'download' | 'init' | 'packages' | 'shelf' | 'compile';
  message: string;
  loaded?: number;
  total?: number;
};

export type FromWorker =
  | { type: 'progress'; progress: Progress }
  | { type: 'ready'; info: EngineInfo }
  | { type: 'stdout'; line: string }
  | { type: 'result'; result: CompileResult }
  | { type: 'info'; info: EngineInfo }
  | { type: 'cache-cleared' }
  | { type: 'error'; message: string; fatal: boolean; requestId?: number };
