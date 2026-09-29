/**
 * Compile problems: the Problems tab, editor markers and jump-to-line.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";
import { loadFile } from "../editor/session.js";
import { ensureConsoleVisible, isConsoleHidden, setConsole, setConsoleVisible, setProblemsBadge, showConsoleTab } from "../ui/consolepane.js";

// ----- Compile problems: console list + Monaco markers -----

export function applyProblems(problems) {
  state.lastProblems = problems || [];
  refreshEditorMarkers();
}

export function refreshEditorMarkers() {
  if (!state.monacoApi || !state.editor) return;
  const model = state.editor.getModel();
  if (!model) return;
  const current = (state.currentFile || "").replace(/^\.\//, "");
  const mine = state.lastProblems.filter(function (p) {
    const f = (p.file || "").replace(/^\.\//, "");
    // Log paths can be relative to the project root or bare file names.
    return p.line && (f === current || current.endsWith("/" + f) || f.endsWith("/" + current));
  });
  state.monacoApi.editor.setModelMarkers(model, "latex", mine.map(function (p) {
    const line = Math.max(1, Math.min(p.line, model.getLineCount()));
    return {
      startLineNumber: line,
      endLineNumber: line,
      startColumn: 1,
      endColumn: model.getLineMaxColumn(line),
      message: p.message,
      severity: p.severity === "error"
        ? state.monacoApi.MarkerSeverity.Error
        : state.monacoApi.MarkerSeverity.Warning
    };
  }));
}

export function trimLog(log) {
  const lines = (log || "").split("\n");
  const MAX = 500;
  if (lines.length <= MAX) return log;
  return "... " + (lines.length - MAX) + " earlier lines hidden ...\n" +
    lines.slice(-MAX).join("\n");
}

export function clearProblems() {
  state.lastProblems = [];
  if (state.monacoApi && state.editor) {
    const model = state.editor.getModel();
    if (model) state.monacoApi.editor.setModelMarkers(model, "latex", []);
  }
  const box = document.getElementById("problems-list");
  if (box) box.innerHTML = "";
  setProblemsBadge([]);
  const out = document.getElementById("console");
  if (out) out.textContent = "";
  showConsoleTab("output");
}

// Fills the Problems tab; `summary` and the raw log go to Output.
export function renderProblems(problems, summary, log) {
  ensureConsoleVisible();
  const box = document.getElementById("problems-list");
  const out = document.getElementById("console");
  if (out) {
    out.textContent = (summary || "") + (log ? "\n\n" + trimLog(log) : "");
  }
  setProblemsBadge(problems);
  if (!box) return;
  box.innerHTML = "";
  if (!problems || !problems.length) {
    const empty = document.createElement("div");
    empty.className = "problems-empty";
    empty.textContent = "No problems. " + (summary || "");
    box.appendChild(empty);
    // Nothing to look at here - show the build output instead.
    showConsoleTab("output");
    return;
  }
  showConsoleTab("problems");

  problems.forEach(function (p) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "problem-row problem-" + p.severity;
    row.innerHTML =
      '<span class="material-icons problem-icon" aria-hidden="true"></span>' +
      '<span class="problem-message"></span>' +
      '<span class="problem-loc"></span>';
    row.querySelector(".problem-icon").textContent =
      p.severity === "error" ? "error" : "warning";
    row.querySelector(".problem-message").textContent = p.message;
    row.querySelector(".problem-loc").textContent =
      (p.file || "") + (p.line ? ":" + p.line : "");
    row.title = "Go to " + (p.file || "") + (p.line ? ":" + p.line : "");
    row.addEventListener("click", function () { goToProblem(p); });
    box.appendChild(row);
  });
}

export async function goToProblem(p) {
  if (!p.file) return;
  const target = p.file.replace(/^\.\//, "");
  if (target !== state.currentFile) {
    await loadFile(target);
  }
  if (!state.editor || !p.line) return;
  const model = state.editor.getModel();
  const line = model ? Math.max(1, Math.min(p.line, model.getLineCount())) : p.line;
  state.editor.revealLineInCenter(line);
  state.editor.setPosition({ lineNumber: line, column: 1 });
  state.editor.focus();
}

export async function showCompileErrors() {
  if (!isConsoleHidden()) {
    setConsoleVisible(false);
    return;
  }
  setConsoleVisible(true);
  if (state.lastProblems.length) {
    showConsoleTab("problems");
    return;
  }
  // Nothing parsed this session - fall back to the last stored error.
  try {
    const res = await fetchApi("/compile-error");
    const data = await res.json();
    setConsole(data.error ? "Last compile error:\n" + data.error : "No compile errors stored.");
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}
