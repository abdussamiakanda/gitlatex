/**
 * The Settings view: compiler API fields, technical info and update check.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";
import { getLatexEngine, getStoredCompilerApi, getStoredCompilerApiKey, getUseCompilerApi } from "../core/storage.js";
import { loadSpellStatus, updateSpellSettingsUi } from "../editor/spell.js";

export function syncCompilerApiFields() {
  const on = !!document.getElementById("settings-use-api")?.checked;
  const fields = document.getElementById("settings-api-fields");
  const testBtn = document.getElementById("settings-test-api");
  const hint = document.getElementById("settings-engine-hint");
  if (fields) fields.classList.toggle("hidden", !on);
  if (testBtn) testBtn.classList.toggle("hidden", !on);
  if (hint) {
    hint.textContent = on
      ? "Sent to the Compiler API as \"engine\". Multiple passes and bibliography handling are up to that service - GitLaTeX cannot run them remotely."
      : "Local builds run the engine, then bibtex/biber when needed, then rerun until cross-references and citations resolve.";
  }
}

export function populateSettings() {
  const input = document.getElementById("settings-compiler-api");
  if (input) input.value = getStoredCompilerApi();
  const keyInput = document.getElementById("settings-compiler-api-key");
  if (keyInput) keyInput.value = getStoredCompilerApiKey();
  const engineSelect = document.getElementById("settings-engine");
  if (engineSelect) engineSelect.value = getLatexEngine();
  const useApi = document.getElementById("settings-use-api");
  if (useApi) useApi.checked = getUseCompilerApi();
  syncCompilerApiFields();
  updateSpellSettingsUi();
  loadSpellStatus();  // refreshes the personal-dictionary count
  populateSettingsTechInfo();
}

export function setInfoLink(el, url, label) {
  if (!el) return;
  if (url) {
    el.innerHTML = "";
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label || url;
    a.className = "settings-info-link";
    el.appendChild(a);
  } else {
    el.textContent = "—";
  }
}

// ----- Update check (PyPI) -----

/** Ask the server whether a newer gitlatex is on PyPI. Never throws. */
export async function checkForUpdate(force) {
  try {
    const res = await fetchApi("/api/update-check" + (force ? "?force=1" : ""));
    const data = await res.json();
    state.updateInfo = data && typeof data === "object" ? data : null;
  } catch (_) {
    state.updateInfo = null;
  }
  renderUpdateState();
  return state.updateInfo;
}

/** Dot on every Settings gear, plus the notice inside Settings itself. */
export function renderUpdateState() {
  const available = !!(state.updateInfo && state.updateInfo.updateAvailable && state.updateInfo.latest);
  document.querySelectorAll('.icon-btn[href="#/settings"]').forEach(function (el) {
    el.classList.toggle("has-update", available);
    if (available) el.title = "Settings — version " + state.updateInfo.latest + " available";
    else el.title = "Settings";
  });

  const notice = document.getElementById("update-notice");
  if (notice) {
    notice.classList.toggle("hidden", !available);
    if (available) {
      const latestEl = document.getElementById("update-notice-latest");
      const currentEl = document.getElementById("update-notice-current");
      const linkEl = document.getElementById("update-notice-link");
      if (latestEl) latestEl.textContent = state.updateInfo.latest;
      if (currentEl) currentEl.textContent = state.updateInfo.current || "—";
      if (linkEl && state.updateInfo.pypi) linkEl.href = state.updateInfo.pypi;
    }
  }

  const versionEl = document.getElementById("settings-info-version");
  if (versionEl) {
    versionEl.querySelector(".version-pill")?.remove();
    versionEl.querySelector(".version-latest")?.remove();
    if (available) {
      const el = document.createElement("span");
      el.className = "version-pill";
      el.textContent = "update available";
      versionEl.appendChild(el);
    } else if (state.updateInfo && state.updateInfo.latest && !state.updateInfo.disabled) {
      // Sits inline beside the version number rather than on its own line.
      const el = document.createElement("span");
      el.className = "version-latest";
      el.textContent = "You are on the latest version.";
      versionEl.appendChild(el);
    }
  }

  const status = document.getElementById("update-status");
  if (status) {
    // "Latest" now shows next to the version; only problems land here.
    if (!state.updateInfo || available) status.textContent = "";
    else if (state.updateInfo.disabled) status.textContent = "Update checks are disabled.";
    else if (state.updateInfo.error) status.textContent = "Could not reach PyPI to check for updates.";
    else status.textContent = "";
  }
}

export async function populateSettingsTechInfo() {
  const versionEl = document.getElementById("settings-info-version");
  const repoEl = document.getElementById("settings-info-repo");
  const pypiEl = document.getElementById("settings-info-pypi");
  try {
    const res = await fetchApi("/api/info");
    const data = await res.json().catch(() => ({}));
    if (versionEl) versionEl.textContent = data.version || "—";
    setInfoLink(repoEl, data.repository, data.repository ? data.repository.replace(/^https?:\/\//, "") : "");
    setInfoLink(pypiEl, data.pypi, "pypi.org/project/gitlatex");
  } catch (_) {
    if (versionEl) versionEl.textContent = "—";
    if (repoEl) repoEl.textContent = "—";
    if (pypiEl) pypiEl.textContent = "—";
  }
  // Re-apply first (setting version wipes the pill), then refresh from PyPI.
  renderUpdateState();
  checkForUpdate();
}
