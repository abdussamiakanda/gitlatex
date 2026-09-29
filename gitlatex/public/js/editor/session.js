/**
 * Opening a project and moving between its files.
 */

import { state } from "../core/state.js";
import { clearProblems, refreshEditorMarkers } from "../build/problems.js";
import { fetchApi } from "../core/api.js";
import { isEditableFile, isViewableFile } from "../core/filetypes.js";
import { refreshEnvDecorations } from "./envcolors.js";
import { findFirstTexFile, getSidebarTreeEl, renderFileTree } from "./filetree.js";
import { collectTexFiles, getMainFile, refreshMainFileDropdown } from "./mainfile.js";
import { ensureMonacoReady } from "./monaco.js";
import { renderOutline } from "./outline.js";
import { loadReviewForFile, resetReview } from "./review.js";
import { refreshProjectIndex } from "./projectindex.js";
import { clearSpellMarkers, scheduleSpellCheck } from "./spell.js";
import { clearSkeleton, setPaneLoading, showSkeleton } from "../ui/loading.js";
import { hideDiffView, invalidateVersions } from "../git/diffview.js";
import { closeVersionsPanel } from "../git/versions.js";
import { setConsole } from "../ui/consolepane.js";
import { showConfirmModal } from "../ui/modals.js";
import { clearPdf, getPdfPath, pdfUrlFor, setPdfChoices, showPdf } from "../ui/pdfviewer.js";
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
  // Nothing from the previous project may carry over: its open file would
  // stop loadFiles() opening this one's, and its PDF would linger or pass as
  // "already shown" when both projects have a main.pdf.
  state.currentFile = null;
  state.currentFolderPath = null;
  clearPdf();
  resetReview();
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
      loadReviewForFile(null);
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
    const allFiles = collectFiles(files, "");
    const pdfs = allFiles.filter((p) => p.toLowerCase().endsWith(".pdf"));
    // What the empty PDF viewer offers when the main file has no PDF yet.
    setPdfChoices(pdfs, openPdf);
    // A refresh after a create, move or delete keeps the open file. Otherwise
    // start on the main file (set by refreshMainFileDropdown above), so its PDF
    // is what the viewer opens with.
    const hasOpenFile = state.currentFile && allFiles.includes(state.currentFile);
    if (!hasOpenFile && !state.currentFolderPath) {
      const mainFile = getMainFile();
      const startFile = collectTexFiles(files, "").includes(mainFile) ? mainFile : findFirstTexFile(files);
      if (startFile) loadFile(startFile);
      // No .tex to build from: a lone PDF is the obvious thing to show.
      else if (pdfs.length === 1 && !getPdfPath()) openPdf(pdfs[0]);
    }
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

/** Repo-relative paths of every file in a /files tree. */
function collectFiles(nodes, basePath) {
  const out = [];
  for (const node of nodes || []) {
    const fullPath = basePath ? basePath + "/" + node.name : node.name;
    if (node.type === "file") out.push(fullPath);
    else if (node.type === "folder") out.push(...collectFiles(node.children, fullPath));
  }
  return out;
}

/** Shows a project PDF in the PDF viewer; PDFs never open in the editor. */
export function openPdf(path) {
  if (getPdfPath() === path) return;
  showPdf(pdfUrlFor(path) + (path.includes("/") ? "&" : "?") + "t=" + Date.now(), path);
}

export async function loadFile(path) {
  if (path.toLowerCase().endsWith(".pdf")) {
    openPdf(path);
    return;
  }
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
      loadReviewForFile(null);
      showFileViewer(path);
      return;
    }
    if (!isEditableFile(path)) {
      loadReviewForFile(null);
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
    loadReviewForFile(path);
    renderOutline();
    refreshEditorMarkers();
    refreshEnvDecorations();
    clearSpellMarkers();
    scheduleSpellCheck(0);
    if (path.toLowerCase().endsWith(".tex")) showMatchingPdf(path);
  } catch (e) {
    setConsole("Error loading file: " + (e.message || path));
  } finally {
    // Several paths above return early - clear the overlay from one place.
    setPaneLoading(pane, false);
  }
}

/**
 * Shows the PDF built from texPath, or failing that the main file's PDF, so a
 * chapter opens next to the document it belongs to. Leaves the viewer alone
 * when neither exists.
 */
async function showMatchingPdf(texPath) {
  const candidates = [texPath, getMainFile()]
    .filter(Boolean)
    .map((p) => p.replace(/\.tex$/i, ".pdf"));
  for (const pdfPath of candidates) {
    // Already showing it (e.g. a jump from the PDF back into this file).
    if (getPdfPath() === pdfPath) return;
    const pdfUrl = pdfUrlFor(pdfPath);
    try {
      const r = await fetch(pdfUrl, { method: "HEAD" });
      if (r.ok) {
        showPdf(pdfUrl, pdfPath);
        return;
      }
    } catch (_) {}
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
