/**
 * GitLaTeX entry point.
 *
 * This file only wires the page up: it imports behaviour from js/ and binds it
 * to the DOM. Nothing here should contain application logic - if you find
 * yourself writing more than an event binding, it belongs in a module under
 * js/. See the "Project layout" section of README.md for what lives where.
 */

import { state } from "./js/core/state.js";
import { clearProblems, showCompileErrors } from "./js/build/problems.js";
import { compile } from "./js/build/compile.js";
import { route } from "./js/core/router.js";
import { setCompilerApi, setCompilerApiKey, setLatexEngine, setUseCompilerApi } from "./js/core/storage.js";
import { addNewFileSidebar, addNewFolderSidebar, handleSidebarFileInputChange, uploadFilesSidebar } from "./js/editor/filetree.js";
import { populateMainFileDropdown } from "./js/editor/mainfile.js";
import { toggleOutlineSection } from "./js/editor/outline.js";
import { setSpellCheckEnabled } from "./js/editor/spell.js";
import { hideDiffView } from "./js/git/diffview.js";
import { closeGitDropdown, toggleGitDropdown } from "./js/git/menu.js";
import { pullChanges, pushChanges, showDiff, showStatus } from "./js/git/actions.js";
import { clearCompareSelection, closeVersionsPanel, loadCommits, loadComparison, renderCompareBar, toggleVersionsPanel } from "./js/git/versions.js";
import { cloneRepoAndRefresh, closeCloneModal, closeCreateWorkspaceModal, createWorkspaceAndOpen, initRepoListControls, openCloneModal, openCreateWorkspaceModal } from "./js/home/repolist.js";
import { showConsoleTab } from "./js/ui/consolepane.js";
import { setupResizers, toggleSidebar } from "./js/ui/layout.js";
import { checkForUpdate, syncCompilerApiFields } from "./js/ui/settings.js";
import { getStoredTheme, setTheme } from "./js/ui/theme.js";

// ----- Declarative buttons -----
// Markup opts in with data-action="name"; one delegated listener dispatches.
// To add a button, add an entry here and the attribute in index.html - no id
// and no second listener needed. Disabled buttons never fire, as before.
const ACTIONS = {
  "close-create-workspace": closeCreateWorkspaceModal,
  "close-clone": closeCloneModal,
  "clone-repo": cloneRepoAndRefresh,
  "toggle-sidebar": toggleSidebar,
  "compile": compile,
  "show-errors": showCompileErrors,
  "toggle-versions": toggleVersionsPanel,
  "git-status": () => { showStatus(); closeGitDropdown(); },
  "git-diff": () => { showDiff(); closeGitDropdown(); },
  "git-push": () => { pushChanges(); closeGitDropdown(); },
  "git-pull": () => { pullChanges(); closeGitDropdown(); },
};

document.addEventListener("click", function (e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = ACTIONS[el.dataset.action];
  if (action) action(el, e);
});

// ----- Init -----
document.documentElement.setAttribute("data-theme", getStoredTheme());
populateMainFileDropdown();
initRepoListControls();
document.getElementById("versions-close")?.addEventListener("click", closeVersionsPanel);
document.getElementById("versions-refresh")?.addEventListener("click", loadCommits);
document.getElementById("diff-view-close")?.addEventListener("click", hideDiffView);
document.getElementById("compare-clear")?.addEventListener("click", clearCompareSelection);
document.getElementById("outline-header")?.addEventListener("click", toggleOutlineSection);
document.querySelectorAll(".console-tab-btn").forEach(function (btn) {
  btn.addEventListener("click", function () { showConsoleTab(btn.dataset.panel); });
});
document.getElementById("console-clear")?.addEventListener("click", clearProblems);
document.getElementById("settings-engine")?.addEventListener("change", function () {
  setLatexEngine(this.value);
});
document.getElementById("settings-use-api")?.addEventListener("change", function () {
  setUseCompilerApi(this.checked);
  syncCompilerApiFields();
});
document.getElementById("settings-spellcheck")?.addEventListener("change", function () {
  setSpellCheckEnabled(this.checked);
});
document.getElementById("compare-swap")?.addEventListener("click", function () {
  state.compareOrderSwapped = !state.compareOrderSwapped;
  renderCompareBar();
  loadComparison();
});

document.addEventListener("click", function (e) {
  const opt = e.target.closest(".theme-option");
  if (opt) {
    const theme = opt.getAttribute("data-theme");
    if (theme) setTheme(theme);
  }
});

// Copy buttons on the Compiler API docs code samples
document.addEventListener("click", function (e) {
  const btn = e.target.closest(".docs-copy");
  if (!btn) return;
  const code = btn.parentElement && btn.parentElement.querySelector("code");
  if (!code || !navigator.clipboard) return;
  navigator.clipboard.writeText(code.textContent).then(function () {
    btn.textContent = "Copied";
    btn.classList.add("copied");
    setTimeout(function () {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
    }, 1500);
  }).catch(function () {
    btn.textContent = "Press Ctrl+C";
    setTimeout(function () { btn.textContent = "Copy"; }, 1500);
  });
});

document.getElementById("settings-save")?.addEventListener("click", function () {
  const apiInput = document.getElementById("settings-compiler-api");
  const keyInput = document.getElementById("settings-compiler-api-key");
  const status = document.getElementById("settings-save-status");
  const engineSelect = document.getElementById("settings-engine");
  const useApi = document.getElementById("settings-use-api");
  if (apiInput) setCompilerApi(apiInput.value);
  if (keyInput) setCompilerApiKey(keyInput.value);
  if (engineSelect) setLatexEngine(engineSelect.value);
  if (useApi) setUseCompilerApi(useApi.checked);
  if (status) {
    status.textContent = "Saved";
    status.className = "settings-save-status success";
    setTimeout(function () { status.textContent = ""; status.className = "settings-save-status"; }, 2000);
  }
});

document.getElementById("settings-test-api")?.addEventListener("click", async function () {
  const btn = this;
  const status = document.getElementById("settings-save-status");
  const apiInput = document.getElementById("settings-compiler-api");
  const keyInput = document.getElementById("settings-compiler-api-key");
  const url = (apiInput && apiInput.value.trim()) ? apiInput.value.trim() : "";
  const key = (keyInput && keyInput.value.trim()) ? keyInput.value.trim() : "";

  if (!url) {
    if (status) { status.textContent = "Enter a compiler API URL first"; status.className = "settings-save-status error"; }
    return;
  }

  btn.disabled = true;
  btn.textContent = "Testing…";
  if (status) { status.textContent = "Testing…"; status.className = "settings-save-status"; }

  try {
    const headers = { "Content-Type": "application/json" };
    if (key) headers["Authorization"] = "Bearer " + key;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ main: "test.tex", files: [{ path: "test.tex", content: "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}" }] })
    });
    const data = await res.json().catch(function () { return {}; });
    if (res.ok && data.success) {
      if (status) { status.textContent = "API works! PDF returned."; status.className = "settings-save-status success"; }
    } else {
      if (status) { status.textContent = "API error: " + (data.error || res.statusText || res.status); status.className = "settings-save-status error"; }
    }
  } catch (e) {
    if (status) { status.textContent = "Connection failed: " + (e.message || "network error"); status.className = "settings-save-status error"; }
  } finally {
    btn.disabled = false;
    btn.textContent = "Test";
  }
});

document.getElementById("open-create-workspace-modal-btn")?.addEventListener("click", openCreateWorkspaceModal);
document.getElementById("create-workspace-submit")?.addEventListener("click", createWorkspaceAndOpen);
document.getElementById("new-workspace-name")?.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    createWorkspaceAndOpen();
  }
});
document.getElementById("open-clone-modal-btn")?.addEventListener("click", openCloneModal);

document.getElementById("sidebar-new-file")?.addEventListener("click", addNewFileSidebar);
document.getElementById("sidebar-new-folder")?.addEventListener("click", addNewFolderSidebar);
document.getElementById("sidebar-upload")?.addEventListener("click", uploadFilesSidebar);
document.getElementById("sidebar-file-input")?.addEventListener("change", handleSidebarFileInputChange);

document.getElementById("create-workspace-modal")?.addEventListener("click", function (e) {
  if (e.target === this) closeCreateWorkspaceModal();
});
document.getElementById("clone-modal")?.addEventListener("click", function (e) {
  if (e.target === this) closeCloneModal();
});

document.getElementById("git-dropdown-btn")?.addEventListener("click", toggleGitDropdown);
document.addEventListener("click", function (e) {
  if (!e.target.closest(".toolbar-git.git-dropdown")) closeGitDropdown();
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    const gitWrapper = document.getElementById("toolbar-git");
    if (gitWrapper && gitWrapper.classList.contains("open")) {
      closeGitDropdown();
      return;
    }
    const createModal = document.getElementById("create-workspace-modal");
    if (createModal && !createModal.classList.contains("hidden")) closeCreateWorkspaceModal();
    else {
      const modal = document.getElementById("clone-modal");
      if (modal && !modal.classList.contains("hidden")) closeCloneModal();
    }
  }
});

window.addEventListener("hashchange", route);
window.addEventListener("load", function () {
  route();
  setupResizers();
  checkForUpdate();
});
