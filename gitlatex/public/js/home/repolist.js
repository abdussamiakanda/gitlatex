/**
 * The home view: project cards, plus the create and clone dialogs.
 */

import { fetchApi, getApiBase } from "../core/api.js";
import { openEditor } from "../core/router.js";
import { setConsole } from "../ui/consolepane.js";
import { clearSkeleton, setButtonLoading, showSkeleton } from "../ui/loading.js";
import { showConfirmModal } from "../ui/modals.js";

export async function deleteRepo(name) {
  const ok = await showConfirmModal({
    message: "Delete repository \u201C" + name + "\u201D? All files and history will be removed. This cannot be undone.",
    confirmLabel: "Delete"
  });
  if (!ok) return;
  // Deleting can stall for seconds on Windows when a file is still locked, so
  // dim the row rather than leaving it looking untouched.
  const card = document.querySelector('.repo-row[data-name="' + CSS.escape(name) + '"]');
  if (card) {
    card.classList.add("repo-row-busy");
    card.setAttribute("aria-busy", "true");
  }
  try {
    const res = await fetchApi("/delete-repo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) {
      setConsole("Delete repo failed: " + data.error);
      return;
    }
    try {
      const editorRepo = decodeURIComponent((location.hash || "").replace("#/editor/", "").split("/")[0] || "");
      if (editorRepo === name) location.hash = "#/";
    } catch (_) {}
    await loadRepoList();
    setConsole("Deleted repository " + name);
  } catch (e) {
    setConsole("Delete repo failed: " + (e.message || ""));
  } finally {
    // On success the row is gone with the re-render; on failure it comes back.
    if (card && card.isConnected) {
      card.classList.remove("repo-row-busy");
      card.removeAttribute("aria-busy");
    }
  }
}

// ----- Home: repo list -----
//
// The fetched list is kept here so searching and sorting are instant and never
// hit the server again. Only renderRepoList() touches the DOM.

let allRepos = [];
let searchTerm = "";
let sortKey = "modified";   // "name" | "modified"
let sortDesc = true;        // newest / Z-A first

/** "3 days ago" for anything recent, an absolute date beyond that. */
function formatWhen(iso) {
  if (!iso) return { short: "—", full: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { short: "—", full: "" };
  const full = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return { short: "Today", full };
  if (days === 1) return { short: "Yesterday", full };
  if (days < 7) return { short: days + " days ago", full };
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return {
    short: d.toLocaleDateString(undefined,
      sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }),
    full,
  };
}

/** Name with the matched run wrapped in <mark>, built as nodes so a repo
 *  name can never inject markup. */
function highlight(name, term) {
  const frag = document.createDocumentFragment();
  const at = term ? name.toLowerCase().indexOf(term) : -1;
  if (at === -1) {
    frag.appendChild(document.createTextNode(name));
    return frag;
  }
  frag.appendChild(document.createTextNode(name.slice(0, at)));
  const mark = document.createElement("mark");
  mark.className = "repo-match";
  mark.textContent = name.slice(at, at + term.length);
  frag.appendChild(mark);
  frag.appendChild(document.createTextNode(name.slice(at + term.length)));
  return frag;
}

function matches(repo, term) {
  if (!term) return true;
  return (repo.name || "").toLowerCase().includes(term) ||
         (repo.owner || "").toLowerCase().includes(term);
}

function sortRepos(items) {
  const dir = sortDesc ? -1 : 1;
  return items.slice().sort((a, b) => {
    if (sortKey === "name") {
      return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    }
    const at = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const bt = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    return dir * (at - bt);
  });
}

function buildRow(repo) {
  const { name, hasGit, fileCount, lastModified, owner, createdAt, createdBy } = repo;
  const row = document.createElement("div");
  row.className = "repo-row";
  row.setAttribute("role", "row");
  row.dataset.name = name;   // so deleteRepo can find this row again

  // The icon sits in its own grid track so long names truncate against the
  // Type column rather than over the icon.
  const icon = document.createElement("span");
  icon.className = "material-icons repo-row-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = hasGit ? "folder_shared" : "folder";

  // The name is the focusable control; clicking anywhere else on the row is
  // handled by a delegated listener, so there is only one tab stop per row.
  const nameCell = document.createElement("div");
  nameCell.className = "repo-cell repo-cell-name";
  nameCell.setAttribute("role", "cell");
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "repo-open";
  openBtn.appendChild(highlight(name, searchTerm));
  nameCell.appendChild(openBtn);

  const typeCell = document.createElement("div");
  typeCell.className = "repo-cell repo-cell-type";
  typeCell.setAttribute("role", "cell");
  const tag = document.createElement("span");
  tag.className = "repo-type-tag " + (hasGit ? "repo-type-git" : "repo-type-local");
  tag.textContent = hasGit ? "Git" : "Local";
  tag.title = hasGit ? "Git repository" : "Local folder (no Git)";
  typeCell.appendChild(tag);

  const ownerCell = document.createElement("div");
  ownerCell.className = "repo-cell repo-cell-owner";
  ownerCell.setAttribute("role", "cell");
  ownerCell.textContent = owner || "—";
  if (owner) ownerCell.title = "Owner: " + owner;

  const when = formatWhen(lastModified);
  const modifiedCell = document.createElement("div");
  modifiedCell.className = "repo-cell repo-cell-modified";
  modifiedCell.setAttribute("role", "cell");
  modifiedCell.textContent = when.short;
  const parts = [];
  if (when.full) parts.push("Last modified " + when.full);
  if (createdAt) {
    const c = new Date(createdAt);
    if (!isNaN(c.getTime())) {
      parts.push("Created " + c.toLocaleDateString(undefined, { dateStyle: "medium" }) +
        (createdBy ? " by " + createdBy : ""));
    }
  }
  if (fileCount != null && fileCount > 0) parts.push(fileCount === 1 ? "1 file" : fileCount + " files");
  if (parts.length) modifiedCell.title = parts.join("\n");

  const actions = document.createElement("div");
  actions.className = "repo-cell repo-cell-actions";
  actions.setAttribute("role", "cell");
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "repo-delete icon-btn";
  delBtn.setAttribute("aria-label", "Delete repository " + name);
  delBtn.title = "Delete repository";
  const delIcon = document.createElement("span");
  delIcon.className = "material-icons";
  delIcon.setAttribute("aria-hidden", "true");
  delIcon.textContent = "delete";
  delBtn.appendChild(delIcon);
  delBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteRepo(name);
  });
  actions.appendChild(delBtn);

  row.append(icon, nameCell, typeCell, ownerCell, modifiedCell, actions);
  return row;
}

/** Renders `allRepos` through the current search term and sort order. */
export function renderRepoList() {
  const listEl = document.getElementById("repo-list");
  const table = document.querySelector(".repo-table");
  const emptyEl = document.getElementById("repo-list-empty");
  const noResults = document.getElementById("repo-no-results");
  const countEl = document.getElementById("repo-count");
  if (!listEl) return;

  const shown = sortRepos(allRepos.filter(r => matches(r, searchTerm)));
  listEl.innerHTML = "";
  shown.forEach(r => listEl.appendChild(buildRow(r)));

  const nothingAtAll = allRepos.length === 0;
  const searchedToNothing = !nothingAtAll && shown.length === 0;
  if (table) table.classList.toggle("hidden", nothingAtAll || searchedToNothing);
  if (emptyEl) emptyEl.classList.toggle("hidden", !nothingAtAll);
  // Nothing to search through, so the box would just be noise.
  document.querySelector(".repo-search")?.classList.toggle("hidden", nothingAtAll);
  if (noResults) {
    noResults.classList.toggle("hidden", !searchedToNothing);
    const term = document.getElementById("repo-no-results-term");
    if (term) term.textContent = '"' + searchTerm + '"';
  }
  if (countEl) {
    countEl.textContent = nothingAtAll ? ""
      : searchTerm ? shown.length + " of " + allRepos.length
      : allRepos.length + (allRepos.length === 1 ? " repository" : " repositories");
  }

  const subtitleEl = document.getElementById("home-subtitle");
  if (subtitleEl) subtitleEl.classList.toggle("hidden", !nothingAtAll);
  syncSortIndicators();
}

function syncSortIndicators() {
  document.querySelectorAll(".repo-th-sortable").forEach(th => {
    const active = th.dataset.sort === sortKey;
    th.classList.toggle("repo-th-active", active);
    th.setAttribute("aria-sort", active ? (sortDesc ? "descending" : "ascending") : "none");
    const icon = th.querySelector(".repo-sort-icon");
    if (icon) icon.textContent = active && !sortDesc ? "arrow_upward" : "arrow_downward";
  });
}

export async function loadRepoList() {
  const listEl = document.getElementById("repo-list");
  const emptyEl = document.getElementById("repo-list-empty");
  const noResults = document.getElementById("repo-no-results");
  if (!listEl) return;
  // Placeholder rows while /repos comes back. The empty states stay hidden
  // meanwhile, otherwise "No repositories yet" flashes before the real list.
  showSkeleton(listEl, "repo-row");
  if (emptyEl) emptyEl.classList.add("hidden");
  if (noResults) noResults.classList.add("hidden");
  // The subtitle is the "you have nothing yet" hint; hide it while loading so
  // it does not flash in front of a list that is about to appear.
  document.getElementById("home-subtitle")?.classList.add("hidden");
  try {
    const res = await fetchApi("/repos");
    const data = await res.json();
    const repos = Array.isArray(data.repos) ? data.repos : [];
    allRepos = repos.map(r => {
      if (typeof r === "string") {
        return { name: r, hasGit: false, fileCount: null, lastModified: null, owner: null, createdAt: null, createdBy: null };
      }
      return { ...r, hasGit: r.hasGit === true || !!(r.remoteUrl || r.owner) };
    });
    clearSkeleton(listEl);
    renderRepoList();
  } catch (e) {
    clearSkeleton(listEl);
    listEl.innerHTML = "";
    allRepos = [];
    const table = document.querySelector(".repo-table");
    if (table) table.classList.add("hidden");
    if (emptyEl) {
      const textEl = emptyEl.querySelector(".repo-list-empty-text");
      if (textEl) textEl.textContent = "Could not load repositories.";
      else emptyEl.textContent = "Could not load repositories.";
      emptyEl.classList.remove("hidden");
    }
  }
}

/** Wires search and the sortable headers. Called once at startup. */
export function initRepoListControls() {
  const search = document.getElementById("repo-search");
  const clear = document.getElementById("repo-search-clear");

  function applySearch(value) {
    searchTerm = (value || "").trim().toLowerCase();
    if (clear) clear.classList.toggle("hidden", !searchTerm);
    renderRepoList();
  }

  if (search) {
    search.addEventListener("input", () => applySearch(search.value));
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && search.value) {
        e.stopPropagation();          // don't let the modal handler see it
        search.value = "";
        applySearch("");
      }
    });
  }
  if (clear) {
    clear.addEventListener("click", () => {
      if (search) { search.value = ""; search.focus(); }
      applySearch("");
    });
  }
  document.getElementById("repo-no-results-clear")?.addEventListener("click", () => {
    if (search) { search.value = ""; search.focus(); }
    applySearch("");
  });

  document.querySelectorAll(".repo-th-sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (key === sortKey) {
        sortDesc = !sortDesc;
      } else {
        sortKey = key;
        sortDesc = key === "modified";   // dates newest-first, names A-Z
      }
      renderRepoList();
    });
  });

  // One listener for the whole list: clicking a row opens it, except when the
  // click landed on the delete button (which stops propagation itself).
  document.getElementById("repo-list")?.addEventListener("click", (e) => {
    const row = e.target.closest(".repo-row");
    if (row && row.dataset.name) openEditor(row.dataset.name);
  });

  // Show the default sort arrow straight away, not only after the first load.
  syncSortIndicators();
}

export function openCreateWorkspaceModal() {
  const modal = document.getElementById("create-workspace-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    const input = document.getElementById("new-workspace-name");
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

export function closeCreateWorkspaceModal() {
  const modal = document.getElementById("create-workspace-modal");
  if (modal) {
    document.getElementById("open-create-workspace-modal-btn")?.focus();
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

export async function createWorkspaceAndOpen() {
  const input = document.getElementById("new-workspace-name");
  const name = (input && input.value || "").trim();
  if (!name) {
    alert("Enter a folder name.");
    return;
  }
  try {
    const res = await fetchApi("/create-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const text = await res.text();
    let data = {};
    if (text.trimStart().startsWith("<")) {
      alert("Create failed: server returned an error page (status " + res.status + "). Is the backend running at " + (getApiBase() || "this origin") + "?");
      return;
    }
    try {
      data = JSON.parse(text);
    } catch (_) {
      alert("Create failed: invalid response (status " + res.status + ")");
      return;
    }
    if (data.error) {
      alert("Create failed: " + data.error);
      return;
    }
    if (input) input.value = "";
    closeCreateWorkspaceModal();
    await loadRepoList();
    openEditor(data.name || name);
  } catch (e) {
    alert("Create failed: " + (e.message || "Network error"));
  }
}

export function openCloneModal() {
  const modal = document.getElementById("clone-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    const input = document.getElementById("repoUrl");
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

export function closeCloneModal() {
  const modal = document.getElementById("clone-modal");
  if (modal) {
    document.getElementById("open-clone-modal-btn")?.focus();
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

export async function cloneRepoAndRefresh() {
  const repoUrl = document.getElementById("repoUrl");
  const url = (repoUrl && repoUrl.value || "").trim();
  if (!url) {
    alert("Enter a repository URL.");
    return;
  }
  const btn = document.getElementById("clone-repo-btn");
  try {
    setButtonLoading(btn, true, "Cloning…");
    const res = await fetchApi("/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: url })
    });
    const data = await res.json();
    if (data.error) {
      alert("Clone failed: " + data.error);
      return;
    }
    repoUrl.value = "";
    closeCloneModal();
    await loadRepoList();
    const name = url.split("/").pop().replace(".git", "");
    openEditor(name);
  } catch (e) {
    alert("Clone failed: " + (e.message || "Network error"));
  } finally {
    setButtonLoading(btn, false);
  }
}
