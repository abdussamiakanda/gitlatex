/**
 * Version history panel: commit list, working tree entry and compare mode.
 */

import { state } from "../core/state.js";
import { fetchApi } from "../core/api.js";
import { clearSkeleton, showSkeleton } from "../ui/loading.js";
import { saveCurrentFile } from "../editor/session.js";
import { hideDiffView, openCommitDiff, showDiffFrom } from "./diffview.js";

// ----- Versions: commit history panel + diff viewer -----

export function monacoLanguageFor(path) {
  const p = (path || "").toLowerCase();
  if (p.endsWith(".tex") || p.endsWith(".sty") || p.endsWith(".cls")) return "latex";
  if (p.endsWith(".bib")) return "bib";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".js")) return "javascript";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".md")) return "markdown";
  return "plaintext";
}

export function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

// DD/MM/YYYY HH:MM
export function formatCommitDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || "";
  return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

// DD/MM/YYYY, for the compact compare bar.
export function formatCommitDay(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || "";
  return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
}

export function isVersionsPanelOpen() {
  const panel = document.getElementById("versions-panel");
  return !!panel && !panel.classList.contains("hidden");
}

export function toggleVersionsPanel() {
  isVersionsPanelOpen() ? closeVersionsPanel() : openVersionsPanel();
}

export function openVersionsPanel() {
  const panel = document.getElementById("versions-panel");
  const btn = document.getElementById("btn-versions");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  if (btn) { btn.classList.add("active"); btn.setAttribute("aria-pressed", "true"); }
  if (!state.versionsLoaded) loadCommits();
}

export function closeVersionsPanel() {
  const panel = document.getElementById("versions-panel");
  const btn = document.getElementById("btn-versions");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");
  if (btn) { btn.classList.remove("active"); btn.setAttribute("aria-pressed", "false"); }
}

export async function loadCommits() {
  const list = document.getElementById("versions-list");
  if (!list) return;
  // Selected hashes may not survive a reload (e.g. after a pull).
  state.compareSelection = [];
  state.compareOrderSwapped = false;
  renderCompareBar();
  loadComparison();
  showSkeleton(list, "commit-row");
  try {
    const res = await fetchApi("/commits?limit=100");
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      clearSkeleton(list);
      list.innerHTML = '<div class="versions-placeholder">Restart the GitLaTeX server to use Versions.</div>';
      return;
    }
    const data = await res.json();
    if (data.error) {
      clearSkeleton(list);
      list.innerHTML = '<div class="versions-placeholder"></div>';
      list.firstChild.textContent = data.error;
      return;
    }
    state.versionsLoaded = true;
    renderCommits(data.commits || [], data.hasMore);
  } catch (e) {
    clearSkeleton(list);
    list.innerHTML = '<div class="versions-placeholder">Could not load history.</div>';
  }
}

export function renderCommits(commits, hasMore) {
  const list = document.getElementById("versions-list");
  if (!list) return;
  clearSkeleton(list);
  list.innerHTML = "";
  renderWorkingTreeEntry(list);
  if (!commits.length) {
    const empty = document.createElement("div");
    empty.className = "versions-placeholder";
    empty.textContent = "No commits yet.";
    list.appendChild(empty);
    return;
  }
  commits.forEach(function (c) {
    const item = document.createElement("div");
    item.className = "version-item";
    item.dataset.hash = c.hash;

    const row = document.createElement("div");
    row.className = "version-row";

    const select = document.createElement("button");
    select.type = "button";
    select.className = "version-select";
    select.title = "Select for comparison";
    select.setAttribute("aria-label", "Select commit " + c.short + " for comparison");
    select.innerHTML = '<span class="material-icons" aria-hidden="true">check_box_outline_blank</span>';
    select.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleCompareSelection(c);
    });

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "version-expand";
    expand.innerHTML =
      '<span class="material-icons version-caret" aria-hidden="true">chevron_right</span>' +
      '<span class="version-info">' +
        '<span class="version-message"></span>' +
        '<span class="version-meta"></span>' +
      '</span>';
    expand.querySelector(".version-message").textContent = c.message || "(no message)";
    expand.querySelector(".version-meta").textContent =
      c.author + " · " + formatCommitDate(c.date);
    if (c.isHead) {
      const tag = document.createElement("span");
      tag.className = "version-head-tag";
      tag.textContent = "HEAD";
      expand.querySelector(".version-info").appendChild(tag);
    }

    const files = document.createElement("div");
    files.className = "version-files hidden";

    expand.addEventListener("click", function () { toggleCommit(c.hash, item, files); });
    row.appendChild(select);
    row.appendChild(expand);
    item.appendChild(row);
    item.appendChild(files);
    list.appendChild(item);
  });
  renderCompareBar();
  if (hasMore) {
    const note = document.createElement("div");
    note.className = "versions-placeholder";
    note.textContent = "Showing the 100 most recent commits.";
    list.appendChild(note);
  }
}

// Uncommitted work, shown as a pseudo-entry above the commit list.
export function renderWorkingTreeEntry(list) {
  const item = document.createElement("div");
  item.className = "version-item working-item";

  const row = document.createElement("div");
  row.className = "version-row";
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "version-expand";
  expand.innerHTML =
    '<span class="material-icons version-caret" aria-hidden="true">chevron_right</span>' +
    '<span class="version-info">' +
      '<span class="version-message">Uncommitted changes</span>' +
      '<span class="version-meta">Working tree vs last commit</span>' +
    '</span>';

  const files = document.createElement("div");
  files.className = "version-files hidden";

  expand.addEventListener("click", async function () {
    if (item.classList.contains("expanded")) {
      item.classList.remove("expanded");
      files.classList.add("hidden");
      return;
    }
    item.classList.add("expanded");
    files.classList.remove("hidden");
    showSkeleton(files, "file-row");
    try {
      if (state.currentFile) await saveCurrentFile();
      const res = await fetchApi("/working-files");
      const data = await res.json();
      if (data.error) {
        clearSkeleton(files);
        files.innerHTML = '<div class="versions-placeholder"></div>';
        files.firstChild.textContent = data.error;
        return;
      }
      clearSkeleton(files);
      files.innerHTML = "";
      if (!(data.files || []).length) {
        clearSkeleton(files);
        files.innerHTML = '<div class="versions-placeholder">Working tree clean.</div>';
        return;
      }
      renderFileList(files, data.files, function (f, btn) {
        files.querySelectorAll(".version-file").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.diffSource = "working";
        showDiffFrom("/working-file?path=" + encodeURIComponent(f.path),
          f.path, "Last commit  →  now (uncommitted)");
      });
    } catch (e) {
      clearSkeleton(files);
      files.innerHTML = '<div class="versions-placeholder">Could not load changes.</div>';
    }
  });

  row.appendChild(expand);
  item.appendChild(row);
  item.appendChild(files);
  list.appendChild(item);
}

// --- Compare two selected commits ---
// compareSelection holds up to 2 commits, kept in list order (newest first).

export function commitListOrder() {
  const list = document.getElementById("versions-list");
  if (!list) return [];
  return Array.from(list.querySelectorAll(".version-item")).map(el => el.dataset.hash);
}

export function comparePair() {
  if (state.compareSelection.length !== 2) return null;
  const order = commitListOrder();
  const pair = state.compareSelection.slice().sort(function (x, y) {
    // Newest first in the list, so the later index is the older commit.
    return order.indexOf(y.hash) - order.indexOf(x.hash);
  });
  // Default direction: older -> newer, i.e. "what changed since".
  const from = pair[0], to = pair[1];
  return state.compareOrderSwapped ? { from: to, to: from } : { from: from, to: to };
}

export function toggleCompareSelection(commit) {
  const i = state.compareSelection.findIndex(c => c.hash === commit.hash);
  if (i >= 0) {
    state.compareSelection.splice(i, 1);
  } else {
    state.compareSelection.push(commit);
    // Selecting a third drops the oldest selection.
    if (state.compareSelection.length > 2) state.compareSelection.shift();
  }
  state.compareOrderSwapped = false;
  renderCompareBar();
  loadComparison();
}

export function clearCompareSelection() {
  state.compareSelection = [];
  state.compareOrderSwapped = false;
  renderCompareBar();
  loadComparison();
  // The open diff belonged to the cleared selection.
  hideDiffView();
}

export function renderCompareBar() {
  const bar = document.getElementById("versions-compare-bar");
  const list = document.getElementById("versions-list");
  if (!bar || !list) return;

  const selected = new Set(state.compareSelection.map(c => c.hash));
  list.querySelectorAll(".version-item").forEach(function (item) {
    const on = selected.has(item.dataset.hash);
    item.classList.toggle("selected", on);
    const icon = item.querySelector(".version-select .material-icons");
    if (icon) icon.textContent = on ? "check_box" : "check_box_outline_blank";
  });

  if (!state.compareSelection.length) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  const pair = comparePair();
  const a = document.getElementById("compare-slot-a");
  const b = document.getElementById("compare-slot-b");
  if (pair) {
    if (a) { a.textContent = formatCommitDay(pair.from.date); a.title = pair.from.message || ""; }
    if (b) { b.textContent = formatCommitDay(pair.to.date); b.title = pair.to.message || ""; }
  } else {
    if (a) { a.textContent = formatCommitDay(state.compareSelection[0].date); a.title = state.compareSelection[0].message || ""; }
    if (b) { b.textContent = "Select a second"; b.title = ""; }
  }
  const swap = document.getElementById("compare-swap");
  if (swap) swap.disabled = !pair;
}

export async function loadComparison() {
  const box = document.getElementById("versions-compare-files");
  if (!box) return;
  const pair = comparePair();
  if (!pair) {
    box.classList.add("hidden");
    clearSkeleton(box);
    box.innerHTML = "";
    // Only close a diff that came from a comparison, not a single-commit one.
    if (state.diffSource === "compare") hideDiffView();
    return;
  }
  box.classList.remove("hidden");
  showSkeleton(box, "file-row");
  try {
    const res = await fetchApi("/compare-files?from=" + encodeURIComponent(pair.from.hash) +
      "&to=" + encodeURIComponent(pair.to.hash));
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      clearSkeleton(box);
      box.innerHTML = '<div class="versions-placeholder">Restart the GitLaTeX server to compare commits.</div>';
      return;
    }
    const data = await res.json();
    if (data.error) {
      clearSkeleton(box);
      box.innerHTML = '<div class="versions-placeholder"></div>';
      box.firstChild.textContent = data.error;
      return;
    }
    clearSkeleton(box);
    box.innerHTML = "";
    const head = document.createElement("div");
    head.className = "compare-files-head";
    const span = formatCommitDate(pair.from.date) + "  →  " + formatCommitDate(pair.to.date);
    head.textContent = (data.files || []).length
      ? (data.files.length + " file(s) changed · " + span)
      : "No differences · " + span;
    box.appendChild(head);
    renderFileList(box, data.files || [], function (f, btn) {
      box.querySelectorAll(".version-file").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      openCompareDiff(pair, f);
    });
  } catch (e) {
    clearSkeleton(box);
    box.innerHTML = '<div class="versions-placeholder">Could not compare commits.</div>';
  }
}

export async function openCompareDiff(pair, file) {
  state.diffSource = "compare";
  const url = "/compare-file?from=" + encodeURIComponent(pair.from.hash) +
    "&to=" + encodeURIComponent(pair.to.hash) +
    "&path=" + encodeURIComponent(file.path) +
    (file.oldPath ? "&oldPath=" + encodeURIComponent(file.oldPath) : "");
  await showDiffFrom(url, file.path,
    formatCommitDate(pair.from.date) + "  →  " + formatCommitDate(pair.to.date));
}

// Shared renderer for a list of changed files.
export function renderFileList(container, files, onSelect) {
  files.forEach(function (f) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "version-file";
    btn.innerHTML =
      '<span class="version-file-status"></span>' +
      '<span class="version-file-path"></span>' +
      '<span class="version-file-stat"></span>';
    const st = btn.querySelector(".version-file-status");
    st.textContent = f.status;
    st.classList.add("status-" + f.status);
    const pathEl = btn.querySelector(".version-file-path");
    pathEl.textContent = f.path;
    pathEl.title = f.oldPath ? f.oldPath + " -> " + f.path : f.path;
    const stat = btn.querySelector(".version-file-stat");
    if (f.insertions) {
      const a = document.createElement("span");
      a.className = "stat-add";
      a.textContent = "+" + f.insertions;
      stat.appendChild(a);
    }
    if (f.deletions) {
      const d = document.createElement("span");
      d.className = "stat-del";
      d.textContent = "-" + f.deletions;
      stat.appendChild(d);
    }
    btn.addEventListener("click", function () { onSelect(f, btn); });
    container.appendChild(btn);
  });
}

export async function toggleCommit(hash, item, filesEl) {
  const isOpen = item.classList.contains("expanded");
  if (isOpen) {
    item.classList.remove("expanded");
    filesEl.classList.add("hidden");
    return;
  }
  item.classList.add("expanded");
  filesEl.classList.remove("hidden");
  if (filesEl.dataset.loaded === "1") return;
  filesEl.innerHTML = '<div class="versions-placeholder">Loading changes...</div>';
  try {
    const res = await fetchApi("/commit-files?hash=" + encodeURIComponent(hash));
    const data = await res.json();
    if (data.error) {
      filesEl.innerHTML = '<div class="versions-placeholder"></div>';
      filesEl.firstChild.textContent = data.error;
      return;
    }
    filesEl.innerHTML = "";
    if (!(data.files || []).length) {
      filesEl.innerHTML = '<div class="versions-placeholder">No file changes.</div>';
    }
    renderFileList(filesEl, data.files || [], function (f, btn) {
      filesEl.querySelectorAll(".version-file").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      openCommitDiff(hash, f, data);
    });
    filesEl.dataset.loaded = "1";
  } catch (e) {
    filesEl.innerHTML = '<div class="versions-placeholder">Could not load changes.</div>';
  }
}
