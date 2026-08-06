/**
 * Light/dark theme, including the matching Monaco editor theme.
 */

import { state } from "../core/state.js";
import { THEME_KEY } from "../core/storage.js";

export function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch (_) {}
  return "dark";
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll(".theme-option").forEach(btn => {
    const value = btn.getAttribute("data-theme");
    btn.setAttribute("aria-pressed", value === theme ? "true" : "false");
    btn.classList.toggle("active", value === theme);
  });
}

export function getMonacoTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "gitlatex-light" : "gitlatex-dark";
}

export function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {}
  applyTheme(theme);
  if (state.monacoApi) {
    // Global for all Monaco instances, including the versions diff editor.
    state.monacoApi.editor.setTheme(getMonacoTheme());
  }
}
