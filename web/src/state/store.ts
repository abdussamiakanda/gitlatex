/**
 * Global UI state (zustand). The heavy objects — the Workspace, Monaco models,
 * the engine worker — live outside the store; the store holds what React
 * renders plus version counters that change when those objects change.
 */
import { create } from 'zustand';
import type { CompileResult } from '../engine/protocol';
import type { EngineSnapshot } from '../engine/EngineClient';
import type { SyncRect, SyncTex } from '../latex/synctex';
import type { Wizard } from '../editor/slash-commands';
import { DEFAULT_SETTINGS, type Diagnostic, type ProjectMeta, type Settings } from '../types';
import type { UpdateInfo } from './updates';
import type { ScmStatus } from '../storage/server';

export type CompileStatus = 'idle' | 'running' | 'success' | 'warnings' | 'errors' | 'failed' | 'cancelled' | 'crashed';

export type SidebarView = 'files' | 'outline' | 'review' | 'git' | 'history' | 'engine';
export type BottomView = 'problems' | 'log' | 'console';

export type Dialog =
  | { type: 'new-project'; initialTemplate?: string }
  | { type: 'settings'; section?: 'about' }
  | { type: 'publish' }
  | { type: 'command-palette' }
  | { type: 'shortcuts' }
  | { type: 'wizard'; wizard: Wizard }
  | { type: 'prompt'; title: string; label: string; value: string; placeholder?: string; confirm: string; onSubmit: (v: string) => void | Promise<void>; onCancel?: () => void }
  | { type: 'confirm'; title: string; message: string; confirm: string; danger?: boolean; onConfirm: () => void | Promise<void>; onCancel?: () => void }
  | { type: 'diff'; title: string; path: string; original: string; modified: string; onRestore?: () => void };

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'warning';
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
  timeout?: number;
}

export interface CompileState {
  status: CompileStatus;
  /** Which compiler produced the current result. */
  backend: 'browser' | 'local' | 'api' | null;
  result: Omit<CompileResult, 'pdf' | 'synctex'> | null;
  /** Last successfully produced PDF (kept visible while a later compile fails). */
  pdf: Uint8Array | null;
  pdfVersion: number;
  cursorPage: number | null;
  pdfFromCurrentRun: boolean;
  synctex: SyncTex | null;
  diagnostics: Diagnostic[];
  console: string;
  error: string | null;
  lastCompiledAt: number | null;
  dirtySinceCompile: boolean;
}

export interface AppState {
  settings: Settings;
  projects: ProjectMeta[];
  project: ProjectMeta | null;
  treeVersion: number;
  contentVersion: number;
  /** Incremented whenever a project is (re)opened and all editor models are recreated. */
  epoch: number;
  openTabs: string[];
  activePath: string | null;
  engine: EngineSnapshot;
  compile: CompileState;
  sidebar: SidebarView | null;
  bottom: BottomView | null;
  dialog: Dialog | null;
  toasts: Toast[];
  /** Ask the editor to reveal a location. */
  reveal: { path: string; line: number; column?: number; nonce: number } | null;
  /** Ask the PDF viewer to scroll to/highlight rectangles (SyncTeX forward search). */
  pdfTarget: { rects: SyncRect[]; nonce: number } | null;
  cursor: { line: number; column: number } | null;
  booting: boolean;
  /** Bumped after commits, pulls and pushes so Git views refresh. */
  gitVersion: number;
  /** Open comment threads in the file being edited. */
  reviewCount: number;
  /** The running version and whether PyPI has a newer one (null until checked). */
  update: UpdateInfo | null;
  /** The open project's Git state (null when it is not a repository). */
  scm: ScmStatus | null;
}

const SETTINGS_KEY = 'gitlatex.settings';

export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(saved ?? '{}') as Partial<Settings>) };
    // First run after the classic editor: keep compiling through its Compiler API if it did.
    if (saved === null) {
      // First run after the classic editor: carry its choices over.
      if (useCompilerApiClassic()) settings.compiler = 'api';
      settings.vim = localStorage.getItem('gitlatex-vim') === 'true';
      settings.spellCheck = localStorage.getItem('gitlatex-spellcheck') !== 'false';
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// The Compiler API URL and key live under the classic editor's keys
// (public/js/core/storage.js), so both editors share one configuration.
const API_URL_KEY = 'gitlatex-compiler-api';
const API_TOKEN_KEY = 'gitlatex-compiler-api-key';

function useCompilerApiClassic() {
  const v = localStorage.getItem('gitlatex-use-compiler-api');
  return v === 'true' || (v === null && !!localStorage.getItem(API_URL_KEY)?.trim());
}

export function getCompilerApi(): { url: string; key: string } {
  try {
    return { url: localStorage.getItem(API_URL_KEY)?.trim() ?? '', key: localStorage.getItem(API_TOKEN_KEY)?.trim() ?? '' };
  } catch {
    return { url: '', key: '' };
  }
}

export function setCompilerApi(patch: { url?: string; key?: string }) {
  try {
    for (const [k, v] of [[API_URL_KEY, patch.url], [API_TOKEN_KEY, patch.key]] as const) {
      if (v === undefined) continue;
      if (v.trim()) localStorage.setItem(k, v.trim());
      else localStorage.removeItem(k);
    }
  } catch {
    /* storage disabled */
  }
}

/** `example.com/compile` → `https://example.com/compile`, as the classic editor did. */
export function normalizeCompilerApiUrl(url: string) {
  const u = url.trim();
  if (!u) return '';
  return /^https?:\/\//.test(u) ? u : `https://${u}`;
}

export const initialCompile: CompileState = {
  status: 'idle',
  backend: null,
  result: null,
  pdf: null,
  pdfVersion: 0,
  cursorPage: null,
  pdfFromCurrentRun: false,
  synctex: null,
  diagnostics: [],
  console: '',
  error: null,
  lastCompiledAt: null,
  dirtySinceCompile: true,
};

export const useStore = create<AppState>(() => ({
  settings: loadSettings(),
  projects: [],
  project: null,
  treeVersion: 0,
  contentVersion: 0,
  epoch: 0,
  openTabs: [],
  activePath: null,
  engine: { state: 'idle', progress: null, info: null, error: null },
  compile: initialCompile,
  sidebar: 'files',
  bottom: null,
  dialog: null,
  toasts: [],
  reveal: null,
  pdfTarget: null,
  cursor: null,
  booting: true,
  gitVersion: 0,
  reviewCount: 0,
  update: null,
  scm: null,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...getState().settings, ...patch };
  setState({ settings });
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full / disabled */
  }
}

export function patchCompile(patch: Partial<CompileState>) {
  setState((s) => ({ compile: { ...s.compile, ...patch } }));
}

let toastId = 0;
export function toast(t: Omit<Toast, 'id'>): number {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
  const timeout = t.timeout ?? (t.kind === 'error' ? 9000 : 4500);
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout);
  return id;
}

export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function openDialog(dialog: Dialog) {
  setState({ dialog });
}

export function closeDialog() {
  setState({ dialog: null });
}

/** Ask for one line of text; resolves to null when cancelled. */
export function promptText(title: string, label: string, value = '', confirm = 'OK'): Promise<string | null> {
  return new Promise((resolve) => {
    openDialog({ type: 'prompt', title, label, value, confirm, onSubmit: (v) => resolve(v), onCancel: () => resolve(null) });
  });
}
