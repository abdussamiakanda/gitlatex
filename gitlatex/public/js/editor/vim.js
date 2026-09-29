/**
 * Vim keybindings (monaco-vim) plus the VimTeX layer from vimtex.js.
 *
 * Off by default; toggled from Settings. monaco-vim is only downloaded the
 * first time Vim mode is switched on.
 */

import { state } from "../core/state.js";
import { compile } from "../build/compile.js";
import { showCompileErrors } from "../build/problems.js";
import { toggleOutlineSection } from "./outline.js";
import { saveCurrentFile } from "./session.js";
import { syncToPdf } from "./synctex.js";
import { installVimtex } from "./vimtex.js";
import { showInputModal } from "../ui/modals.js";

export const VIM_ENABLED_KEY = "gitlatex-vim";
const MONACO_VIM_URL = "https://unpkg.com/monaco-vim@0.4.4/dist/monaco-vim.umd";

let monacoVimPromise = null;
let monacoShimDefined = false;
let vimAdapter = null;
let configured = false;

export function getVimEnabled() {
  try {
    return localStorage.getItem(VIM_ENABLED_KEY) === "true";
  } catch (_) {
    return false;
  }
}

export function setVimEnabled(on) {
  try { localStorage.setItem(VIM_ENABLED_KEY, on ? "true" : "false"); } catch (_) {}
  applyVimMode();
}

function loadMonacoVim() {
  if (monacoVimPromise) return monacoVimPromise;
  monacoVimPromise = new Promise(function (resolve, reject) {
    // The UMD build asks the AMD loader for Monaco's ESM entry point; hand it
    // the monaco the page already loaded instead of a second copy.
    if (!monacoShimDefined) {
      define("monaco-editor/esm/vs/editor/editor.api", [], function () { return state.monacoApi; });
      monacoShimDefined = true;
    }
    require.config({ paths: { "monaco-vim": MONACO_VIM_URL } });
    require(["monaco-vim"], resolve, function (err) {
      monacoVimPromise = null;
      reject(err);
    });
  });
  return monacoVimPromise;
}

/** Brings the editor in line with the saved setting. Safe to call any time. */
export async function applyVimMode() {
  const editor = state.editor;
  const pane = document.getElementById("editor-pane");
  const statusEl = document.getElementById("vim-statusbar");
  if (!editor) return;
  const want = getVimEnabled();

  if (!want) {
    if (vimAdapter) {
      vimAdapter.dispose();
      vimAdapter = null;
    }
    pane?.classList.remove("vim-on");
    if (statusEl) statusEl.innerHTML = "";
    return;
  }
  if (vimAdapter) return;

  let MonacoVim;
  try {
    MonacoVim = await loadMonacoVim();
  } catch (e) {
    console.error("Could not load Vim mode:", e);
    return;
  }
  // The setting may have been switched off while the script downloaded.
  if (!getVimEnabled() || vimAdapter) return;
  configureVim(MonacoVim.VimMode);
  pane?.classList.add("vim-on");
  vimAdapter = MonacoVim.initVimMode(editor, statusEl);
  // The status bar changes the editor's height.
  requestAnimationFrame(() => editor.layout());
}

/** Global (not per-editor) Vim setup: ex commands and VimTeX mappings. Runs once. */
function configureVim(VimMode) {
  if (configured) return;
  configured = true;
  const Vim = VimMode.Vim;

  const save = () => { if (state.currentFile) saveCurrentFile(); };
  Vim.defineEx("write", "w", save);
  Vim.defineEx("update", "up", save);

  const hooks = {
    currentFile: () => state.currentFile,
    compile: () => compile(),
    view: (line, column) => syncToPdf(line, column),
    toc: () => toggleOutlineSection(),
    errors: () => showCompileErrors(),
    prompt: async function (title, defaultValue) {
      const value = await showInputModal({ title, label: "Name", defaultValue, submitLabel: "Change" });
      state.editor?.focus();
      return value;
    }
  };
  Vim.defineEx("VimtexCompile", "VimtexCompile", hooks.compile);
  Vim.defineEx("VimtexView", "VimtexView", function () {
    const p = state.editor?.getPosition();
    if (p) hooks.view(p.lineNumber, p.column);
  });
  Vim.defineEx("VimtexTocToggle", "VimtexToc", hooks.toc);
  Vim.defineEx("VimtexErrors", "VimtexErrors", hooks.errors);

  installVimtex(VimMode, state.monacoApi, hooks);
}
