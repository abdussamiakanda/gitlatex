/**
 * Side-by-side diff viewer built on Monaco's diff editor.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";
import { ensureMonacoReady } from "../editor/monaco.js";
import { formatCommitDate, isVersionsPanelOpen, loadCommits, monacoLanguageFor } from "./versions.js";
import { getMonacoTheme } from "../ui/theme.js";

export function ensureDiffEditor() {
  if (state.diffEditor || !state.monacoApi) return state.diffEditor;
  const host = document.getElementById("diff-editor");
  if (!host) return null;
  state.diffEditor = state.monacoApi.editor.createDiffEditor(host, {
    readOnly: true,
    originalEditable: false,
    automaticLayout: true,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
    fontSize: 13,
    minimap: { enabled: false },
    theme: getMonacoTheme()
  });
  return state.diffEditor;
}

export function showDiffMessage(text) {
  const msg = document.getElementById("diff-view-message");
  const host = document.getElementById("diff-editor");
  if (!msg || !host) return;
  if (text) {
    msg.textContent = text;
    msg.classList.remove("hidden");
    host.classList.add("hidden");
  } else {
    msg.classList.add("hidden");
    host.classList.remove("hidden");
  }
}

export async function openCommitDiff(hash, file, commitInfo) {
  state.openCommitHash = hash;
  state.diffSource = "commit";
  const url = "/commit-file?hash=" + encodeURIComponent(hash) +
    "&path=" + encodeURIComponent(file.path) +
    (file.oldPath ? "&oldPath=" + encodeURIComponent(file.oldPath) : "");
  await showDiffFrom(url, file.path,
    (commitInfo.message || "").split("\n")[0] + " · " + formatCommitDate(commitInfo.date));
}

// Loads before/after text from `url` into the side-by-side diff view.
export async function showDiffFrom(url, path, meta) {
  const pane = document.getElementById("editor-pane");
  const view = document.getElementById("diff-view");
  if (!pane || !view) return;

  pane.classList.add("diff-active");
  view.classList.remove("hidden");
  view.setAttribute("aria-hidden", "false");
  const pathEl = document.getElementById("diff-view-path");
  const metaEl = document.getElementById("diff-view-meta");
  if (pathEl) pathEl.textContent = path;
  if (metaEl) metaEl.textContent = meta || "";
  showDiffMessage("Loading diff...");

  try {
    const res = await fetchApi(url);
    const data = await res.json();
    if (data.error) {
      showDiffMessage(data.error);
      return;
    }
    if (data.binary) {
      showDiffMessage("Binary file - no text diff available.");
      return;
    }
    ensureMonacoReady(function () {
      const de = ensureDiffEditor();
      if (!de) {
        showDiffMessage("Diff view unavailable.");
        return;
      }
      showDiffMessage("");
      const lang = monacoLanguageFor(path);
      const old = de.getModel();
      if (old) {
        if (old.original) old.original.dispose();
        if (old.modified) old.modified.dispose();
      }
      de.setModel({
        original: state.monacoApi.editor.createModel(data.before || "", lang),
        modified: state.monacoApi.editor.createModel(data.after || "", lang)
      });
    });
  } catch (e) {
    showDiffMessage("Could not load diff: " + (e.message || "network error"));
  }
}

// History changed (push/pull/repo switch) - reload now if visible, else on next open.
export function invalidateVersions() {
  state.versionsLoaded = false;
  if (isVersionsPanelOpen()) loadCommits();
}

export function hideDiffView() {
  const pane = document.getElementById("editor-pane");
  const view = document.getElementById("diff-view");
  if (pane) pane.classList.remove("diff-active");
  if (view) {
    view.classList.add("hidden");
    view.setAttribute("aria-hidden", "true");
  }
  state.openCommitHash = null;
  state.diffSource = null;
}
