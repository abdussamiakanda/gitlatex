/**
 * Opening a project and moving between its files.
 */

import { state } from "../core/state.js";
import { clearProblems, refreshEditorMarkers } from "../build/problems.js";
import { fetchApi, getApiBase } from "../core/api.js";
import { isEditableFile, isViewableFile } from "../core/filetypes.js";
import { refreshEnvDecorations } from "./envcolors.js";
import { findFirstTexFile, getSidebarTreeEl, renderFileTree } from "./filetree.js";
import { refreshMainFileDropdown } from "./mainfile.js";
import { ensureMonacoReady } from "./monaco.js";
import { renderOutline } from "./outline.js";
import { refreshProjectIndex } from "./projectindex.js";
import { clearSpellMarkers, scheduleSpellCheck } from "./spell.js";
import { clearSkeleton, setPaneLoading, showSkeleton } from "../ui/loading.js";
import { hideDiffView, invalidateVersions } from "../git/diffview.js";
import { closeVersionsPanel } from "../git/versions.js";
import { setConsole } from "../ui/consolepane.js";
import { showConfirmModal } from "../ui/modals.js";
import { showEditorPane, showFileViewer, showPreviewNotAvailable } from "../ui/viewer.js";

export async function openEditorPage(repoName) {
  const decoded = decodeURIComponent(repoName);
  try {
    const res = await fetchApi("/select-repo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: decoded })
    });
    const data = await res.json();
    if (data.error) {
      setConsole("Failed to open repo: " + data.error);
      return;
    }
    // Versions and the Git menu only apply to git-backed projects.
    const isGit = data.hasGit === true;
    const toolbarGit = document.getElementById("toolbar-git");
    if (toolbarGit) toolbarGit.style.display = isGit ? "" : "none";
    const versionsBtn = document.getElementById("btn-versions");
    if (versionsBtn) versionsBtn.style.display = isGit ? "" : "none";
    if (!isGit) closeVersionsPanel();
  } catch (e) {
    setConsole("Failed to open repo: " + (e.message || "Network error"));
    return;
  }
  state.currentRepo = decoded;
  hideDiffView();
  invalidateVersions();
  clearProblems();
  refreshProjectIndex();
  // Monaco comes from a CDN, so first open can take a few seconds on a cold
  // cache. loadFile() clears this once it has a file on screen.
  setPaneLoading(document.getElementById("editor-pane"), true, "Loading editor...");
  ensureMonacoReady(() => {
    loadFiles();
  });
}

export async function loadFiles() {
  const treeEl = getSidebarTreeEl();
  if (!treeEl) return;
  showSkeleton(treeEl, "tree-row");
  try {
    const res = await fetchApi("/files");
    const files = await res.json();
    clearSkeleton(treeEl);
    // Rebuild the main-file picker before anything can return early, otherwise
    // an empty project keeps showing the previous project's .tex files.
    refreshMainFileDropdown(files || []);
    if (!files || !files.length) {
      treeEl.innerHTML = '<div class="sidebar-placeholder">Repository is empty.</div>';
      state.currentFile = null;
      showEditorPane();
      if (state.editor) {
        state.editor.setValue("");
        if (state.monacoApi) {
          const model = state.editor.getModel();
          if (model) state.monacoApi.editor.setModelLanguage(model, "latex");
        }
      }
      setConsole("");
      return;
    }
    renderFileTree(files, treeEl, "", state.currentFile, state.currentFolderPath);
    const firstTex = findFirstTexFile(files);
    if (firstTex && !state.currentFolderPath) loadFile(firstTex);
  } catch (e) {
    clearSkeleton(treeEl);
    refreshMainFileDropdown([]);
    treeEl.innerHTML = '<div class="sidebar-placeholder">Could not load files.</div>';
    setConsole("Error: " + (e.message || "Failed to load files"));
  } finally {
    // Hands the pane over: an empty or failed project stops here, otherwise
    // the loadFile() above puts its own overlay up while it fetches.
    setPaneLoading(document.getElementById("editor-pane"), false);
  }
}

export async function loadFile(path) {
  const pane = document.getElementById("editor-pane");
  // Big .tex files take long enough that the old content sitting there looks
  // like the click did nothing.
  setPaneLoading(pane, true, "Opening " + path.split("/").pop() + "...");
  try {
    state.currentFile = path;
    state.currentFolderPath = null;
    const treeEl = getSidebarTreeEl();
    if (treeEl) {
      treeEl.querySelectorAll("li.folder").forEach(li => li.classList.remove("selected"));
      treeEl.querySelectorAll("li.file").forEach(li => {
        li.classList.toggle("active", li.dataset.path === path);
      });
    }
    if (isViewableFile(path)) {
      showFileViewer(path);
      return;
    }
    if (!isEditableFile(path)) {
      showPreviewNotAvailable();
      return;
    }
    const res = await fetchApi("/file?path=" + encodeURIComponent(path));
    const data = await res.json();
    if (data.error) {
      setConsole("Error: " + data.error);
      return;
    }
    showEditorPane();
    if (state.editor) {
      state.editor.setValue(data.content || "");
      if (state.monacoApi) {
        const model = state.editor.getModel();
        if (model) {
          const lang = (path.endsWith(".tex") || path.endsWith(".sty") || path.endsWith(".cls")) ? "latex" : path.endsWith(".bib") ? "bib" : "plaintext";
          state.monacoApi.editor.setModelLanguage(model, lang);
        }
      }
    }
    renderOutline();
    refreshEditorMarkers();
    refreshEnvDecorations();
    clearSpellMarkers();
    scheduleSpellCheck(0);
    if (path.toLowerCase().endsWith(".tex")) {
      const pdfPath = path.replace(/\.tex$/i, ".pdf");
      const base = getApiBase() || "";
      const pdfUrl = base + (pdfPath.includes("/") ? "/pdf?path=" + encodeURIComponent(pdfPath) : "/pdf/" + pdfPath);
      const pdfEl = document.getElementById("pdf");
      if (pdfEl) {
        fetch(pdfUrl, { method: "HEAD" })
          .then((r) => { if (r.ok) pdfEl.src = pdfUrl; })
          .catch(() => {});
      }
    }
  } catch (e) {
    setConsole("Error loading file: " + (e.message || path));
  } finally {
    // Several paths above return early - clear the overlay from one place.
    setPaneLoading(pane, false);
  }
}

export async function saveCurrentFile() {
  if (!state.currentFile) {
    await showConfirmModal({ message: "No file selected. Please open a file first.", confirmLabel: "OK" });
    return;
  }
  if (isViewableFile(state.currentFile) || !isEditableFile(state.currentFile)) {
    setConsole("Cannot edit this file.");
    return;
  }
  const content = state.editor ? state.editor.getValue() : "";
  try {
    await fetchApi("/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: state.currentFile, content })
    });
    setConsole("Saved " + state.currentFile);
  } catch (e) {
    setConsole("Save failed: " + (e.message || ""));
  }
}
