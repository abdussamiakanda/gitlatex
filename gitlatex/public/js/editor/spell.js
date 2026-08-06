/**
 * Spell checking: squiggles, quick fixes and the personal dictionary.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";

// ----- Spell checking (symspellpy on the server, squiggles + quick fixes here) -----
//
// The server does the LaTeX-aware part: it blanks out comments, math and
// command arguments before looking words up, so what comes back is already
// limited to prose, with exact line/column positions.

export const SPELL_ENABLED_KEY = "gitlatex-spellcheck";
export const SPELL_OWNER = "spell";
export const SPELL_DEBOUNCE_MS = 700;
// Only prose-bearing files; .bib and code files are noise.
export const SPELL_EXTENSIONS = [".tex", ".txt", ".md", ".rmd"];
// Lowercased word -> suggestions, for the quick-fix provider.

export function getSpellCheckEnabled() {
  try {
    return localStorage.getItem(SPELL_ENABLED_KEY) !== "false";
  } catch (_) {
    return true;
  }
}

export function setSpellCheckEnabled(on) {
  try { localStorage.setItem(SPELL_ENABLED_KEY, on ? "true" : "false"); } catch (_) {}
  if (on) scheduleSpellCheck(0);
  else clearSpellMarkers();
}

export function isSpellCheckable(path) {
  const lower = (path || "").toLowerCase();
  return SPELL_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function clearSpellMarkers() {
  state.spellSuggestions.clear();
  if (!state.monacoApi || !state.editor) return;
  const model = state.editor.getModel();
  if (model) state.monacoApi.editor.setModelMarkers(model, SPELL_OWNER, []);
}

/** Asks the server once whether symspellpy is actually installed. */
export async function loadSpellStatus() {
  try {
    const res = await fetchApi("/spell/status");
    const data = await res.json();
    state.spellAvailable = !!data.available;
    state.spellUserWords = data.userWords || [];
    if (!state.spellAvailable && data.error) console.info("Spell check disabled:", data.error);
  } catch (_) {
    state.spellAvailable = false;
  }
  updateSpellSettingsUi();
  return state.spellAvailable;
}

export function scheduleSpellCheck(delay) {
  clearTimeout(state.spellTimer);
  state.spellTimer = setTimeout(runSpellCheck, delay === undefined ? SPELL_DEBOUNCE_MS : delay);
}

export async function runSpellCheck() {
  if (!state.monacoApi || !state.editor) return;
  const model = state.editor.getModel();
  if (!model) return;
  if (!getSpellCheckEnabled() || !isSpellCheckable(state.currentFile)) {
    clearSpellMarkers();
    return;
  }
  if (state.spellAvailable === null) await loadSpellStatus();
  if (!state.spellAvailable) return;

  const id = ++state.spellRequestId;
  const text = model.getValue();
  let data;
  try {
    const res = await fetchApi("/spell/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    data = await res.json();
  } catch (_) {
    return;
  }
  // A newer keystroke already fired, or the user switched files.
  if (id !== state.spellRequestId || state.editor.getModel() !== model) return;
  if (!data || data.available === false) {
    state.spellAvailable = false;
    clearSpellMarkers();
    return;
  }

  const words = data.words || [];
  state.spellSuggestions = new Map();
  const markers = words.map(function (w) {
    state.spellSuggestions.set(w.word.toLowerCase(), w.suggestions || []);
    const hint = (w.suggestions && w.suggestions.length)
      ? "Did you mean: " + w.suggestions.slice(0, 3).join(", ") + "?"
      : "Not in dictionary.";
    return {
      startLineNumber: w.line,
      endLineNumber: w.line,
      startColumn: w.column,
      endColumn: w.endColumn,
      message: '"' + w.word + '" - ' + hint,
      severity: state.monacoApi.MarkerSeverity.Info,
      source: "spelling"
    };
  });
  state.monacoApi.editor.setModelMarkers(model, SPELL_OWNER, markers);
}

export const SPELL_ADD_COMMAND = "gitlatex.addToDictionary";

/** Plain word under the cursor. Monaco's own getWordAtPosition is no help
 *  here: the latex language defines wordPattern as `\command`, so it never
 *  matches ordinary prose. */
export function wordAtCursor(ed) {
  const pos = ed.getPosition();
  const model = ed.getModel();
  if (!pos || !model) return null;
  const line = model.getLineContent(pos.lineNumber);
  const re = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const start = m.index + 1;
    const end = start + m[0].length;
    if (pos.column >= start && pos.column <= end) return m[0];
  }
  return null;
}

/** Quick fixes on a spelling marker: each suggestion, plus "add to dictionary". */
export function registerSpellCodeActions(monaco) {
  // A code action's `command` is dispatched through the command service, which
  // editor.addAction does not populate - register it explicitly.
  monaco.editor.registerCommand(SPELL_ADD_COMMAND, function (_accessor, word) {
    addWordToDictionary(word);
  });
  const provider = {
    provideCodeActions: function (model, range, context) {
      const actions = [];
      const seen = new Set();
      (context.markers || []).forEach(function (marker) {
        if (marker.source !== "spelling") return;
        const word = model.getValueInRange({
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn
        });
        if (!word || seen.has(word)) return;
        seen.add(word);
        const markerRange = {
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn
        };
        (state.spellSuggestions.get(word.toLowerCase()) || []).forEach(function (s, i) {
          actions.push({
            title: 'Replace with "' + s + '"',
            kind: "quickfix",
            diagnostics: [marker],
            isPreferred: i === 0,
            edit: {
              edits: [{
                resource: model.uri,
                textEdit: { range: markerRange, text: s },
                versionId: model.getVersionId()
              }]
            }
          });
        });
        actions.push({
          title: 'Add "' + word + '" to dictionary',
          kind: "quickfix",
          diagnostics: [marker],
          command: {
            id: SPELL_ADD_COMMAND,
            title: "Add to dictionary",
            arguments: [word]
          }
        });
      });
      return { actions: actions, dispose: function () {} };
    }
  };
  monaco.languages.registerCodeActionProvider("latex", provider);
  monaco.languages.registerCodeActionProvider("plaintext", provider);
}

/** Teaches the server a word, then re-checks so its squiggles disappear. */
export async function addWordToDictionary(word) {
  if (!word) return;
  try {
    const res = await fetchApi("/spell/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: word, action: "add" })
    });
    const data = await res.json();
    if (data.userWords) state.spellUserWords = data.userWords;
  } catch (_) {
    return;
  }
  updateSpellSettingsUi();
  scheduleSpellCheck(0);
}

export function updateSpellSettingsUi() {
  const toggle = document.getElementById("settings-spellcheck");
  if (toggle) {
    toggle.checked = getSpellCheckEnabled();
    toggle.disabled = state.spellAvailable === false;
  }
  const hint = document.getElementById("settings-spellcheck-hint");
  if (hint) {
    hint.textContent = state.spellAvailable === false
      ? "Unavailable - install the checker with: pip install symspellpy"
      : "Underlines unknown words in .tex, .txt and .md files. Comments, math and " +
        "command arguments are skipped. Fix one with Ctrl+. or the lightbulb; " +
        state.spellUserWords.length + " word" + (state.spellUserWords.length === 1 ? "" : "s") +
        " in your personal dictionary.";
  }
}

// LaTeX logs run to thousands of lines; keep the tail, which is where
