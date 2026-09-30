/**
 * Client for the gitlatex server (gitlatex/routes/*.py).
 *
 * Projects are folders under the server's repos directory, and every file
 * operation writes straight to disk, so Git sees exactly what the editor
 * shows. The server keeps one "current project"; opening a project selects it
 * for the Git, compile and SyncTeX routes too.
 */
import { bytesToBase64 } from '../utils/misc';

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ServerError('Cannot reach the gitlatex server. Is it still running?', 0);
  }
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ServerError(`Unexpected response from the server (HTTP ${res.status})`, res.status);
  }
  const err = (data as { error?: unknown }).error;
  if (!res.ok || err) throw new ServerError(typeof err === 'string' && err ? err : `HTTP ${res.status}`, res.status);
  return data as T;
}

const get = <T>(url: string) => request<T>(url);
const post = <T>(url: string, body: unknown = {}) =>
  request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const qs = (params: Record<string, string | undefined>) =>
  '?' + new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString();

const payload = (content: string | Uint8Array) => (typeof content === 'string' ? { text: content } : { base64: bytesToBase64(content) });

// ---- projects --------------------------------------------------------------------

export interface ServerProject {
  name: string;
  hasGit: boolean;
  fileCount: number;
  lastModified: string | null;
  remoteUrl: string | null;
  owner: string | null;
}

export interface WireFile {
  path: string;
  text?: string;
  base64?: string;
  /** Too large to load into the editor; present on disk only. */
  omitted?: boolean;
  size?: number;
}

export interface OpenedProject {
  name: string;
  hasGit: boolean;
  files: WireFile[];
  folders: string[];
}

export const listProjects = () => get<{ repos: ServerProject[]; current: string | null }>('/repos');
export const openProject = (name: string) => post<OpenedProject>('/api/project/open', { name });
export const createProject = (name: string, files: { path: string; text?: string; data?: Uint8Array }[], git: boolean) =>
  post<{ name: string }>('/api/project/create', {
    name,
    git,
    files: files.map((f) => ({ path: f.path, ...payload(f.text ?? f.data ?? '') })),
  });
export const deleteProject = (name: string) => post('/delete-repo', { name });
export const renameProject = (from: string, to: string) => post<{ name: string }>('/api/project/rename', { from, to });
export const cloneProject = (repoUrl: string) => post('/clone', { repoUrl });

// ---- files -------------------------------------------------------------------------

export const writeFile = (path: string, content: string | Uint8Array) => post('/api/fs/write', { path, ...payload(content) });
export const makeDir = (path: string) => post('/api/fs/mkdir', { path });
export const deletePath = (path: string) => post('/api/fs/delete', { path });
export const movePath = (from: string, to: string) => post('/api/fs/move', { from, to });

/** Raw bytes of a project file, or null when it does not exist. */
export async function readRaw(path: string): Promise<Uint8Array | null> {
  const res = await fetch('/file-raw' + qs({ path, t: String(Date.now()) }));
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

// ---- compiling ---------------------------------------------------------------------

export interface ServerInfo {
  version: string;
  repository?: string;
  pypi?: string;
  latex: Record<'pdflatex' | 'xelatex' | 'lualatex', boolean>;
}

export const serverInfo = () => get<ServerInfo>('/api/info');

export interface LocalCompileResult {
  success?: boolean;
  error?: string;
  log?: string;
  steps?: { tool: string; missing?: boolean }[];
  engine?: string;
}

/** Build with the TeX installation on the server's machine. Errors come back in the result, not as throws. */
export async function compileLocally(main: string, engine: 'pdflatex' | 'xelatex' | 'lualatex'): Promise<LocalCompileResult> {
  const res = await fetch('/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ main, engine }),
  });
  try {
    return (await res.json()) as LocalCompileResult;
  } catch {
    return { error: `The server returned HTTP ${res.status}` };
  }
}

/** Store a PDF (and its SyncTeX data) built in the browser next to the main file. */
export const savePdf = (pdfPath: string, pdf: Uint8Array, main: string, synctex: Uint8Array | null) =>
  post('/save-pdf', { path: pdfPath, content: bytesToBase64(pdf), main, synctex: synctex ? bytesToBase64(synctex) : null });

// ---- git -------------------------------------------------------------------------------

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: 'A' | 'M' | 'D' | 'R';
  insertions: number;
  deletions: number;
}

export interface Commit {
  hash: string;
  short: string;
  message: string;
  author: string;
  date: string;
  isHead: boolean;
}

export interface FileDiff {
  binary: boolean;
  before: string;
  after: string;
  path: string;
}

export const commits = (skip = 0, limit = 50) => get<{ commits: Commit[]; hasMore: boolean }>('/commits' + qs({ skip: String(skip), limit: String(limit) }));
export const commitFiles = (hash: string) => get<{ files: ChangedFile[]; message: string }>('/commit-files' + qs({ hash }));
export const commitFile = (hash: string, path: string, oldPath?: string | null) =>
  get<FileDiff>('/commit-file' + qs({ hash, path, oldPath: oldPath ?? undefined }));
export const initRepo = () => post('/api/git/init');

// ---- source control (gitlatex/routes/scm.py) ----------------------------------------------

export interface ScmFile {
  path: string;
  oldPath: string | null;
  /** M modified, A added, D deleted, R renamed, T type change, ? untracked, U conflicted. */
  status: string;
  /** Conflicts only: git's two-letter code (UU both modified, AA both added, …) and a label. */
  kind?: string;
  label?: string;
}

export interface ScmStatus {
  branch: string | null;
  detached: boolean;
  hasCommits: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: ScmFile[];
  changes: ScmFile[];
  conflicts: ScmFile[];
  remotes: string[];
  /** `autostash`: a pull went through, but the user's uncommitted edits conflicted with it. */
  inProgress: 'merge' | 'rebase' | 'cherry-pick' | 'autostash' | null;
  /** Whose version git's "current" (ours) and "incoming" (theirs) are, e.g. "Your version". */
  sides: { current: string; incoming: string };
}

export interface ScmResult {
  status: ScmStatus;
  conflicts?: string[];
  cleared?: string[];
  /** Push: a coauthor had pushed first, so their commits were pulled in. */
  pulled?: boolean;
  /** Commit: the new commit, or null when a continued rebase stopped at another conflict. */
  commit?: string | null;
  output?: string;
}

export const scm = {
  status: () => get<ScmStatus>('/api/scm/status'),
  stage: (paths?: string[]) => post<ScmResult>('/api/scm/stage', { paths }),
  unstage: (paths?: string[]) => post<ScmResult>('/api/scm/unstage', { paths }),
  discard: (paths: string[]) => post<ScmResult>('/api/scm/discard', { paths }),
  resolve: (path: string, side: 'current' | 'incoming') => post<ScmResult>('/api/scm/resolve', { path, side }),
  markResolved: (path: string) => post<ScmResult>('/api/scm/mark-resolved', { path }),
  abort: () => post<ScmResult>('/api/scm/abort'),
  commit: (message: string) => post<ScmResult>('/api/scm/commit', { message }),
  pull: () => post<ScmResult>('/api/scm/pull'),
  push: () => post<ScmResult>('/api/scm/push'),
  sync: () => post<ScmResult>('/api/scm/sync'),
  fetch: () => post<ScmResult>('/api/scm/fetch'),
  branches: () => get<{ local: string[]; remote: string[] }>('/api/scm/branches'),
  checkout: (name: string, create = false) => post<ScmResult>('/api/scm/checkout', { name, create }),
  publishOptions: () => get<{ gh: boolean }>('/api/scm/publish-options'),
  publish: (opts: { url?: string; name?: string; private?: boolean }) => post<ScmResult>('/api/scm/publish', opts),
  diff: (path: string, staged: boolean) => get<FileDiff>(`/api/scm/diff${qs({ path, staged: staged ? '1' : '0' })}`),
};
