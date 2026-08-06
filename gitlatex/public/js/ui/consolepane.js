/**
 * The bottom console: output text, tab switching and show/hide.
 */

import { STORAGE_KEYS } from "./layout.js";

export function setConsole(text) {
  const el = document.getElementById("console");
  if (!el) return;
  el.textContent = text || "";
  // Anything writing plain text belongs in Output.
  showConsoleTab("output");
}

export function showConsoleTab(panel) {
  const problems = document.getElementById("problems-list");
  const output = document.getElementById("console");
  const tabP = document.getElementById("tab-problems");
  const tabO = document.getElementById("tab-output");
  if (!problems || !output || !tabP || !tabO) return;
  const wantProblems = panel === "problems";
  problems.classList.toggle("hidden", !wantProblems);
  output.classList.toggle("hidden", wantProblems);
  tabP.classList.toggle("active", wantProblems);
  tabO.classList.toggle("active", !wantProblems);
  tabP.setAttribute("aria-selected", wantProblems ? "true" : "false");
  tabO.setAttribute("aria-selected", wantProblems ? "false" : "true");
}

export function setProblemsBadge(problems) {
  const badge = document.getElementById("problems-badge");
  if (!badge) return;
  const count = (problems || []).length;
  const errors = (problems || []).filter(p => p.severity === "error").length;
  badge.textContent = String(count);
  badge.classList.toggle("hidden", count === 0);
  badge.classList.toggle("has-errors", errors > 0);
}

export function ensureConsoleVisible() {
  if (isConsoleHidden()) setConsoleVisible(true);
}

export function isConsoleHidden() {
  const view = document.getElementById("editor-view");
  return !!view && view.classList.contains("console-hidden");
}

export function setConsoleVisible(visible) {
  const view = document.getElementById("editor-view");
  if (!view) return;
  view.classList.toggle("console-hidden", !visible);
  try {
    localStorage.setItem(STORAGE_KEYS.consoleVisible, visible ? "true" : "false");
  } catch (_) {}
  const toggle = document.getElementById("console-toggle");
  if (toggle) {
    const label = visible ? "Hide console" : "Show console";
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-label", label);
  }
}
