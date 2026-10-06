/**
 * Vim keybindings (monaco-vim) plus the VimTeX layer from vimtex.ts.
 *
 * Off by default; toggled in Settings. monaco-vim is loaded on first use, so
 * people who never turn Vim on never download it.
 */
import type { monaco as Monaco } from './monaco';
import { monaco } from './monaco';
import { installVimtex } from './vimtex';

type Editor = Monaco.editor.IStandaloneCodeEditor;

export interface VimHooks {
  /** Path of the file in the editor (VimTeX mappings apply to TeX files only). */
  currentFile: () => string | null;
  save: () => void;
  compile: () => void;
  view: () => void;
  toc: () => void;
  errors: () => void;
  prompt: (title: string, value: string) => Promise<string | null>;
}

type MonacoVim = typeof import('monaco-vim');

let modulePromise: Promise<MonacoVim> | null = null;
let configured = false;
let adapter: { dispose(): void } | null = null;
/** The editor the adapter is attached to, and the one Vim was last requested for. */
let adapterEditor: Editor | null = null;
let wanted: Editor | null = null;

function load() {
  modulePromise ??= import('monaco-vim').catch((err: unknown) => {
    modulePromise = null;
    throw err;
  });
  return modulePromise;
}

/** Global (not per-editor) setup: ex commands and the VimTeX mappings. Runs once. */
function configure(VimMode: MonacoVim['VimMode'], hooks: VimHooks) {
  if (configured) return;
  configured = true;
  const Vim = (VimMode as unknown as { Vim: { defineEx(name: string, prefix: string, fn: () => void): void } }).Vim;
  Vim.defineEx('write', 'w', hooks.save);
  Vim.defineEx('update', 'up', hooks.save);
  Vim.defineEx('VimtexCompile', 'VimtexCompile', hooks.compile);
  Vim.defineEx('VimtexView', 'VimtexView', hooks.view);
  Vim.defineEx('VimtexTocToggle', 'VimtexToc', hooks.toc);
  Vim.defineEx('VimtexErrors', 'VimtexErrors', hooks.errors);
  installVimtex(VimMode, monaco, {
    currentFile: hooks.currentFile,
    compile: hooks.compile,
    view: () => hooks.view(),
    toc: hooks.toc,
    errors: hooks.errors,
    prompt: hooks.prompt,
  });
}

/** Turn Vim mode on or off for the editor. `statusBar` shows the mode and pending keys. */
export async function setVimMode(editor: Editor, statusBar: HTMLElement | null, on: boolean, hooks: VimHooks) {
  if (!on) {
    if (wanted === editor) wanted = null;
    if (adapterEditor === editor) {
      adapter?.dispose();
      adapter = null;
      adapterEditor = null;
    }
    if (statusBar) statusBar.textContent = '';
    return;
  }
  wanted = editor;
  if (adapterEditor === editor) return;
  const mod = await load();
  // While loading, Vim may have been turned off or the editor replaced (React
  // remounts): attach only to the editor that is still wanted.
  if (wanted !== editor || adapterEditor === editor) return;
  adapter?.dispose();
  configure(mod.VimMode, hooks);
  adapter = mod.initVimMode(editor, statusBar ?? undefined);
  adapterEditor = editor;
}

export function vimActive() {
  return adapter !== null;
}
