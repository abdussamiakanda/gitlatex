/**
 * Application controller: every user-facing operation lives here so the React
 * components stay thin. Coordinates the Workspace (files), Monaco models,
 * the compile worker (EngineClient) and the store.
 */
import { EngineClient, CompileCancelledError } from '../engine/EngineClient';
import type { TexEngine } from '../engine/protocol';
import { Workspace, detectEngine, guessMainFile } from './workspace';
import { useEffect, useState } from 'react';
import { getState, setState, useStore, patchCompile, toast, dismissToast, openDialog, initialCompile, updateSettings, closeDialog, getCompilerApi, normalizeCompilerApiUrl } from './store';
import * as server from '../storage/server';
import { checkForUpdate } from './updates';
import { base64ToBytes, bytesToBase64 } from '../utils/misc';
import { downloadBytes, downloadProjectZip, downloadText, readFileList, unzipProject, type ImportedFile } from '../storage/local-disk';
import { bindWorkspace, getModel, syncAllModels, syncModel, disposeModel, openModels } from '../editor/models';
import { editorBridge } from '../editor/bridge';
import { monaco } from '../editor/monaco';
import { parseBibtexLog, parseTexLog } from '../latex/log-parser';
import { SyncTex } from '../latex/synctex';
import { packageInsertion } from '../latex/analysis';
import { passOptionsFix, type QuickFix } from '../latex/explain';
import type { SlashCommand } from '../editor/slash-commands';
import type { CompileResult } from '../engine/protocol';
import type { CompilerMode, Diagnostic, ProjectMeta } from '../types';
import { basename, dirname, isTextPath, joinPath, normalisePath, relativePath, stripExt } from '../utils/paths';
import { KEEP } from './workspace';
import { TEMPLATES } from '../templates';

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function engineUrls() {
  const s = getState().settings;
  const base = document.baseURI;
  return {
    manifestUrl: s.engineUrl ? new URL(s.engineUrl, base).href : new URL('engine/manifest.json', base).href,
    shelfUrl: !s.useShelf ? null : s.shelfUrl ? new URL(s.shelfUrl, base).href : new URL('shelf/index.json', base).href,
  };
}

export const engine = new EngineClient({ ...engineUrls(), timeoutMs: 240_000 });
engine.subscribe((snapshot) => setState({ engine: snapshot }));
engine.onStdout((chunk) => {
  const prev = getState().compile.console;
  const next = (prev + chunk + '\n').slice(-200_000);
  patchCompile({ console: next });
});

export function reconfigureEngine() {
  engine.configure(engineUrls());
  void engine.start().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Workspace lifecycle
// ---------------------------------------------------------------------------

let ws: Workspace | null = null;
let unsubscribe: (() => void) | null = null;
export const workspace = () => ws;

let booted: Promise<void> | null = null;

const LAST_PROJECT = 'gitlatex.lastProject';

Workspace.onError = (err) =>
  toast({ kind: 'error', title: 'Could not save to disk', message: err instanceof Error ? err.message : String(err), timeout: 0 });

/** Load the project list and reopen the last project (or show the projects home). Idempotent. */
export function boot(): Promise<void> {
  booted ??= doBoot();
  return booted;
}

async function doBoot() {
  try {
    await refreshProjects();
    const last = localStorage.getItem(LAST_PROJECT);
    if (last && getState().projects.some((p) => p.id === last)) await openProject(last);
  } catch (err) {
    toast({ kind: 'error', title: 'Could not load your projects', message: String(err instanceof Error ? err.message : err), timeout: 0 });
  } finally {
    setState({ booting: false });
  }
  void checkForUpdate();
  window.addEventListener('beforeunload', (e) => {
    if (ws?.hasPendingWrites) {
      void ws.flush();
      e.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void ws?.flush();
  });
}

export async function refreshProjects() {
  const { repos } = await server.listProjects();
  const projects: ProjectMeta[] = repos.map((r) => {
    const t = r.lastModified ? Date.parse(r.lastModified) : 0;
    return { id: r.name, name: r.name, createdAt: t, updatedAt: t, mainFile: '', engine: 'pdftex', hasGit: r.hasGit };
  });
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  setState({ projects });
}

export async function openProject(id: string) {
  if (ws) {
    await ws.flush();
    unsubscribe?.();
  }
  engine.cancel();
  let next: Workspace;
  try {
    next = await Workspace.open(id);
  } catch (err) {
    toast({ kind: 'error', title: `Could not open ${id}`, message: err instanceof Error ? err.message : String(err) });
    await refreshProjects().catch(() => undefined);
    return;
  }
  ws = next;
  bindWorkspace(next);
  unsubscribe = next.subscribe((kind) => {
    if (kind === 'meta') setState({ project: { ...next.project } });
    if (kind === 'tree') setState((s) => ({ treeVersion: s.treeVersion + 1, project: { ...next.project } }));
    if (kind === 'content') setState((s) => ({ contentVersion: s.contentVersion + 1 }));
    if (kind !== 'meta') {
      patchCompile({ dirtySinceCompile: true });
      scheduleAutoCompile();
      scheduleScmRefresh();
    }
  });
  const files = new Set(next.paths());
  const openTabs = (next.project.openTabs ?? []).filter((p) => files.has(p));
  if (!openTabs.length && files.has(next.project.mainFile)) openTabs.push(next.project.mainFile);
  const activePath = next.project.activePath && files.has(next.project.activePath) ? next.project.activePath : (openTabs[0] ?? null);
  setState((s) => ({
    project: { ...next.project },
    openTabs,
    activePath,
    compile: { ...initialCompile },
    treeVersion: s.treeVersion + 1,
    epoch: s.epoch + 1,
    gitVersion: s.gitVersion + 1,
    reveal: null,
    pdfTarget: null,
  }));
  try {
    localStorage.setItem(LAST_PROJECT, next.project.id);
  } catch {
    /* ignore */
  }
  void refreshScm();
  // Show the PDF from the last build straight away, as the classic UI did.
  void showExistingPdf(next);
  void warmUpEngine();
  void compile({ reason: 'open' });
}

/** Back to the projects home. */
export async function closeProject() {
  if (ws) {
    await ws.flush();
    unsubscribe?.();
  }
  engine.cancel();
  ws = null;
  unsubscribe = null;
  try {
    localStorage.removeItem(LAST_PROJECT);
  } catch {
    /* ignore */
  }
  setState({ project: null, openTabs: [], activePath: null, compile: { ...initialCompile }, reveal: null, pdfTarget: null, scm: null });
  await refreshProjects().catch(() => undefined);
}

/** Re-read the project from disk (after a pull, or when files changed outside the editor). */
export async function reloadProject() {
  if (ws) await openProject(ws.project.id);
}

/** What SyncTeX needs to map any compiler's file paths onto this project. */
const syncOptions = (w: Workspace) => ({ mainFile: w.project.mainFile, files: w.paths() });

async function showExistingPdf(current: Workspace) {
  const main = current.project.mainFile;
  const pdf = current.get(stripExt(main) + '.pdf')?.data;
  if (!pdf || ws !== current || getState().compile.pdf) return;
  const gz = await server.readRaw(stripExt(main) + '.synctex.gz').catch(() => null);
  const synctex = gz ? await SyncTex.fromGzip(gz, dirname(main), syncOptions(current)).catch(() => null) : null;
  if (ws !== current || getState().compile.pdf) return;
  patchCompile({ pdf, pdfVersion: getState().compile.pdfVersion + 1, synctex, pdfFromCurrentRun: false });
}

function persistTabs() {
  const { openTabs, activePath } = getState();
  ws?.updateMeta({ openTabs, activePath });
}

// ---------------------------------------------------------------------------
// Tabs & navigation
// ---------------------------------------------------------------------------

export function openFile(path: string, line?: number, column?: number) {
  if (!ws?.get(path)) return;
  setState((s) => ({
    openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
    activePath: path,
    reveal: line ? { path, line, column, nonce: Date.now() } : s.reveal,
  }));
  persistTabs();
}

export function closeTab(path: string) {
  setState((s) => {
    const idx = s.openTabs.indexOf(path);
    const openTabs = s.openTabs.filter((p) => p !== path);
    const activePath = s.activePath === path ? (openTabs[Math.min(idx, openTabs.length - 1)] ?? null) : s.activePath;
    return { openTabs, activePath };
  });
  persistTabs();
}

export function revealDiagnostic(d: Diagnostic) {
  if (d.file && ws?.get(d.file)) openFile(d.file, d.line ?? 1);
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

function newFileContent(path: string): string {
  if (path.endsWith('.tex')) return `% ${basename(path)}\n\\section{${stripExt(basename(path)).replace(/[-_]/g, ' ')}}\n\n`;
  if (path.endsWith('.bib')) return '@article{key2024,\n  author  = {Last, First},\n  title   = {Title},\n  journal = {Journal},\n  year    = {2024}\n}\n';
  if (path.endsWith('.sty')) return `\\NeedsTeXFormat{LaTeX2e}\n\\ProvidesPackage{${stripExt(basename(path))}}\n\n`;
  return '';
}

export function promptNewFile(dir = '') {
  openDialog({
    type: 'prompt',
    title: 'New file',
    label: dir ? `File name (in ${dir}/)` : 'File name',
    value: '',
    placeholder: 'chapter2.tex',
    confirm: 'Create',
    onSubmit: (name) => {
      if (!ws) return;
      const path = normalisePath(joinPath(dir, name.includes('.') ? name : `${name}.tex`));
      if (!path) throw new Error('Invalid file name');
      if (ws.get(path)) throw new Error(`${path} already exists`);
      ws.writeFile(path, newFileContent(path));
      openFile(path);
    },
  });
}

export function promptNewFolder(dir = '') {
  openDialog({
    type: 'prompt',
    title: 'New folder',
    label: 'Folder name',
    value: '',
    placeholder: 'figures',
    confirm: 'Create',
    onSubmit: (name) => {
      ws?.createFolder(joinPath(dir, name));
    },
  });
}

export function promptRename(path: string) {
  openDialog({
    type: 'prompt',
    title: `Rename ${basename(path)}`,
    label: 'New path',
    value: path,
    confirm: 'Rename',
    onSubmit: (to) => {
      if (!ws) return;
      const moves = ws.rename(path, to);
      const map = new Map(moves);
      for (const [from] of moves) disposeModel(from);
      setState((s) => ({
        openTabs: s.openTabs.map((p) => map.get(p) ?? p),
        activePath: s.activePath ? (map.get(s.activePath) ?? s.activePath) : null,
      }));
      persistTabs();
    },
  });
}

export function confirmDelete(path: string) {
  const isFolder = !ws?.get(path);
  openDialog({
    type: 'confirm',
    title: `Delete ${isFolder ? 'folder' : 'file'}?`,
    message: `“${path}”${isFolder ? ' and everything inside it' : ''} will be removed from this project. You can recover it from History if a version was saved.`,
    confirm: 'Delete',
    danger: true,
    onConfirm: () => {
      if (!ws) return;
      const removed = new Set(ws.delete(path));
      for (const p of removed) disposeModel(p);
      setState((s) => {
        const openTabs = s.openTabs.filter((p) => !removed.has(p));
        return { openTabs, activePath: s.activePath && removed.has(s.activePath) ? (openTabs[0] ?? null) : s.activePath };
      });
      persistTabs();
    },
  });
}

export function setMainFile(path: string) {
  ws?.updateMeta({ mainFile: path });
  toast({ kind: 'success', title: `Main document: ${path}` });
  void compile({ reason: 'manual' });
}

export function setEngine(engineName: TexEngine) {
  ws?.updateMeta({ engine: engineName });
  void compile({ reason: 'manual' });
}

/** Add imported files to the project (e.g. upload / drag & drop). */
export function addFiles(files: ImportedFile[], opts: { open?: boolean } = {}) {
  if (!ws || !files.length) return [];
  const written: string[] = [];
  for (const f of files) written.push(ws.writeFile(f.path, f.text ?? f.data ?? ''));
  for (const p of written) syncModel(p);
  toast({ kind: 'success', title: `Added ${written.length} file${written.length > 1 ? 's' : ''}`, message: written.slice(0, 4).join(', ') + (written.length > 4 ? '…' : '') });
  const first = written.find((p) => isTextPath(p));
  if (opts.open && first) openFile(first);
  return written;
}

export async function uploadFiles(list: FileList | File[], dir = '') {
  try {
    addFiles(await readFileList(list, dir), { open: true });
  } catch (err) {
    toast({ kind: 'error', title: 'Import failed', message: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(name: string, templateId: string, git = true) {
  const id = await Workspace.create(name.trim() || 'Untitled project', templateId, undefined, { git });
  await refreshProjects();
  await openProject(id);
  closeDialog();
}

export async function createProjectFromFiles(name: string, files: ImportedFile[]) {
  if (!files.some((f) => f.path.endsWith('.tex'))) throw new Error('No .tex files found in the imported files.');
  const mainFile = guessMainFile(files) ?? 'main.tex';
  const id = await Workspace.create(name, 'blank', files, { mainFile, engine: detectEngine(files.find((f) => f.path === mainFile)?.text ?? '') });
  await refreshProjects();
  await openProject(id);
}

export async function importZipAsProject(file: File) {
  try {
    const files = unzipProject(new Uint8Array(await file.arrayBuffer()));
    await createProjectFromFiles(file.name.replace(/\.zip$/i, ''), files);
    toast({ kind: 'success', title: 'Project imported', message: `${files.length} files from ${file.name}` });
  } catch (err) {
    toast({ kind: 'error', title: 'Import failed', message: String(err instanceof Error ? err.message : err) });
  }
}

export async function importFolderAsProject(list: FileList | File[]) {
  try {
    const files = await readFileList(list);
    const top = files[0]?.path.split('/')[0];
    const stripped = top && files.every((f) => f.path.startsWith(top + '/')) ? files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) })) : files;
    await createProjectFromFiles(top || 'Imported project', stripped);
  } catch (err) {
    toast({ kind: 'error', title: 'Import failed', message: String(err instanceof Error ? err.message : err) });
  }
}

/** Clone a Git repository into the repos folder and open it. */
export function promptClone() {
  openDialog({
    type: 'prompt',
    title: 'Clone a Git repository',
    label: 'Repository URL (HTTPS or SSH)',
    value: '',
    placeholder: 'https://github.com/you/thesis.git',
    confirm: 'Clone',
    onSubmit: async (url) => {
      const repoUrl = url.trim();
      if (!repoUrl) throw new Error('Enter a repository URL');
      await server.cloneProject(repoUrl);
      // The same folder name the server derives (gitlatex/routes/repos.py).
      const name = repoUrl.replace(/\/+$/, '').split('/').pop()!.replace(/\.git$/, '');
      await refreshProjects();
      await openProject(name);
      toast({ kind: 'success', title: `Cloned ${name}` });
    },
  });
}

export function promptRenameProject(id = ws?.project.id) {
  if (!id) return;
  openDialog({
    type: 'prompt',
    title: 'Rename project',
    label: 'Folder name',
    value: id,
    confirm: 'Rename',
    onSubmit: async (name) => {
      if (!name.trim() || name.trim() === id) return;
      const wasOpen = ws?.project.id === id;
      if (wasOpen) await ws!.flush();
      const renamed = await server.renameProject(id, name.trim());
      Workspace.renamed(id, renamed.name);
      await refreshProjects();
      if (wasOpen) await openProject(renamed.name);
    },
  });
}

export async function duplicateProject(id: string) {
  try {
    const source = ws?.project.id === id ? ws : await Workspace.open(id);
    await source.flush();
    const files = source.paths().flatMap((p) => {
      const f = source.get(p)!;
      return f.omitted ? [] : [{ path: p, text: f.text, data: f.data }];
    });
    const copy = await Workspace.create(`${source.project.name}-copy`, 'blank', files, {
      mainFile: source.project.mainFile,
      engine: source.project.engine,
      git: false,
    });
    await refreshProjects();
    await openProject(copy);
  } catch (err) {
    toast({ kind: 'error', title: 'Could not duplicate the project', message: err instanceof Error ? err.message : String(err) });
  }
}

export function confirmDeleteProject(id: string) {
  openDialog({
    type: 'confirm',
    title: 'Delete project?',
    message: `The folder “${id}” and everything in it, including its Git history, will be permanently deleted from disk. Commits already pushed to a remote are not affected.`,
    confirm: 'Delete project',
    danger: true,
    onConfirm: async () => {
      if (ws?.project.id === id) await closeProject();
      await server.deleteProject(id);
      Workspace.forget(id);
      await refreshProjects();
    },
  });
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

let running = false;
let pending: { clean: boolean } | null = null;
let autoTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by Stop, so a local build that finishes afterwards is ignored. */
let compileGeneration = 0;

function scheduleAutoCompile() {
  clearTimeout(autoTimer);
  const { autoCompile, autoCompileDelay } = getState().settings;
  if (!autoCompile) return;
  autoTimer = setTimeout(() => void compile({ reason: 'auto' }), autoCompileDelay);
}

/** Program names of the local TeX installation, per engine. */
const LOCAL_PROGRAM = { pdftex: 'pdflatex', xetex: 'xelatex', luatex: 'lualatex' } as const;

let infoPromise: Promise<server.ServerInfo | null> | null = null;
export const serverInfo = () => (infoPromise ??= server.serverInfo().catch(() => null));

/** Where the open project compiles: the chosen compiler, or for Auto, local TeX when it is installed. */
export async function resolveCompiler(texEngine: TexEngine): Promise<Compiler> {
  const mode = getState().settings.compiler;
  if (mode !== 'auto') return mode;
  const info = await serverInfo();
  return info?.latex[LOCAL_PROGRAM[texEngine]] ? 'local' : 'browser';
}

export type Compiler = 'browser' | 'local' | 'api';

/** The compiler the open project uses right now (Auto resolved), for the UI. */
export function useCompiler(): { chosen: CompilerMode; active: Compiler | null; latex: server.ServerInfo['latex'] | null } {
  const chosen = useStore((s) => s.settings.compiler);
  const texEngine = useStore((s) => s.project?.engine ?? 'pdftex');
  const [latex, setLatex] = useState<server.ServerInfo['latex'] | null>(null);
  useEffect(() => {
    let live = true;
    void serverInfo().then((info) => live && setLatex(info?.latex ?? null));
    return () => {
      live = false;
    };
  }, []);
  const active: Compiler | null =
    chosen !== 'auto' ? chosen : latex === null ? null : latex[LOCAL_PROGRAM[texEngine]] ? 'local' : 'browser';
  return { chosen, active, latex };
}

/** Switch compilers and rebuild with the new one. */
export function setCompiler(mode: CompilerMode) {
  updateSettings({ compiler: mode });
  void warmUpEngine();
  void compile({ reason: 'manual' });
}

/** Start downloading and booting the in-browser engine, but only if this project will use it. */
async function warmUpEngine() {
  const project = ws?.project;
  if (!project || (await resolveCompiler(project.engine)) !== 'browser') return;
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 400));
  idle(() => void engine.start().catch(() => undefined));
}

type Built = Omit<CompileResult, 'id'>;

/**
 * `persist`: write the PDF into the project folder. Not for the compile that runs
 * when a project opens: its sources are unchanged, so it would only mark a
 * committed main.pdf as modified (PDFs embed a timestamp) and block pulls.
 */
async function buildInBrowser(current: Workspace, clean: boolean, persist: boolean): Promise<Built> {
  const project = current.project;
  const settings = getState().settings;
  const result = await engine.compile({
    files: current.compileFiles(),
    mainFile: project.mainFile,
    engine: project.engine,
    bibtex: settings.bibtex,
    makeindex: true,
    maxPasses: 5,
    haltOnError: settings.haltOnError,
    synctex: true,
    clean,
    useShelf: settings.useShelf,
  });
  if (result.pdf && persist && settings.savePdf && ws === current) void storePdf(current, result.pdf, result.synctex);
  return result;
}

/** Keep the PDF built in the browser in the project folder too, like a local build. */
async function storePdf(current: Workspace, pdf: Uint8Array, synctex: Uint8Array | null) {
  const main = current.project.mainFile;
  const pdfPath = stripExt(main) + '.pdf';
  try {
    await server.savePdf(pdfPath, pdf, main, synctex);
    if (ws === current) current.putClean(pdfPath, pdf);
  } catch (err) {
    toast({ kind: 'warning', title: 'Could not save the PDF to the project folder', message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Build on a remote Compiler API, exactly as the classic editor did: POST
 * { main, files, engine } (optionally with a Bearer key) and get back
 * { success, pdf, synctex?, log?, error? }, where pdf is base64, a data: URL or
 * a URL to fetch. The format is documented in the classic editor
 * (Settings → Compiler API).
 */
async function buildViaApi(current: Workspace, persist: boolean): Promise<Built> {
  const project = current.project;
  const started = performance.now();
  const program = LOCAL_PROGRAM[project.engine];
  const { url, key } = getCompilerApi();
  const endpoint = normalizeCompilerApiUrl(url);
  if (!endpoint) throw new Error('No Compiler API URL is set. Add one in Settings → Compiler, or pick another compiler.');
  patchCompile({ console: `Sending ${project.mainFile} to ${endpoint}…\n` });
  const files = current.compileFiles().map((f) =>
    typeof f.data === 'string' ? { path: f.path, content: f.data } : { path: f.path, base64: bytesToBase64(f.data) },
  );
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ main: project.mainFile, files, engine: program }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; pdf?: string; synctex?: string; log?: string; error?: string };
  const fromWire = async (value?: string): Promise<Uint8Array | null> => {
    if (!value) return null;
    if (/^https?:\/\//.test(value)) {
      const r = await fetch(value);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    }
    return base64ToBytes(value.includes('base64,') ? value.slice(value.indexOf(',') + 1) : value);
  };
  const pdf = data.success ? await fromWire(data.pdf) : null;
  const synctex = pdf ? await fromWire(data.synctex).catch(() => null) : null;
  if (pdf && persist && getState().settings.savePdf && ws === current) void storePdf(current, pdf, synctex);
  const log = data.log ?? '';
  const error = data.error ?? (pdf ? null : `The Compiler API returned HTTP ${res.status} without a PDF`);
  return {
    status: !pdf ? 'failed' : /^! /m.test(log) ? 'errors' : /LaTeX Warning|Package \w+ Warning/.test(log) ? 'warnings' : 'success',
    pdf,
    synctex,
    log,
    bibtexLog: null,
    transcript: `${program} via ${endpoint}\n\n${error ? `Error: ${error}\n\n` : ''}${log}`,
    aux: null,
    steps: [],
    passes: 0,
    fetched: [],
    unresolved: [],
    collections: [],
    notices: error && !pdf ? [error] : [],
    durationMs: Math.round(performance.now() - started),
    jobName: basename(stripExt(project.mainFile)),
  };
}

async function buildLocally(current: Workspace): Promise<Built> {
  const project = current.project;
  const started = performance.now();
  const program = LOCAL_PROGRAM[project.engine];
  patchCompile({ console: `Running ${program} on ${project.mainFile}…\n` });
  const res = await server.compileLocally(project.mainFile, program);
  const job = stripExt(project.mainFile);
  const pdf = res.success ? await server.readRaw(job + '.pdf') : null;
  const synctex = pdf ? await server.readRaw(job + '.synctex.gz') : null;
  if (pdf && ws === current) current.putClean(job + '.pdf', pdf);
  const steps = (res.steps ?? []).map((st) => ({ tool: st.tool, args: [], exitCode: st.missing ? 127 : 0, ms: 0 }));
  const log = res.log ?? '';
  const hasErrors = /^! /m.test(log);
  const notices = [
    ...(res.error && !pdf ? [res.error] : []),
    ...(res.steps ?? []).filter((st) => st.missing).map((st) => `${st.tool} is not installed, so citations stay unresolved.`),
  ];
  return {
    status: !pdf ? 'failed' : hasErrors ? 'errors' : /LaTeX Warning|Package \w+ Warning/.test(log) ? 'warnings' : 'success',
    pdf,
    synctex,
    log,
    bibtexLog: null,
    transcript: `${steps.map((st) => st.tool).join(' → ') || program} (${project.mainFile})\n\n${log}`,
    aux: null,
    steps,
    passes: steps.filter((st) => st.tool === program).length,
    fetched: [],
    unresolved: [],
    collections: [],
    notices,
    durationMs: Math.round(performance.now() - started),
    jobName: basename(job),
  };
}

export async function compile(opts: { clean?: boolean; reason?: 'manual' | 'auto' | 'open' } = {}) {
  clearTimeout(autoTimer);
  if (!ws) return;
  const project = ws.project;
  const backend = await resolveCompiler(project.engine);
  if (opts.reason === 'open' && !getState().settings.autoCompile && (backend !== 'browser' || engine.state.state !== 'ready')) return;
  if (running) {
    pending = { clean: !!opts.clean || !!pending?.clean };
    return;
  }
  running = true;
  const generation = ++compileGeneration;
  const current = ws;
  const mainDir = dirname(project.mainFile);
  patchCompile({ status: 'running', backend, error: null, console: '', dirtySinceCompile: false });
  // On open, only write a PDF the project does not have yet (see buildInBrowser).
  const persist = opts.reason !== 'open' || !current.get(stripExt(project.mainFile) + '.pdf');
  try {
    await current.flush();
    const result =
      backend === 'local'
        ? await buildLocally(current)
        : backend === 'api'
          ? await buildViaApi(current, persist)
          : await buildInBrowser(current, !!opts.clean, persist);
    if (ws !== current || generation !== compileGeneration) return; // project switched or stopped meanwhile

    const diagnostics: Diagnostic[] = [
      ...parseTexLog(result.log, mainDir),
      ...(result.bibtexLog ? parseBibtexLog(result.bibtexLog, mainDir) : []),
      ...result.unresolved.map<Diagnostic>((name) => ({
        severity: 'error',
        message: `Not available in this TeX distribution: ${name}`,
        source: 'engine',
      })),
      ...result.notices.map<Diagnostic>((message) => ({ severity: 'warning', message, source: 'engine' })),
    ];
    let synctex: SyncTex | null = null;
    if (result.synctex) {
      try {
        synctex = await SyncTex.fromGzip(result.synctex, mainDir, syncOptions(current));
      } catch {
        synctex = null;
      }
    }
    const prev = getState().compile;
    const { pdf, synctex: _s, ...rest } = result;
    void _s;
    patchCompile({
      status: result.status,
      result: { id: 0, ...rest },
      pdf: pdf ?? prev.pdf,
      pdfVersion: pdf ? prev.pdfVersion + 1 : prev.pdfVersion,
      pdfFromCurrentRun: !!pdf,
      synctex: pdf ? synctex : prev.synctex,
      diagnostics,
      lastCompiledAt: Date.now(),
      error: null,
      ...(backend !== 'browser' ? { console: result.transcript } : {}),
    });
    applyMarkers();
    if (result.fetched.length) {
      const labels = new Map((getState().engine.info?.collections ?? []).map((c) => [c.id, c.label.replace(/\s*\(.*\)$/, '')]));
      const names = result.fetched.map((f) => labels.get(f) ?? f.replace(/^font:/, ''));
      toast({ kind: 'info', title: 'Installed on demand', message: names.slice(0, 6).join(', ') + (names.length > 6 ? '…' : ''), timeout: 3500 });
    }
  } catch (err) {
    if (err instanceof CompileCancelledError) patchCompile({ status: 'cancelled', error: err.message });
    else patchCompile({ status: 'crashed', error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
    if (pending) {
      const p = pending;
      pending = null;
      void compile({ clean: p.clean, reason: 'auto' });
    }
  }
}

export function cancelCompile() {
  pending = null;
  if (getState().compile.backend !== 'browser' && getState().compile.status === 'running') {
    // A local or remote build cannot be interrupted; its result is simply ignored.
    compileGeneration++;
    running = false;
    patchCompile({ status: 'cancelled', error: 'Stopped. The build finishes in the background and its result is ignored.' });
    return;
  }
  engine.cancel();
}

/** Show compile diagnostics as squiggles/markers in every open model. */
export function applyMarkers() {
  const diags = getState().compile.diagnostics;
  for (const [path, model] of openModels()) {
    const markers: monaco.editor.IMarkerData[] = diags
      .filter((d) => d.file === path && d.line && d.severity !== 'info')
      .map((d) => {
        const line = Math.min(Math.max(d.line!, 1), model.getLineCount());
        return {
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: line,
          startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
          source: d.source === 'bibtex' ? 'BibTeX' : 'TeX',
        };
      });
    monaco.editor.setModelMarkers(model, 'texbrowser', markers);
  }
}

// ---------------------------------------------------------------------------
// SyncTeX
// ---------------------------------------------------------------------------

/** Source → PDF: highlight where the cursor's line (or `line`) ended up in the PDF. */
export function forwardSearch(line?: number) {
  const { synctex } = getState().compile;
  const e = editorBridge.get();
  const path = getState().activePath;
  if (!synctex || !e || !path) {
    toast({ kind: 'info', title: 'Compile first', message: 'SyncTeX data is created with each compile.' });
    return;
  }
  line ??= e.getPosition()?.lineNumber ?? 1;
  const rects = synctex.forward(path, line);
  if (!rects.length) toast({ kind: 'info', title: 'No PDF location for this line' });
  else setState({ pdfTarget: { rects, nonce: Date.now() } });
}

export function inverseSearch(page: number, x: number, y: number) {
  const { synctex } = getState().compile;
  const hit = synctex?.inverse(page, x, y);
  if (hit && ws?.get(hit.file)) openFile(hit.file, hit.line);
}

// ---------------------------------------------------------------------------
// Editing helpers: packages, quick fixes, slash commands
// ---------------------------------------------------------------------------

/** Replace a whole line range of a file, via its Monaco model when open (keeps undo). */
function editFile(path: string, fn: (text: string) => string | null): boolean {
  if (!ws) return false;
  const model = getModel(path);
  const before = model ? model.getValue() : ws.getText(path);
  if (before === undefined) return false;
  const after = fn(before);
  if (after === null || after === before) return false;
  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: after }], () => null);
    model.pushStackElement();
  } else ws.setText(path, after);
  return true;
}

/** Ensure `\usepackage[options]{pkg}` is in the main document's preamble. Returns true if added. */
export function ensurePackage(pkg: string, options?: string): boolean {
  if (!ws) return false;
  const main = ws.project.mainFile;
  return editFile(main, (text) => {
    const ins = packageInsertion(text, pkg, options);
    if (!ins) return null;
    const lines = text.split('\n');
    lines.splice(ins.line - 1, 0, ins.text.replace(/\n$/, ''));
    return lines.join('\n');
  });
}

/** Ensure an arbitrary preamble line exists (e.g. \newtheorem{theorem}{Theorem}). */
export function ensurePreambleLine(line: string, marker: string): boolean {
  if (!ws) return false;
  return editFile(ws.project.mainFile, (text) => {
    if (text.includes(marker)) return null;
    const begin = text.search(/\\begin\s*\{document\}/);
    if (begin < 0) return null;
    return text.slice(0, begin) + line + '\n' + text.slice(begin);
  });
}

export function applyQuickFix(fix: QuickFix) {
  switch (fix.kind) {
    case 'addPackage':
      if (ensurePackage(fix.pkg, fix.options)) toast({ kind: 'success', title: `Added \\usepackage{${fix.pkg}}` });
      else toast({ kind: 'info', title: `${fix.pkg} is already loaded (or the main file has no preamble)` });
      break;
    case 'replaceInLine':
      editFile(fix.file, (text) => {
        const lines = text.split('\n');
        const i = fix.line - 1;
        if (!lines[i]) return null;
        // Replace the first occurrence that is not already escaped.
        const re = new RegExp(`(^|[^\\\\])${fix.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        lines[i] = lines[i].replace(re, (_m, pre: string) => pre + fix.replace);
        return lines.join('\n');
      });
      openFile(fix.file, fix.line);
      break;
    case 'switchEngine':
      setEngine(fix.engine);
      toast({ kind: 'success', title: `Switched to ${fix.engine === 'xetex' ? 'XeLaTeX' : 'pdfLaTeX'}` });
      return;
    case 'openFile':
      openFile(fix.file, fix.line);
      return;
    case 'passOptions':
      if (ws && editFile(ws.project.mainFile, (text) => passOptionsFix(text, fix.pkg)))
        toast({ kind: 'success', title: `Added \\PassOptionsToPackage for ${fix.pkg}` });
      else toast({ kind: 'info', title: `No \\usepackage[…]{${fix.pkg}} with options found in the main file` });
      break;
  }
}

/** Insert a slash command's snippet and add the packages it needs. */
export function runSlashCommand(cmd: SlashCommand) {
  const range = editorBridge.takeSlashRange();
  if (cmd.wizard) {
    // Remove the "/query" text now; the wizard inserts at the cursor later.
    const e = editorBridge.get();
    if (e && range) e.executeEdits('slash', [{ range, text: '' }]);
    openDialog({ type: 'wizard', wizard: cmd.wizard });
    addPackagesFor(cmd);
    return;
  }
  if (cmd.snippet) editorBridge.insertSnippet(cmd.snippet, range);
  addPackagesFor(cmd);
}

export function addPackagesFor(cmd: Pick<SlashCommand, 'packages' | 'id'>) {
  const added: string[] = [];
  for (const p of cmd.packages ?? []) if (ensurePackage(p.name, p.options)) added.push(p.name);
  if (cmd.id === 'theorem' && ensurePreambleLine('\\newtheorem{theorem}{Theorem}', '\\newtheorem{theorem}')) added.push('theorem definition');
  if (cmd.id === 'plot' && ensurePreambleLine('\\pgfplotsset{compat=1.17}', '\\pgfplotsset{compat')) added.push('pgfplots compat');
  if (added.length) toast({ kind: 'success', title: `Preamble updated`, message: `Added ${added.join(', ')}`, timeout: 2500 });
}

/**
 * Path to use in \includegraphics/\input for a project file. TeX resolves
 * relative paths against the main document's directory (its working
 * directory), even inside \input files.
 */
export function includePathFor(target: string): string {
  return relativePath(ws?.project.mainFile ?? 'main.tex', target);
}

// ---------------------------------------------------------------------------
// Source control (gitlatex/routes/scm.py), modelled on VS Code
// ---------------------------------------------------------------------------

const bumpGit = () => setState((s) => ({ gitVersion: s.gitVersion + 1 }));

let scmTimer: ReturnType<typeof setTimeout> | undefined;

/** Read the repository's state for the panel, the icon badge and the status bar. */
export async function refreshScm() {
  clearTimeout(scmTimer);
  const current = ws;
  if (!current?.project.hasGit) {
    setState({ scm: null });
    return;
  }
  try {
    const st = await server.scm.status();
    if (ws === current) setScm(st);
  } catch {
    if (ws === current) setState({ scm: null });
  }
}

/** Refresh shortly after edits have been written to disk. */
export function scheduleScmRefresh(delay = 1500) {
  clearTimeout(scmTimer);
  scmTimer = setTimeout(() => void refreshScm(), delay);
}

/** Bring the editor in line with the folder after Git changed files (pull, discard, switch branch…). */
export async function syncFromDisk() {
  const current = ws;
  if (!current) return;
  const changed = await current.refresh();
  if (ws !== current) return;
  syncAllModels();
  const files = new Set(current.paths());
  setState((s) => {
    const openTabs = s.openTabs.filter((p) => files.has(p));
    return { openTabs, activePath: s.activePath && files.has(s.activePath) ? s.activePath : (openTabs[0] ?? null) };
  });
  if (changed.length) {
    patchCompile({ dirtySinceCompile: true });
    scheduleAutoCompile();
  }
}

/**
 * Run one source control step: save pending edits, call the server, take the
 * status it returns, and re-sync the editor when files on disk changed.
 */
function setScm(st: server.ScmStatus | null) {
  setState({ scm: st });
  if (conflictToast !== null && !st?.conflicts.length) {
    dismissToast(conflictToast);
    conflictToast = null;
  }
}

async function scmStep(title: string, fn: () => Promise<server.ScmResult>, touchesFiles = false): Promise<server.ScmResult | undefined> {
  try {
    await ws?.flush();
    const res = await fn();
    setScm(res.status);
    if (touchesFiles) await syncFromDisk();
    return res;
  } catch (err) {
    toast({ kind: 'error', title, message: err instanceof Error ? err.message : String(err), timeout: 0 });
    void refreshScm();
    return undefined;
  } finally {
    bumpGit();
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const scmStage = (paths?: string[]) => scmStep('Could not stage', () => server.scm.stage(paths));
export const scmUnstage = (paths?: string[]) => scmStep('Could not unstage', () => server.scm.unstage(paths));

/** Throw away working-tree changes (asks first: this cannot be undone). */
export function scmDiscard(files: server.ScmFile[]) {
  if (!files.length) return;
  const untracked = files.filter((f) => f.status === '?');
  const what = files.length === 1 ? `“${files[0].path}”` : plural(files.length, 'file');
  openDialog({
    type: 'confirm',
    title: files.length === 1 ? 'Discard changes?' : `Discard changes in ${what}?`,
    message:
      `Your changes to ${what} will be lost for good.` +
      (untracked.length ? ` ${untracked.length === files.length ? (files.length === 1 ? 'It is' : 'They are') : plural(untracked.length, 'untracked file') + ' are'} not in Git yet, so ${untracked.length === 1 ? 'it' : 'they'} will be deleted.` : ''),
    confirm: 'Discard',
    danger: true,
    onConfirm: async () => {
      await scmStep('Could not discard', () => server.scm.discard(files.map((f) => f.path)), true);
    },
  });
}

/** Commit what is staged, or everything when nothing is (VS Code's smart commit). */
export async function scmCommit(message: string) {
  const op = getState().scm?.inProgress;
  // Continuing a rebase rewrites files (the next commits are replayed).
  const res = await scmStep('Commit failed', () => server.scm.commit(message), op === 'rebase');
  if (!res) return false;
  if (res.conflicts?.length) reportConflicts(res.conflicts, 'The rebase stopped at another conflict');
  else if (op === 'rebase') toast({ kind: 'success', title: 'Rebase finished', message: 'Your commits now sit on top of the remote’s. Sync to push them.' });
  else toast({ kind: 'success', title: op === 'merge' ? 'Merge committed' : 'Committed', message: `${res.commit ?? ''} ${message}`.trim() });
  return true;
}

/** The conflict warning on screen: replaced by the next one, and gone once nothing is left to resolve. */
let conflictToast: number | null = null;

function reportConflicts(files: string[], title?: string) {
  setState({ sidebar: 'git' });
  if (conflictToast !== null) dismissToast(conflictToast);
  conflictToast = toast({
    kind: 'warning',
    title: title ?? `Conflicts in ${plural(files.length, 'file')}`,
    message: `${files.slice(0, 4).join(', ')}${files.length > 4 ? '…' : ''}. Open each file under Merge Changes and pick a version for every conflict, or take a whole file. Abort puts everything back as it was.`,
    timeout: 0,
  });
}

function reportPull(res: server.ScmResult, title: string) {
  const replaced = res.cleared?.length ? ` Your local build output (${res.cleared.join(', ')}) was replaced by the remote's; the next compile rebuilds it.` : '';
  if (res.conflicts?.length) reportConflicts(res.conflicts, `You and the remote changed the same lines in ${plural(res.conflicts.length, 'file')}`);
  else toast({ kind: 'success', title, message: (res.output?.includes('Already up to date') ? 'Already up to date.' : 'The project was updated.') + replaced });
}

export async function scmPull() {
  const res = await scmStep('Pull failed', () => server.scm.pull(), true);
  if (res) reportPull(res, 'Pulled');
  return !!res;
}

export async function scmSync() {
  const res = await scmStep('Sync failed', () => server.scm.sync(), true);
  if (res) reportPull(res, 'Synced');
  return !!res;
}

export async function scmPush() {
  const res = await scmStep('Push failed', () => server.scm.push());
  if (!res) return false;
  // A coauthor pushed first, so their commits were pulled in: files changed.
  if (res.pulled) await syncFromDisk();
  if (res.conflicts?.length) reportConflicts(res.conflicts, 'Not pushed: a coauthor changed the same lines first');
  else toast({ kind: 'success', title: 'Pushed', message: res.pulled ? 'Your coauthors’ newer commits were pulled in first.' : res.status.upstream ? `to ${res.status.upstream}` : undefined });
  return true;
}

export const scmFetch = () => scmStep('Fetch failed', () => server.scm.fetch());

export async function scmCheckout(name: string, create = false) {
  const res = await scmStep(create ? 'Could not create the branch' : 'Could not switch branch', () => server.scm.checkout(name, create), true);
  if (res) toast({ kind: 'success', title: create ? `Created branch ${res.status.branch}` : `Switched to ${res.status.branch}` });
}

export function promptCreateBranch() {
  openDialog({
    type: 'prompt',
    title: 'Create branch',
    label: 'Branch name',
    value: '',
    placeholder: 'revision-2',
    confirm: 'Create',
    onSubmit: async (name) => {
      const n = name.trim().replace(/\s+/g, '-');
      if (!n) throw new Error('Enter a branch name');
      await scmCheckout(n, true);
    },
  });
}

export function scmAbort() {
  const op = getState().scm?.inProgress ?? 'merge';
  const what = op === 'autostash' ? 'pull' : op;
  openDialog({
    type: 'confirm',
    title: `Abort the ${what}?`,
    message:
      op === 'autostash'
        ? 'Your files go back to how they were before the pull, with your unsaved edits as you left them. Pull again once you are ready.'
        : `Files go back to how they were before the ${what} started. Conflict resolutions you made are lost.`,
    confirm: `Abort ${what}`,
    danger: true,
    onConfirm: async () => {
      const res = await scmStep(`Could not abort the ${what}`, () => server.scm.abort(), true);
      if (res) toast({ kind: 'info', title: `${what[0].toUpperCase()}${what.slice(1)} aborted` });
    },
  });
}

/** Resolve a whole file with one side: 'current' (yours) or 'incoming' (theirs). */
export const scmResolve = (path: string, side: 'current' | 'incoming') => scmStep('Could not resolve', () => server.scm.resolve(path, side), true);

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})( |$)/m;

/** Stage a conflicted file as resolved; warns when it still contains conflict markers. */
export async function scmMarkResolved(path: string) {
  await ws?.flush();
  const text = ws?.getText(path);
  const run = () => scmStep('Could not mark resolved', () => server.scm.markResolved(path));
  if (text !== undefined && CONFLICT_MARKER.test(text)) {
    openDialog({
      type: 'confirm',
      title: 'Conflict markers remain',
      message: `“${path}” still contains <<<<<<< / ======= / >>>>>>> lines. Mark it resolved anyway?`,
      confirm: 'Mark resolved',
      onConfirm: async () => void (await run()),
    });
    return;
  }
  await run();
}

export const openPublishDialog = () => openDialog({ type: 'publish' });

export async function scmPublish(opts: { url?: string; name?: string; private?: boolean }) {
  await ws?.flush();
  const res = await server.scm.publish(opts); // errors are shown in the dialog
  setScm(res.status);
  bumpGit();
  toast({ kind: 'success', title: 'Published', message: res.status.upstream ? `Pushed ${res.status.branch} to ${res.status.upstream}` : undefined });
}

export async function gitInit() {
  try {
    await server.initRepo();
  } catch (err) {
    toast({ kind: 'error', title: 'Could not create a repository', message: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!ws) return;
  ws.updateMeta({ hasGit: true });
  await refreshScm();
  bumpGit();
  toast({ kind: 'success', title: 'Git repository created' });
}

/** Replace a file's content with an older version (from a diff), keeping editor undo. */
export function restoreFileContent(path: string, text: string) {
  if (!ws) return;
  if (!ws.get(path)) ws.writeFile(path, text);
  else editFile(path, () => text);
  openFile(path);
  toast({ kind: 'success', title: `Restored ${basename(path)}`, message: 'Commit to record the change.' });
}

// ---------------------------------------------------------------------------
// Local disk
// ---------------------------------------------------------------------------

export function downloadActive() {
  const path = getState().activePath;
  const f = path ? ws?.get(path) : undefined;
  if (!f) return;
  if (f.kind === 'text') downloadText(f.path, f.text ?? '');
  else if (f.data) downloadBytes(basename(f.path), f.data);
}

export function downloadZip() {
  if (ws) downloadProjectZip(ws, getState().compile.pdf);
}

export function downloadPdf() {
  const { pdf } = getState().compile;
  if (!pdf || !ws) {
    toast({ kind: 'info', title: 'No PDF yet', message: 'Compile the project first.' });
    return;
  }
  downloadBytes(`${stripExt(basename(ws.project.mainFile))}.pdf`, pdf, 'application/pdf');
}

export function openPdfInNewTab() {
  const { pdf } = getState().compile;
  if (!pdf) return;
  const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function newProjectDialog(initialTemplate?: string) {
  openDialog({ type: 'new-project', initialTemplate });
}

export function setTheme(theme: 'dark' | 'light' | 'system') {
  updateSettings({ theme });
  applyTheme();
}

export function applyTheme() {
  const t = getState().settings.theme;
  const resolved = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = resolved;
  monaco.editor.setTheme(resolved === 'dark' ? 'gitlatex-dark' : 'gitlatex-light');
}

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
export const isKeepFile = (p: string) => basename(p) === KEEP;
