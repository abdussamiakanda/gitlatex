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

export interface GitStatus {
  current: string | null;
  detached: boolean;
  hasCommits: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
  modified: string[];
  deleted: string[];
  staged: string[];
  untracked: string[];
}

export interface RemoteStatus {
  hasRemote: boolean;
  tracking?: string | null;
  branch?: string;
  behind: number;
  ahead: number;
  dirty: boolean;
}

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

export const gitStatus = () => get<{ status: GitStatus }>('/status').then((r) => r.status);
/** Fetches from origin first, so it can take a moment. */
export const remoteStatus = () => get<RemoteStatus>('/remote-status');
export const workingFiles = () => get<{ files: ChangedFile[] }>('/working-files').then((r) => r.files);
export const workingFile = (path: string) => get<FileDiff>('/working-file' + qs({ path }));
export const commits = (skip = 0, limit = 50) => get<{ commits: Commit[]; hasMore: boolean }>('/commits' + qs({ skip: String(skip), limit: String(limit) }));
export const commitFiles = (hash: string) => get<{ files: ChangedFile[]; message: string }>('/commit-files' + qs({ hash }));
export const commitFile = (hash: string, path: string, oldPath?: string | null) =>
  get<FileDiff>('/commit-file' + qs({ hash, path, oldPath: oldPath ?? undefined }));
export const commit = (message: string) => post<{ committed: boolean; hash?: string }>('/api/git/commit', { message });
export const push = (message: string) => post<{ committed: boolean }>('/push', { message });
/** `cleared`: local build output (main.pdf, main.synctex.gz…) replaced by the remote's copy. */
export const pull = () => post<{ output: string; changed: boolean; cleared?: string[] }>('/pull');
export const initRepo = () => post('/api/git/init');
