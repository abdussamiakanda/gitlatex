/**
 * Loading Monaco and creating the one editor instance the app uses.
 *
 * ensureMonacoReady(cb) is the only entry point: it loads Monaco on first call,
 * queues callbacks until it is ready, and runs them immediately after that.
 */

import { state } from "../core/state.js";
import { registerCompletions } from "./completions.js";
import { registerLanguages } from "./languages.js";
import { highlightOutlineFor, scheduleOutlineRefresh } from "./outline.js";
import { saveCurrentFile } from "./session.js";
import { addWordToDictionary, loadSpellStatus, registerSpellCodeActions, scheduleSpellCheck, wordAtCursor } from "./spell.js";
import { getMonacoTheme } from "../ui/theme.js";

// ----- Editor page: init Monaco when needed -----
export function ensureMonacoReady(callback) {
  if (state.monacoReady && state.editor) {
    callback();
    return;
  }
  state.monacoReadyCallbacks.push(callback);
  if (state.monacoReadyCallbacks.length > 1) return;
  require.config({ paths: { vs: "https://unpkg.com/monaco-editor@latest/min/vs" } });
  require(["vs/editor/editor.main"], function () {
    state.monacoApi = monaco;
    registerLanguages(monaco);

    const editorEl = document.getElementById("editor");
    state.editor = monaco.editor.create(editorEl, {
      value: "",
      language: "latex",
      theme: getMonacoTheme(),
      quickSuggestions: { other: true, comments: true, strings: true },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      suggest: {
        showWords: false,
        showSnippets: true,
        showKeywords: true,
        showFunctions: true,
        showClasses: true,
        showModules: true,
        showVariables: true,
        showReferences: true,
        showFiles: true,
        matchOnWordStartOnly: false
      }
    });

    registerCompletions(monaco);

    // Spelling: squiggles, quick fixes and the "add to dictionary" command.
    registerSpellCodeActions(monaco);
    // Right-click entry, for adding the word under the cursor without going
    // through the lightbulb.
    state.editor.addAction({
      id: "gitlatex.addToDictionary.context",
      label: "Add Word to Dictionary",
      contextMenuGroupId: "1_modification",
      contextMenuOrder: 3,
      run: function (ed) {
        addWordToDictionary(wordAtCursor(ed));
      }
    });
    loadSpellStatus();

    let autosaveTimeout = null;
    const AUTOSAVE_DELAY_MS = 800;
    state.editor.onDidChangeModelContent(() => {
      clearTimeout(autosaveTimeout);
      autosaveTimeout = setTimeout(() => {
        if (state.currentFile) saveCurrentFile();
      }, AUTOSAVE_DELAY_MS);
      scheduleOutlineRefresh();
      scheduleSpellCheck();
    });
    state.editor.onDidChangeCursorPosition((e) => {
      highlightOutlineFor(e.position.lineNumber);
    });
    function layoutEditor() {
      if (state.editor && editorEl) {
        const w = Math.max(editorEl.offsetWidth || 0, 200);
        const h = Math.max(editorEl.offsetHeight || 0, 320);
        state.editor.layout({ width: w, height: h });
      }
    }
    layoutEditor();
    setTimeout(layoutEditor, 0);
    window.addEventListener("resize", layoutEditor);
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(layoutEditor).observe(editorEl);
    }
    state.monacoReady = true;
    state.monacoReadyCallbacks.forEach(cb => cb());
    state.monacoReadyCallbacks = [];
  });
}
