const THEME_KEY = "gitlatex-theme";
// localStorage keys for user settings (Compiler API URL and optional API key)
const STORAGE_COMPILER_API_URL = "gitlatex-compiler-api";
const STORAGE_COMPILER_API_KEY = "gitlatex-compiler-api-key";

/** API base URL: "" = same origin (API on same host:port as page). Fallback only for file:// or no origin. */
function getApiBase() {
  if (typeof window === "undefined" || !window.location) return "http://localhost:5000";
  const o = window.location.origin;
  if (!o || o.startsWith("file")) return "http://localhost:5000";
  return "";
}
const API_BASE = getApiBase();

const VIEWABLE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];
function isViewableFile(path) {
  if (!path) return false;
  return VIEWABLE_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));
}

const EDITABLE_EXTENSIONS = [".tex", ".bib", ".txt", ".md", ".sty", ".cls", ".dtx", ".ins", ".json", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".csv", ".log", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".sh", ".bat", ".py", ".r", ".rmd"];
/** Extensions that must never open in editor (binary / vector art), even if they might match an editable suffix (e.g. .eps ends with .ps) */
const NON_EDITABLE_EXTENSIONS = [".eps", ".ps"];
function isEditableFile(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  if (NON_EDITABLE_EXTENSIONS.some(ext => lower.endsWith(ext))) return false;
  return EDITABLE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function showEditorPane() {
  const pane = document.getElementById("editor-pane");
  const viewer = document.getElementById("file-viewer");
  hideDiffView();
  if (pane) pane.classList.remove("viewer-active");
  if (viewer) viewer.classList.add("hidden");
  if (viewer) viewer.setAttribute("aria-hidden", "true");
}

function showFileViewer(path) {
  const pane = document.getElementById("editor-pane");
  const viewer = document.getElementById("file-viewer");
  const img = document.getElementById("file-viewer-img");
  const pdfFrame = document.getElementById("file-viewer-pdf");
  const unavailable = document.getElementById("file-viewer-unavailable");
  if (!pane || !viewer || !img || !pdfFrame || !unavailable) return;
  hideDiffView();
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));
  const isPdf = ext === ".pdf";
  const url = (typeof API_BASE !== "undefined" ? API_BASE : "") + "/file-raw?path=" + encodeURIComponent(path);
  pane.classList.add("viewer-active");
  viewer.classList.remove("hidden");
  viewer.setAttribute("aria-hidden", "false");
  unavailable.classList.add("hidden");
  if (isPdf) {
    img.classList.add("hidden");
    pdfFrame.classList.remove("hidden");
    pdfFrame.src = url;
  } else {
    pdfFrame.classList.add("hidden");
    pdfFrame.removeAttribute("src");
    img.classList.remove("hidden");
    img.src = url;
  }
}

function showPreviewNotAvailable() {
  const pane = document.getElementById("editor-pane");
  const viewer = document.getElementById("file-viewer");
  const img = document.getElementById("file-viewer-img");
  const pdfFrame = document.getElementById("file-viewer-pdf");
  const unavailable = document.getElementById("file-viewer-unavailable");
  if (!pane || !viewer || !img || !pdfFrame || !unavailable) return;
  pane.classList.add("viewer-active");
  viewer.classList.remove("hidden");
  viewer.setAttribute("aria-hidden", "false");
  img.classList.add("hidden");
  img.removeAttribute("src");
  pdfFrame.classList.add("hidden");
  pdfFrame.removeAttribute("src");
  unavailable.classList.remove("hidden");
}

let editor = null;
let currentFile = null;
let currentFolderPath = null;
let currentRepo = null;
const collapsedFolderPaths = new Set();
let monacoReady = false;
let monacoReadyCallbacks = [];
let monacoApi = null;

function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch (_) {}
  return "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll(".theme-option").forEach(btn => {
    const value = btn.getAttribute("data-theme");
    btn.setAttribute("aria-pressed", value === theme ? "true" : "false");
    btn.classList.toggle("active", value === theme);
  });
}

function getMonacoTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "gitlatex-light" : "gitlatex-dark";
}

function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {}
  applyTheme(theme);
  if (monacoApi) {
    // Global for all Monaco instances, including the versions diff editor.
    monacoApi.editor.setTheme(getMonacoTheme());
  }
}

/** Ensure compiler API URL is absolute (avoid fetch relative to current origin). */
function normalizeCompilerApiUrl(url) {
  if (!url || !url.trim()) return "";
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return "https://" + u;
}

function getStoredCompilerApi() {
  try {
    const u = localStorage.getItem(STORAGE_COMPILER_API_URL);
    return (u && u.trim()) ? u.trim() : "";
  } catch (_) {}
  return "";
}

function setCompilerApi(url) {
  try {
    if (url && url.trim()) localStorage.setItem(STORAGE_COMPILER_API_URL, url.trim());
    else localStorage.removeItem(STORAGE_COMPILER_API_URL);
  } catch (_) {}
}

function getStoredCompilerApiKey() {
  try {
    const k = localStorage.getItem(STORAGE_COMPILER_API_KEY);
    return (k && k.trim()) ? k.trim() : "";
  } catch (_) {}
  return "";
}

function setCompilerApiKey(key) {
  try {
    if (key && key.trim()) localStorage.setItem(STORAGE_COMPILER_API_KEY, key.trim());
    else localStorage.removeItem(STORAGE_COMPILER_API_KEY);
  } catch (_) {}
}

// Shows/hides the API inputs and explains what the engine applies to.
function syncCompilerApiFields() {
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

function populateSettings() {
  const input = document.getElementById("settings-compiler-api");
  if (input) input.value = getStoredCompilerApi();
  const keyInput = document.getElementById("settings-compiler-api-key");
  if (keyInput) keyInput.value = getStoredCompilerApiKey();
  const engineSelect = document.getElementById("settings-engine");
  if (engineSelect) engineSelect.value = getLatexEngine();
  const useApi = document.getElementById("settings-use-api");
  if (useApi) useApi.checked = getUseCompilerApi();
  syncCompilerApiFields();
  populateSettingsTechInfo();
}

function setInfoLink(el, url, label) {
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
let updateInfo = null;

/** Ask the server whether a newer gitlatex is on PyPI. Never throws. */
async function checkForUpdate(force) {
  try {
    const res = await fetchApi("/api/update-check" + (force ? "?force=1" : ""));
    const data = await res.json();
    updateInfo = data && typeof data === "object" ? data : null;
  } catch (_) {
    updateInfo = null;
  }
  renderUpdateState();
  return updateInfo;
}

/** Dot on every Settings gear, plus the notice inside Settings itself. */
function renderUpdateState() {
  const available = !!(updateInfo && updateInfo.updateAvailable && updateInfo.latest);
  document.querySelectorAll('.icon-btn[href="#/settings"]').forEach(function (el) {
    el.classList.toggle("has-update", available);
    if (available) el.title = "Settings — version " + updateInfo.latest + " available";
    else el.title = "Settings";
  });

  const notice = document.getElementById("update-notice");
  if (notice) {
    notice.classList.toggle("hidden", !available);
    if (available) {
      const latestEl = document.getElementById("update-notice-latest");
      const currentEl = document.getElementById("update-notice-current");
      const linkEl = document.getElementById("update-notice-link");
      if (latestEl) latestEl.textContent = updateInfo.latest;
      if (currentEl) currentEl.textContent = updateInfo.current || "—";
      if (linkEl && updateInfo.pypi) linkEl.href = updateInfo.pypi;
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
    } else if (updateInfo && updateInfo.latest && !updateInfo.disabled) {
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
    if (!updateInfo || available) status.textContent = "";
    else if (updateInfo.disabled) status.textContent = "Update checks are disabled.";
    else if (updateInfo.error) status.textContent = "Could not reach PyPI to check for updates.";
    else status.textContent = "";
  }
}

async function populateSettingsTechInfo() {
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

function setConsole(text) {
  const el = document.getElementById("console");
  if (!el) return;
  el.textContent = text || "";
  // Anything writing plain text belongs in Output.
  showConsoleTab("output");
}

function showConsoleTab(panel) {
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

function setProblemsBadge(problems) {
  const badge = document.getElementById("problems-badge");
  if (!badge) return;
  const count = (problems || []).length;
  const errors = (problems || []).filter(p => p.severity === "error").length;
  badge.textContent = String(count);
  badge.classList.toggle("hidden", count === 0);
  badge.classList.toggle("has-errors", errors > 0);
}

/** Same as fetch but URL is relative to API base. Normalizes to avoid double slashes. Uses current getApiBase() so settings apply. */
function fetchApi(url, options) {
  const base = getApiBase() || "";
  const path = (url || "").replace(/^\//, "");
  const fullUrl = base ? (base.replace(/\/$/, "") + "/" + path) : "/" + path;
  return fetch(fullUrl, options);
}

/** Fetch and parse JSON; on HTML or invalid JSON return { error: message }. */
async function fetchJson(url, options) {
  const res = await fetchApi(url, options);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    const hint = (typeof API_BASE !== "undefined" && API_BASE) ? API_BASE : (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "http://localhost:5000";
    return { error: "Server returned an error page (status " + res.status + "). Is the backend running at " + (hint || "http://localhost:5000") + "?" };
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: "Invalid response (status " + res.status + "): " + (text.slice(0, 80) + (text.length > 80 ? "…" : "")) };
  }
}

// ----- Modals (input & confirm) -----
function showInputModal(options) {
  const {
    title = "Input",
    label = "Value",
    placeholder = "",
    submitLabel = "Submit",
    defaultValue = ""
  } = options || {};
  const overlay = document.getElementById("input-modal");
  const titleEl = document.getElementById("input-modal-title");
  const labelEl = document.getElementById("input-modal-label");
  const field = document.getElementById("input-modal-field");
  const submitBtn = document.getElementById("input-modal-submit");
  const cancelBtn = document.getElementById("input-modal-cancel");
  const cancelX = document.getElementById("input-modal-cancel-btn");
  if (!overlay || !field) return Promise.resolve(null);
  titleEl.textContent = title;
  labelEl.textContent = label;
  field.placeholder = placeholder;
  field.value = defaultValue;
  submitBtn.textContent = submitLabel;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  field.focus();
  return new Promise((resolve) => {
    function finish(value) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
      overlay.removeEventListener("click", clickOut);
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    }
    function clickOut(e) {
      if (e.target === overlay) finish(null);
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", clickOut);
    submitBtn.onclick = () => {
      const v = field.value.trim();
      finish(v || null);
    };
    cancelBtn.onclick = () => finish(null);
    cancelX.onclick = () => finish(null);
  });
}

function showConfirmModal(options) {
  const { message = "Are you sure?", confirmLabel = "Confirm" } = options || {};
  const overlay = document.getElementById("confirm-modal");
  const titleEl = document.getElementById("confirm-modal-title");
  const messageEl = document.getElementById("confirm-modal-message");
  const okBtn = document.getElementById("confirm-modal-ok");
  const cancelBtn = document.getElementById("confirm-modal-cancel");
  const closeBtn = document.getElementById("confirm-modal-close-btn");
  if (!overlay || !messageEl) return Promise.resolve(false);
  messageEl.textContent = message;
  okBtn.textContent = confirmLabel;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  return new Promise((resolve) => {
    function finish(ok) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
      overlay.removeEventListener("click", clickOut);
      resolve(ok);
    }
    function onKey(e) {
      if (e.key === "Escape") finish(false);
    }
    function clickOut(e) {
      if (e.target === overlay) finish(false);
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", clickOut);
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    closeBtn.onclick = () => finish(false);
  });
}

// ----- Routing -----
function getRoute() {
  const hash = (window.location.hash || "#/").slice(1);
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "editor" && parts[1]) return { page: "editor", repo: parts[1] };
  if (parts[0] === "settings") return { page: "settings" };
  if (parts[0] === "compiler-api") return { page: "compiler-api" };
  return { page: "home" };
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("hidden", v.id !== viewId);
  });
}

function route() {
  const r = getRoute();
  if (r.page === "home") {
    showView("home-view");
    loadRepoList();
    return;
  }
  if (r.page === "settings") {
    showView("settings-view");
    applyTheme(getStoredTheme());
    populateSettings();
    return;
  }
  if (r.page === "compiler-api") {
    showView("compiler-api-view");
    const content = document.querySelector("#compiler-api-view .settings-content");
    if (content) content.scrollTop = 0;
    return;
  }
  showView("editor-view");
  document.getElementById("editor-repo-name").textContent = decodeURIComponent(r.repo);
  openEditorPage(r.repo);
}

function openEditor(repoName) {
  window.location.hash = "#/editor/" + encodeURIComponent(repoName);
}

async function deleteRepo(name) {
  const ok = await showConfirmModal({
    message: "Delete repository \u201C" + name + "\u201D? All files and history will be removed. This cannot be undone.",
    confirmLabel: "Delete"
  });
  if (!ok) return;
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
  }
}

// ----- Home: repo list -----
async function loadRepoList() {
  const listEl = document.getElementById("repo-list");
  const emptyEl = document.getElementById("repo-list-empty");
  if (!listEl) return;
  try {
    const res = await fetchApi("/repos");
    const data = await res.json();
    const repos = Array.isArray(data.repos) ? data.repos : [];
    const items = repos.map(r => {
      if (typeof r === "string") return { name: r, hasGit: false, fileCount: null, lastModified: null, owner: null, createdAt: null, createdBy: null };
      const hasGit = r.hasGit === true || !!(r.remoteUrl || r.owner);
      return { ...r, hasGit };
    });
    listEl.innerHTML = "";
    items.forEach(({ name, hasGit, fileCount, lastModified, owner, createdAt, createdBy }) => {
      const card = document.createElement("div");
      card.className = "repo-card";
      const cardInner = document.createElement("button");
      cardInner.type = "button";
      cardInner.className = "repo-card-inner";
      const title = document.createElement("span");
      title.className = "repo-card-title";
      title.textContent = name;
      cardInner.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "repo-card-meta";
      const typeBadge = document.createElement("span");
      typeBadge.className = "repo-card-type repo-card-type-tag" + (hasGit ? " repo-card-type-git" : " repo-card-type-local");
      typeBadge.setAttribute("aria-label", hasGit ? "Git repository" : "Local folder");
      typeBadge.title = hasGit ? "Git repository" : "Local folder";
      typeBadge.textContent = hasGit ? "Git" : "Local";
      meta.appendChild(typeBadge);
      function addMetaItem(icon, text, title) {
        const item = document.createElement("span");
        item.className = "repo-meta-item";
        if (title) item.setAttribute("title", title);
        item.innerHTML = "<span class=\"material-icons repo-meta-icon\" aria-hidden=\"true\">" + icon + "</span><span>" + text + "</span>";
        meta.appendChild(item);
      }
      if (owner) addMetaItem("person", owner, "Owner");
      if (createdAt) {
        const createdDate = new Date(createdAt);
        if (!isNaN(createdDate.getTime())) {
          const short = createdDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          addMetaItem("event", short, createdBy ? "Created " + short + " by " + createdBy : "Created " + short);
        }
      }
      if (lastModified) {
        const modifiedDate = new Date(lastModified);
        if (!isNaN(modifiedDate.getTime())) {
          const createdDate = createdAt ? new Date(createdAt) : null;
          const created = createdDate && !isNaN(createdDate.getTime()) ? createdDate.getTime() : 0;
          if (modifiedDate.getTime() >= created) {
            const short = modifiedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
            addMetaItem("update", short, "Updated " + short);
          }
        }
      }
      if (fileCount != null && fileCount > 0) addMetaItem("folder", fileCount === 1 ? "1 file" : fileCount + " files", null);
      if (meta.children.length) cardInner.appendChild(meta);
      cardInner.addEventListener("click", () => openEditor(name));
      card.appendChild(cardInner);
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "repo-card-delete icon-btn";
      delBtn.setAttribute("aria-label", "Delete repository " + name);
      delBtn.title = "Delete repository";
      delBtn.innerHTML = "<span class=\"material-icons\" aria-hidden=\"true\">delete</span>";
      delBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteRepo(name);
      });
      card.appendChild(delBtn);
      listEl.appendChild(card);
    });
    if (emptyEl) emptyEl.classList.toggle("hidden", items.length > 0);
    const subtitleEl = document.getElementById("home-subtitle");
    if (subtitleEl) subtitleEl.classList.toggle("hidden", items.length > 0);
  } catch (e) {
    listEl.innerHTML = "";
    if (emptyEl) {
      const textEl = emptyEl.querySelector(".repo-list-empty-text");
      if (textEl) textEl.textContent = "Could not load repositories.";
      else emptyEl.textContent = "Could not load repositories.";
      emptyEl.classList.remove("hidden");
    }
  }
}

function openCreateWorkspaceModal() {
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

function closeCreateWorkspaceModal() {
  const modal = document.getElementById("create-workspace-modal");
  if (modal) {
    document.getElementById("open-create-workspace-modal-btn")?.focus();
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function createWorkspaceAndOpen() {
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

function openCloneModal() {
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

function closeCloneModal() {
  const modal = document.getElementById("clone-modal");
  if (modal) {
    document.getElementById("open-clone-modal-btn")?.focus();
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function cloneRepoAndRefresh() {
  const repoUrl = document.getElementById("repoUrl");
  const url = (repoUrl && repoUrl.value || "").trim();
  if (!url) {
    alert("Enter a repository URL.");
    return;
  }
  const btn = document.getElementById("clone-repo-btn");
  const textEl = btn && btn.querySelector(".clone-btn-text");
  const originalText = textEl ? textEl.textContent : "Clone";
  try {
    if (btn) {
      btn.disabled = true;
      btn.classList.add("loading");
      if (textEl) textEl.textContent = "Cloning…";
    }
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
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("loading");
      if (textEl) textEl.textContent = originalText;
    }
  }
}

// ----- Editor page: init Monaco when needed -----
function ensureMonacoReady(callback) {
  if (monacoReady && editor) {
    callback();
    return;
  }
  monacoReadyCallbacks.push(callback);
  if (monacoReadyCallbacks.length > 1) return;
  require.config({ paths: { vs: "https://unpkg.com/monaco-editor@latest/min/vs" } });
  require(["vs/editor/editor.main"], function () {
    monacoApi = monaco;
    // Register LaTeX so completion provider and options apply
    monaco.languages.register({ id: "latex" });
    monaco.languages.setLanguageConfiguration("latex", {
      wordPattern: /\\[a-zA-Z*]*/,
      brackets: [["{", "}"], ["[", "]"], ["\\begin{", "\\end{"], ["\\left(", "\\right)"], ["\\left[", "\\right]"], ["\\left\\{", "\\right\\}"]],
      autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: "$", close: "$" }]
    });
    monaco.languages.setMonarchTokensProvider("latex", {
      tokenizer: {
        root: [
          [/%[^\n]*/, "comment"],
          // Split so the environment name can be coloured separately from
          // the \begin / \end command itself.
          [/(\\begin)(\s*\{)([^}]*)(\})/,
            ["keyword.env", "delimiter.bracket", "type.env", "delimiter.bracket"]],
          [/(\\end)(\s*\{)([^}]*)(\})/,
            ["keyword.env", "delimiter.bracket", "type.env", "delimiter.bracket"]],
          // Cross-references and citations: highlight the key, not just the command.
          [/(\\(?:label))(\s*\{)([^}]*)(\})/,
            ["keyword", "delimiter.bracket", "string.label", "delimiter.bracket"]],
          [/(\\(?:[a-zA-Z]*ref|cite[a-zA-Z]*)\*?)(\s*(?:\[[^\]]*\])?\s*\{)([^}]*)(\})/,
            ["keyword", "delimiter.bracket", "string.ref", "delimiter.bracket"]],
          [/(\\(?:usepackage|documentclass|include|input|bibliography|bibliographystyle))(\s*(?:\[[^\]]*\])?\s*\{)([^}]*)(\})/,
            ["keyword.strong", "delimiter.bracket", "string.package", "delimiter.bracket"]],
          [/\\(usepackage|documentclass|include|input|bibliography|bibliographystyle|usepackage)(\{[^}]*\})?/, "keyword"],
          [/\\(section|subsection|subsubsection|chapter|paragraph|subparagraph|part)\*?/, "keyword.strong"],
          [/\\(textbf|textit|texttt|textsf|textsc|emph|underline|textmd|textrm|textup|textnormal|textsl|textbf)\{/, "keyword", "@texArgBold"],
          [/\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def|let|newenvironment|renewenvironment)/, "keyword"],
          [/\\(caption|label|ref|pageref|eqref|autoref|cite|citep|citet|nocite|footnote|thanks|maketitle|tableofcontents|listoffigures|listoftables|appendix|addcontentsline|addtocontents|clearpage|newpage|pagebreak|linebreak|nolinebreak|newline|today|TeX|LaTeX|LaTeXe)/, "keyword"],
          [/\\(begin|end|item|hspace|vspace|hfill|vfill|centering|raggedright|raggedleft|noindent|indent|par|smallskip|medskip|bigskip)/, "keyword"],
          [/\\(title|author|date|address|email|institute|thanks|and)/, "keyword"],
          [/\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|varepsilon|vartheta|varpi|varrho|varsigma|varphi)/, "type"],
          [/\\(int|sum|prod|oint|coprod|bigcup|bigcap|bigvee|bigwedge|bigoplus|bigotimes|bigodot|biguplus|lim|log|ln|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|coth|det|dim|gcd|hom|inf|ker|lg|max|min|Pr|sup|exp|deg|mod|bmod|pmod|pm|mp|times|div|ast|star|circ|bullet|cdot|cap|cup|uplus|sqcap|sqcup|vee|wedge|setminus|wr|diamond|bigtriangleup|bigtriangledown|triangleleft|triangleright|lhd|rhd|unlhd|unrhd|oplus|ominus|otimes|oslash|odot|bigcirc|dagger|ddagger|amalg|leq|geq|neq|equiv|approx|cong|propto|sim|simeq|asymp|doteq|parallel|models|bot|mid|prec|succ|preceq|succeq|ll|gg|subset|supset|subseteq|supseteq|sqsubset|sqsupseteq|in|ni|notin|vdash|dashv|smile|frown|perp|bowtie|Join|propto|mapsto|to|gets|leftarrow|rightarrow|uparrow|downarrow|updownarrow|Leftarrow|Rightarrow|Uparrow|Downarrow|Updownarrow|longleftarrow|longrightarrow|longleftrightarrow|Longleftarrow|Longrightarrow|Longleftrightarrow|nearrow|searrow|swarrow|nwarrow|leftharpoonup|leftharpoondown|rightharpoonup|rightharpoondown|rightleftharpoons|leadsto|iff)/, "type"],
          [/\\[a-zA-Z@*]+/, "keyword"],
          [/\$\$/, { token: "delimiter.math", next: "@mathDisplay" }],
          [/\$/, { token: "delimiter.math", next: "@mathInline" }],
          [/[{}]/, "delimiter.bracket"]
        ],
        texArgBold: [
          [/[^}]+/, "string"],
          [/\}/, "delimiter.bracket", "@pop"]
        ],
        mathDisplay: [
          [/\$\$/, { token: "delimiter.math", next: "@pop" }],
          [/\\[a-zA-Z@*]+/, "type"],
          [/[{}]/, "delimiter.bracket"],
          [/[0-9]+/, "number"],
          [/[_^]/, "operator"],
          [/\w+/, "identifier"]
        ],
        mathInline: [
          [/\$/, { token: "delimiter.math", next: "@pop" }],
          [/\\[a-zA-Z@*]+/, "type"],
          [/[{}]/, "delimiter.bracket"],
          [/[0-9]+/, "number"],
          [/[_^]/, "operator"],
          [/\w+/, "identifier"]
        ]
      }
    });

    // === Editor color themes so LaTeX + BibTeX tokens are visible ===
    monaco.editor.defineTheme("gitlatex-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "keyword", foreground: "569cd6" },
        { token: "keyword.strong", foreground: "4ec9b0", fontStyle: "bold" },
        { token: "keyword.env", foreground: "c586c0", fontStyle: "bold" },
        { token: "type.env", foreground: "4ec9b0" },
        { token: "string.label", foreground: "dcdcaa" },
        { token: "string.ref", foreground: "d7ba7d" },
        { token: "string.package", foreground: "ce9178" },
        { token: "type", foreground: "c586c0" },
        { token: "string", foreground: "ce9178" },
        { token: "number", foreground: "b5cea8" },
        { token: "delimiter.bracket", foreground: "808080" },
        { token: "delimiter.math", foreground: "e8ab53", fontStyle: "bold" },
        { token: "operator", foreground: "d4d4d4" },
        { token: "identifier", foreground: "9cdcfe" }
      ],
      colors: {
        "editor.background": "#0d1117",
        "editor.foreground": "#e6edf3",
        "editorCursor.foreground": "#e6edf3",
        "editorLineNumber.foreground": "#484f58",
        "editorLineNumber.activeForeground": "#8b949e"
      }
    });
    monaco.editor.defineTheme("gitlatex-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "keyword", foreground: "0000ff" },
        { token: "keyword.strong", foreground: "795e26", fontStyle: "bold" },
        { token: "keyword.env", foreground: "af00db", fontStyle: "bold" },
        { token: "type.env", foreground: "267f99" },
        { token: "string.label", foreground: "7a6a00" },
        { token: "string.ref", foreground: "8a5a00" },
        { token: "string.package", foreground: "a31515" },
        { token: "type", foreground: "af00db" },
        { token: "string", foreground: "a31515" },
        { token: "number", foreground: "098658" },
        { token: "delimiter.bracket", foreground: "808080" },
        { token: "delimiter.math", foreground: "d16969", fontStyle: "bold" },
        { token: "operator", foreground: "000000" },
        { token: "identifier", foreground: "001080" }
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#1f2328",
        "editorCursor.foreground": "#1f2328",
        "editorLineNumber.foreground": "#8c959f",
        "editorLineNumber.activeForeground": "#656d76"
      }
    });

    // Register BibTeX for .bib files
    monaco.languages.register({ id: "bib" });
    monaco.languages.setLanguageConfiguration("bib", {
      wordPattern: /@[a-zA-Z]*|[a-zA-Z][a-zA-Z0-9]*/
    });

    const editorEl = document.getElementById("editor");
    editor = monaco.editor.create(editorEl, {
      value: "",
      language: "latex",
      theme: getMonacoTheme(),
      quickSuggestions: { other: true, comments: true, strings: true },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      suggest: {
        showWords: false,
        showSnippets: true,
        showKeywords: true,
        showFunctions: true,
        showClasses: true,
        showModules: true,
        showVariables: true,
        showReferences: true,
        showFiles: true,
        matchOnWordStartOnly: false
      }
    });

    // LaTeX IntelliSense: load commands/envs from JSON, then populate list for completion provider
    const kindMap = {
      Class: monaco.languages.CompletionItemKind.Class,
      Module: monaco.languages.CompletionItemKind.Module,
      Snippet: monaco.languages.CompletionItemKind.Snippet,
      Keyword: monaco.languages.CompletionItemKind.Keyword,
      Function: monaco.languages.CompletionItemKind.Function,
      Constant: monaco.languages.CompletionItemKind.Constant,
      Reference: monaco.languages.CompletionItemKind.Reference,
      File: monaco.languages.CompletionItemKind.File
    };
    let latexCommands = [];
    fetch("/latex-commands.json")
      .then(res => res.json())
      .then(data => {
        latexCommands = (data.commands || []).map(c => ({
          label: c.label,
          insertText: c.insertText,
          detail: c.detail,
          kind: kindMap[c.kind] ?? monaco.languages.CompletionItemKind.Keyword
        }));
        (data.environments || []).forEach(env => {
          latexCommands.push({
            label: env,
            insertText: `begin{${env}}\n$0\n\\end{${env}}`,
            detail: `Environment: ${env}`,
            kind: monaco.languages.CompletionItemKind.Snippet
          });
        });
      })
      .catch(() => { latexCommands = []; });
    monaco.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["\\", "{"],
      provideCompletionItems(model, position) {
        const line = model.getLineContent(position.lineNumber);
        const offset = position.column - 1;
        const textBefore = line.slice(0, offset);
        const backslash = textBefore.lastIndexOf("\\");
        if (backslash === -1) return { suggestions: [] };
        const prefix = textBefore.slice(backslash + 1).replace(/[^a-zA-Z*]/g, "");
        const range = { startLineNumber: position.lineNumber, startColumn: backslash + 2, endLineNumber: position.lineNumber, endColumn: position.column };
        const suggestions = latexCommands
          .filter(c => c.label.toLowerCase().startsWith(prefix.toLowerCase()))
          .map(c => ({
            ...c,
            range,
            filterText: "\\" + c.label,
            insertTextRules: c.insertText && c.insertText.includes("$") ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined
          }));
        return { suggestions };
      }
    });

    // \ref / \cite completion from the project's labels and .bib keys.
    // Inside \ref{...} or \cite{...} these replace the generic command list.
    monaco.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["{", ","],
      provideCompletionItems(model, position) {
        const textBefore = model.getLineContent(position.lineNumber)
          .slice(0, position.column - 1);
        // Nearest unclosed \cmd{ ... to the left, allowing multiple keys.
        const m = /\\([a-zA-Z]*(?:ref|cite)[a-zA-Z]*)\s*(?:\[[^\]]*\])?\{([^}]*)$/.exec(textBefore);
        if (!m) return { suggestions: [] };
        const isCite = /cite/i.test(m[1]);
        const typedAll = m[2];
        const lastSep = Math.max(typedAll.lastIndexOf(","), typedAll.lastIndexOf(" "));
        const typed = typedAll.slice(lastSep + 1);
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        };
        const source = isCite ? projectCitations : projectLabels;
        const suggestions = source.map(function (item) {
          const key = isCite ? item.key : item.label;
          const detail = isCite
            ? [item.year, item.author].filter(Boolean).join(" · ")
            : item.file + ":" + item.line;
          return {
            label: key,
            insertText: key,
            range,
            filterText: key,
            detail: detail,
            documentation: isCite ? (item.title || "") : ("Defined in " + item.file),
            kind: isCite
              ? monaco.languages.CompletionItemKind.Reference
              : monaco.languages.CompletionItemKind.Value
          };
        });
        // `true` = don't fall through to the generic command provider.
        return { suggestions, incomplete: false };
      }
    });

    // BibTeX IntelliSense for .bib files: entry types after @, fields when typing
    let bibEntryTypes = [];
    let bibFields = [];
    fetch("/bib-commands.json")
      .then(res => res.json())
      .then(data => {
        bibEntryTypes = (data.entryTypes || []).map(e => ({
          label: "@" + e.label,
          insertText: e.insertText,
          detail: e.detail,
          kind: monaco.languages.CompletionItemKind.Class
        }));
        bibFields = (data.fields || []).map(f => ({
          label: f.label,
          insertText: f.insertText,
          detail: f.detail,
          kind: monaco.languages.CompletionItemKind.Field
        }));
      })
      .catch(() => {});
    monaco.languages.registerCompletionItemProvider("bib", {
      triggerCharacters: ["@", "\n", " "],
      provideCompletionItems(model, position) {
        const line = model.getLineContent(position.lineNumber);
        const offset = position.column - 1;
        const textBefore = line.slice(0, offset);
        const atSign = textBefore.lastIndexOf("@");
        const suggestions = [];
        if (atSign !== -1) {
          const prefix = textBefore.slice(atSign + 1).replace(/[^a-zA-Z]/g, "");
          const range = { startLineNumber: position.lineNumber, startColumn: atSign + 2, endLineNumber: position.lineNumber, endColumn: position.column };
          bibEntryTypes
            .filter(e => e.label.toLowerCase().startsWith("@" + prefix.toLowerCase()))
            .forEach(e => {
              suggestions.push({
                ...e,
                range,
                filterText: e.label,
                insertTextRules: e.insertText && e.insertText.includes("$") ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined
              });
            });
        }
        const wordStart = textBefore.search(/[a-zA-Z][a-zA-Z0-9]*$/);
        const wordPrefix = wordStart === -1 ? "" : textBefore.slice(wordStart);
        if (wordPrefix.length >= 1 && suggestions.length === 0) {
          const range = wordStart === -1 ? { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column } : { startLineNumber: position.lineNumber, startColumn: wordStart + 1, endLineNumber: position.lineNumber, endColumn: position.column };
          bibFields
            .filter(f => f.label.toLowerCase().startsWith(wordPrefix.toLowerCase()))
            .forEach(f => {
              suggestions.push({
                ...f,
                range,
                filterText: f.label,
                insertTextRules: f.insertText && f.insertText.includes("$") ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined
              });
            });
        }
        return { suggestions };
      }
    });

    let autosaveTimeout = null;
    const AUTOSAVE_DELAY_MS = 800;
    editor.onDidChangeModelContent(() => {
      clearTimeout(autosaveTimeout);
      autosaveTimeout = setTimeout(() => {
        if (currentFile) saveCurrentFile();
      }, AUTOSAVE_DELAY_MS);
      scheduleOutlineRefresh();
    });
    editor.onDidChangeCursorPosition((e) => {
      highlightOutlineFor(e.position.lineNumber);
    });
    function layoutEditor() {
      if (editor && editorEl) {
        const w = Math.max(editorEl.offsetWidth || 0, 200);
        const h = Math.max(editorEl.offsetHeight || 0, 320);
        editor.layout({ width: w, height: h });
      }
    }
    layoutEditor();
    setTimeout(layoutEditor, 0);
    window.addEventListener("resize", layoutEditor);
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(layoutEditor).observe(editorEl);
    }
    monacoReady = true;
    monacoReadyCallbacks.forEach(cb => cb());
    monacoReadyCallbacks = [];
  });
}

async function openEditorPage(repoName) {
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
  currentRepo = decoded;
  hideDiffView();
  invalidateVersions();
  clearProblems();
  refreshProjectIndex();
  ensureMonacoReady(() => {
    loadFiles();
  });
}

// ----- Editor: file tree & loading -----
function toggleSidebar() {
  const body = document.body;
  const hidden = body.classList.toggle("sidebar-hidden");
  const btn = document.getElementById("toggleSidebarBtn");
  if (btn) {
    btn.setAttribute("aria-label", hidden ? "Show file list" : "Hide file list");
    btn.title = hidden ? "Show file list" : "Hide file list";
  }
}

// Font Awesome file-type icons + colour class, for the sidebar tree.
// FA's fa-file-* set draws an actual document of that type, rather than a
// generic glyph. .tex gets a bespoke TeX wordmark (see makeFileIcon).
const FILE_KINDS = [
  { ext: [".tex"], icon: "tex", kind: "tex" },
  { ext: [".bib"], icon: "fa-solid fa-book-bookmark", kind: "bib" },
  { ext: [".sty", ".cls"], icon: "fa-solid fa-puzzle-piece", kind: "style" },
  { ext: [".pdf"], icon: "fa-solid fa-file-pdf", kind: "pdf" },
  { ext: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"], icon: "fa-solid fa-file-image", kind: "image" },
  { ext: [".eps", ".ps"], icon: "doc", kind: "vector" },
  { ext: [".svg"], icon: "doc", kind: "svg" },
  { ext: [".pgf", ".tikz"], icon: "fa-solid fa-file-image", kind: "image" },
  { ext: [".csv", ".tsv", ".dat"], icon: "fa-solid fa-file-csv", kind: "data" },
  { ext: [".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".xml"], icon: "fa-solid fa-file-code", kind: "config" },
  { ext: [".py", ".js", ".ts", ".sh", ".c", ".cpp", ".h", ".java", ".rb", ".go"], icon: "fa-solid fa-file-code", kind: "code" },
  { ext: [".md", ".txt", ".rst"], icon: "fa-solid fa-file-lines", kind: "text" },
  { ext: [".log", ".aux", ".out", ".toc", ".bbl", ".blg", ".synctex.gz"], icon: "fa-solid fa-receipt", kind: "aux" },
  { ext: [".zip", ".gz", ".tar", ".7z", ".rar"], icon: "fa-solid fa-file-zipper", kind: "archive" },
  { ext: [".ttf", ".otf", ".woff", ".woff2"], icon: "fa-solid fa-font", kind: "font" }
];

function fileKind(name) {
  const lower = (name || "").toLowerCase();
  for (const k of FILE_KINDS) {
    if (k.ext.some(e => lower.endsWith(e))) return k;
  }
  return { icon: "fa-regular fa-file", kind: "other" };
}

// Font Awesome has no glyph for LaTeX or EPS, so those use an inline
// page-with-folded-corner icon carrying a short label. Same 16px box and
// stroke weight as the FA icons, so nothing looks out of place.
const DOC_PATH = "M9.3 1.6H4.6a1.5 1.5 0 0 0-1.5 1.5v9.8a1.5 1.5 0 0 0 1.5 1.5h6.8" +
  "a1.5 1.5 0 0 0 1.5-1.5V5.2L9.3 1.6Z";

function labelledDocSvg(label) {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">' +
    '<path d="' + DOC_PATH + '" fill="currentColor" fill-opacity=".16"/>' +
    '<path d="' + DOC_PATH + '" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M9.1 1.7v2.6c0 .6.4 1 1 1h2.6" stroke="currentColor" stroke-width="1.1" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
    '<text class="doc-label" x="8" y="12.2" text-anchor="middle" font-size="4.8" ' +
      'font-weight="700" font-family="Georgia, \'Times New Roman\', serif">' + label + '</text>' +
  '</svg>';
}

const DOC_LABELS = { tex: "TEX", vector: "EPS", svg: "SVG" };

function makeFileIcon(name) {
  const kind = fileKind(name);
  const label = DOC_LABELS[kind.kind];
  if (label) {
    const el = document.createElement("span");
    el.setAttribute("aria-hidden", "true");
    el.className = "sidebar-file-icon kind-" + kind.kind;
    el.innerHTML = labelledDocSvg(label);
    return el;
  }
  const icon = document.createElement("i");
  icon.className = kind.icon + " sidebar-file-icon kind-" + kind.kind;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function renderFileTree(files, container, basePath = "", activePath = null, selectedFolderPath = null) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  const currentFile = activePath;
  function makeRow(name, fullPath, isFolder) {
    const row = document.createElement("span");
    row.className = "sidebar-item-row";
    if (!isFolder) row.appendChild(makeFileIcon(name));
    const nameSpan = document.createElement("span");
    nameSpan.className = "sidebar-item-name";
    nameSpan.textContent = name;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "sidebar-delete-btn";
    delBtn.setAttribute("aria-label", isFolder ? "Delete folder" : "Delete file");
    delBtn.title = isFolder ? "Delete folder" : "Delete file";
    delBtn.innerHTML = "<span class=\"material-icons\">delete</span>";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSidebarItem(fullPath, isFolder);
    });
    row.appendChild(nameSpan);
    row.appendChild(delBtn);
    return row;
  }
  function makeFolderRow(name, fullPath, isCollapsed) {
    const row = document.createElement("span");
    row.className = "sidebar-item-row";
    const chevron = document.createElement("span");
    chevron.className = "sidebar-chevron material-icons";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = isCollapsed ? "chevron_right" : "expand_more";
    // Open/closed folder icon next to the chevron.
    const folderIcon = document.createElement("i");
    folderIcon.className = "sidebar-file-icon kind-folder fa-solid " +
      (isCollapsed ? "fa-folder" : "fa-folder-open");
    folderIcon.setAttribute("aria-hidden", "true");
    const nameSpan = document.createElement("span");
    nameSpan.className = "sidebar-item-name";
    nameSpan.textContent = name;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "sidebar-delete-btn";
    delBtn.setAttribute("aria-label", "Delete folder");
    delBtn.title = "Delete folder";
    delBtn.innerHTML = "<span class=\"material-icons\">delete</span>";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSidebarItem(fullPath, true);
    });
    row.appendChild(chevron);
    row.appendChild(folderIcon);
    row.appendChild(nameSpan);
    row.appendChild(delBtn);
    return { row, chevron };
  }
  const DRAG_TYPE = "application/x-gitlatex-path";

  function setupDragSource(li, fullPath, isFolder) {
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(DRAG_TYPE, fullPath);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", fullPath);
      li.classList.add("sidebar-drag-source");
    });
    li.addEventListener("dragend", () => li.classList.remove("sidebar-drag-source"));
  }

  function setupDropTarget(el, getTargetPath, dropFolderPath = null) {
    el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("sidebar-drop-target");
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove("sidebar-drop-target");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("sidebar-drop-target");
      const fromPath = e.dataTransfer.getData(DRAG_TYPE);
      if (!fromPath) return;
      const toPath = getTargetPath(fromPath);
      if (!toPath || toPath === fromPath) return;
      if (toPath.startsWith(fromPath + "/")) return;
      if (dropFolderPath && fromPath === dropFolderPath) return;
      moveSidebarItem(fromPath, toPath);
    });
  }

  function walk(nodes, parentPath, parentUl) {
    const list = (nodes || []).slice();
    list.sort((a, b) => {
      const aFolder = a.type === "folder" ? 0 : 1;
      const bFolder = b.type === "folder" ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
      return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    });
    list.forEach(node => {
      const li = document.createElement("li");
      const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
      if (node.type === "folder") {
        li.classList.add("folder");
        li.dataset.path = fullPath;
        if (selectedFolderPath === fullPath) li.classList.add("selected");
        const isCollapsed = collapsedFolderPaths.has(fullPath);
        if (isCollapsed) li.classList.add("collapsed");
        const { row, chevron } = makeFolderRow(node.name, fullPath, isCollapsed);
        li.appendChild(row);
        const childUl = document.createElement("ul");
        walk(node.children || [], fullPath, childUl);
        li.appendChild(childUl);
        setupDragSource(li, fullPath, true);
        setupDropTarget(li, (from) => fullPath + "/" + from.split("/").pop(), fullPath);
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (e.target.closest(".sidebar-delete-btn")) return;
          const wasCollapsed = collapsedFolderPaths.has(fullPath);
          if (wasCollapsed) {
            collapsedFolderPaths.delete(fullPath);
            li.classList.remove("collapsed");
            chevron.textContent = "expand_more";
          } else {
            collapsedFolderPaths.add(fullPath);
            li.classList.add("collapsed");
            chevron.textContent = "chevron_right";
          }
          currentFolderPath = fullPath;
          container.querySelectorAll("li.folder").forEach(el => el.classList.toggle("selected", el.dataset.path === fullPath));
          container.querySelectorAll("li.file").forEach(el => el.classList.remove("active"));
        });
      } else {
        li.classList.add("file");
        li.dataset.path = fullPath;
        if (currentFile === fullPath && !selectedFolderPath) li.classList.add("active");
        if (node.name.endsWith(".tex")) li.classList.add("tex-file");
        const row = makeRow(node.name, fullPath, false);
        li.appendChild(row);
        setupDragSource(li, fullPath, false);
        row.addEventListener("click", () => {
          currentFolderPath = null;
          loadFile(fullPath);
        });
      }
      parentUl.appendChild(li);
    });
  }
  walk(files, basePath, ul);
  container.appendChild(ul);

  if (container.id === "sidebar-tree") {
    container.addEventListener("dragover", (e) => {
      if (e.target.closest("li")) return;
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      container.classList.add("sidebar-drop-target");
    });
    container.addEventListener("dragleave", (e) => {
      if (!container.contains(e.relatedTarget)) container.classList.remove("sidebar-drop-target");
    });
    container.addEventListener("drop", (e) => {
      if (e.target.closest("li")) return;
      e.preventDefault();
      container.classList.remove("sidebar-drop-target");
      const fromPath = e.dataTransfer.getData(DRAG_TYPE);
      if (!fromPath) return;
      const toPath = fromPath.split("/").pop();
      if (toPath === fromPath) return;
      moveSidebarItem(fromPath, toPath);
    });
  }
}

async function moveSidebarItem(fromPath, toPath) {
  try {
    const data = await fetchJson("/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromPath, to: toPath })
    });
    if (data.error) {
      setConsole("Move failed: " + data.error);
      return;
    }
    const newPath = data.path != null ? data.path : toPath;
    if (currentFile === fromPath) {
      currentFile = newPath;
      loadFile(newPath);
    }
    if (currentFolderPath === fromPath || (currentFolderPath && fromPath.startsWith(currentFolderPath + "/"))) {
      currentFolderPath = newPath.startsWith(currentFolderPath + "/") ? currentFolderPath : null;
    }
    await loadFiles();
    setConsole("Moved " + fromPath + " → " + newPath);
  } catch (e) {
    setConsole("Move failed: " + (e.message || ""));
  }
}

async function deleteSidebarItem(path, isFolder) {
  const message = isFolder
    ? "Delete folder \u201C" + path + "\u201D and all its contents? This cannot be undone."
    : "Delete file \u201C" + path + "\u201D?";
  const ok = await showConfirmModal({ message, confirmLabel: "Delete" });
  if (!ok) return;
  try {
    const data = await fetchJson("/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    });
    if (data.error) {
      setConsole("Delete failed: " + data.error);
      return;
    }
    if (currentFile === path) {
      currentFile = null;
      showEditorPane();
      if (editor) {
        editor.setValue("");
        if (monacoApi) {
          const model = editor.getModel();
          if (model) monacoApi.editor.setModelLanguage(model, "latex");
        }
      }
    }
    if (currentFolderPath === path || (currentFolderPath && path.startsWith(currentFolderPath + "/"))) {
      currentFolderPath = null;
    }
    await loadFiles();
    setConsole("Deleted " + path);
  } catch (e) {
    setConsole("Delete failed: " + (e.message || ""));
  }
}

function findFirstTexFile(files, basePath = "") {
  for (const node of files || []) {
    const fullPath = basePath ? `${basePath}/${node.name}` : node.name;
    if (node.type === "file" && node.name.endsWith(".tex")) return fullPath;
    if (node.type === "folder" && node.children) {
      const found = findFirstTexFile(node.children, fullPath);
      if (found) return found;
    }
  }
  return null;
}

function getSidebarTreeEl() {
  return document.getElementById("sidebar-tree");
}

async function loadFiles() {
  const treeEl = getSidebarTreeEl();
  if (!treeEl) return;
  try {
    const res = await fetchApi("/files");
    const files = await res.json();
    if (!files || !files.length) {
      treeEl.innerHTML = '<div class="sidebar-placeholder">Repository is empty.</div>';
      currentFile = null;
      showEditorPane();
      if (editor) {
        editor.setValue("");
        if (monacoApi) {
          const model = editor.getModel();
          if (model) monacoApi.editor.setModelLanguage(model, "latex");
        }
      }
      setConsole("");
      return;
    }
    renderFileTree(files, treeEl, "", currentFile, currentFolderPath);
    refreshMainFileDropdown(files);
    const firstTex = findFirstTexFile(files);
    if (firstTex && !currentFolderPath) loadFile(firstTex);
  } catch (e) {
    treeEl.innerHTML = '<div class="sidebar-placeholder">Could not load files.</div>';
    setConsole("Error: " + (e.message || "Failed to load files"));
  }
}

async function loadFile(path) {
  try {
    currentFile = path;
    currentFolderPath = null;
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
    if (editor) {
      editor.setValue(data.content || "");
      if (monacoApi) {
        const model = editor.getModel();
        if (model) {
          const lang = (path.endsWith(".tex") || path.endsWith(".sty") || path.endsWith(".cls")) ? "latex" : path.endsWith(".bib") ? "bib" : "plaintext";
          monacoApi.editor.setModelLanguage(model, lang);
        }
      }
    }
    renderOutline();
    refreshEditorMarkers();
    refreshEnvDecorations();
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
  }
}

async function addNewFileSidebar() {
  const prefix = currentFolderPath ? currentFolderPath + "/" : "";
  const path = await showInputModal({
    title: "New file",
    label: "File path (e.g. main.tex or chapters/intro.tex)",
    placeholder: "main.tex",
    submitLabel: "Create",
    defaultValue: prefix
  });
  if (path == null || !path.trim()) return;
  const trimmed = path.trim();
  try {
    const data = await fetchJson("/create-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: trimmed, content: "" })
    });
    if (data.error) {
      setConsole("Create file failed: " + data.error);
      return;
    }
    await loadFiles();
    loadFile(data.path || trimmed);
    setConsole("Created " + (data.path || trimmed));
  } catch (e) {
    setConsole("Create file failed: " + (e.message || ""));
  }
}

async function addNewFolderSidebar() {
  const prefix = currentFolderPath ? currentFolderPath + "/" : "";
  const path = await showInputModal({
    title: "New folder",
    label: "Folder path (e.g. chapters or sections/figures)",
    placeholder: "chapters",
    submitLabel: "Create",
    defaultValue: prefix
  });
  if (path == null || !path.trim()) return;
  const trimmed = path.trim();
  try {
    const data = await fetchJson("/create-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: trimmed })
    });
    if (data.error) {
      setConsole("Create folder failed: " + data.error);
      return;
    }
    await loadFiles();
    setConsole("Created folder " + (data.path || trimmed));
  } catch (e) {
    setConsole("Create folder failed: " + (e.message || ""));
  }
}

function uploadFilesSidebar() {
  const input = document.getElementById("sidebar-file-input");
  if (!input) return;
  input.value = "";
  input.click();
}

async function handleSidebarFileInputChange(e) {
  const input = e.target;
  const files = input.files;
  if (!files || files.length === 0) return;
  const toSend = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result.split(",")[1];
        resolve(b64 || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const basePath = currentFolderPath ? currentFolderPath + "/" : "";
    toSend.push({ name: basePath + file.name, content: base64 });
  }
  try {
    const data = await fetchJson("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: toSend })
    });
    if (data.error) {
      setConsole("Upload failed: " + data.error);
      return;
    }
    await loadFiles();
    setConsole("Uploaded " + (data.created?.length || 0) + " file(s).");
  } catch (e) {
    setConsole("Upload failed: " + (e.message || ""));
  }
  input.value = "";
}

async function saveCurrentFile() {
  if (!currentFile) {
    await showConfirmModal({ message: "No file selected. Please open a file first.", confirmLabel: "OK" });
    return;
  }
  if (isViewableFile(currentFile) || !isEditableFile(currentFile)) {
    setConsole("Cannot edit this file.");
    return;
  }
  const content = editor ? editor.getValue() : "";
  try {
    await fetchApi("/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFile, content })
    });
    setConsole("Saved " + currentFile);
  } catch (e) {
    setConsole("Save failed: " + (e.message || ""));
  }
}

function setCompileLoading(loading) {
  const btn = document.getElementById("btn-compile");
  if (!btn) return;
  const icon = btn.querySelector(".btn-compile-icon");
  const text = btn.querySelector(".btn-compile-text");
  if (loading) {
    btn.classList.add("loading");
    btn.disabled = true;
    if (icon) icon.textContent = "sync";
    if (text) text.textContent = "Compiling…";
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
    if (icon) icon.textContent = "build";
    if (text) text.textContent = "Compile";
  }
}

// The main file is per-project: each repo remembers its own .tex entry point.
function mainFileKey() {
  return currentRepo ? "gitlatex-mainfile:" + currentRepo : null;
}

function getMainFile() {
  const key = mainFileKey();
  if (!key) return "";
  try {
    return localStorage.getItem(key) || "";
  } catch (_) {}
  return "";
}

function setMainFile(path) {
  const key = mainFileKey();
  if (key) {
    try {
      if (path) localStorage.setItem(key, path);
      else localStorage.removeItem(key);
    } catch (_) {}
  }
  const label = document.getElementById("mainfile-label");
  if (label) label.textContent = path || "main.tex";
}

function collectTexFiles(files, basePath) {
  const list = [];
  for (const node of files || []) {
    const fullPath = basePath ? basePath + "/" + node.name : node.name;
    if (node.type === "file" && node.name.endsWith(".tex")) list.push(fullPath);
    else if (node.type === "folder" && node.children) list.push.apply(list, collectTexFiles(node.children, fullPath));
  }
  return list;
}

function populateMainFileDropdown() {
  const dd = document.getElementById("toolbar-mainfile");
  const btn = document.getElementById("mainfile-dropdown-btn");
  if (!dd || !btn) return;

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (dd.classList.contains("open")) {
      closeMainFileDropdown();
    } else {
      openMainFileDropdown();
    }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".toolbar-mainfile")) closeMainFileDropdown();
  });
}

function openMainFileDropdown() {
  const dd = document.getElementById("toolbar-mainfile");
  const btn = document.getElementById("mainfile-dropdown-btn");
  const menu = document.getElementById("mainfile-dropdown-menu");
  if (!dd || !btn || !menu) return;
  const rect = btn.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = "auto";
  menu.style.right = (window.innerWidth - rect.right) + "px";
  menu.style.minWidth = Math.max(rect.width, 200) + "px";
  menu.style.display = "block";
  menu.style.zIndex = "1001";
  document.body.appendChild(menu);
  dd.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  menu.setAttribute("aria-hidden", "false");
}

function closeMainFileDropdown() {
  const dd = document.getElementById("toolbar-mainfile");
  const btn = document.getElementById("mainfile-dropdown-btn");
  const menu = document.getElementById("mainfile-dropdown-menu");
  if (!dd || !btn || !menu) return;
  dd.classList.remove("open");
  btn.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-hidden", "true");
  menu.style.display = "none";
  if (menu.parentElement === document.body) {
    dd.appendChild(menu);
  }
  menu.style.position = "";
  menu.style.top = "";
  menu.style.right = "";
  menu.style.zIndex = "";
}

async function refreshMainFileDropdown(files) {
  const menu = document.getElementById("mainfile-dropdown-menu");
  if (!menu) return;
  const texFiles = collectTexFiles(files, "");
  menu.innerHTML = "";

  const hint = document.createElement("div");
  hint.className = "mainfile-dropdown-hint";
  hint.setAttribute("aria-hidden", "true");
  hint.textContent = texFiles.length
    ? "Pick the .tex file to compile for this project"
    : "No .tex files here — add one to this project first";
  menu.appendChild(hint);

  // Fall back (and re-persist) when the remembered file is gone from this project.
  const stored = getMainFile();
  const selected = texFiles.includes(stored)
    ? stored
    : (texFiles.includes("main.tex") ? "main.tex" : (texFiles[0] || ""));
  if (selected !== stored) setMainFile(selected);

  texFiles.forEach(function (path) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.role = "menuitem";
    btn.innerHTML = '<span class="material-icons">description</span><span>' + path + '</span>';
    if (path === selected) btn.classList.add("active");
    btn.addEventListener("click", function () {
      setMainFile(path);
      refreshMainFileDropdown(files);
      closeMainFileDropdown();
    });
    menu.appendChild(btn);
  });
  const label = document.getElementById("mainfile-label");
  if (label) label.textContent = selected || "main.tex";
}

async function compile() {
  if (currentFile && currentFile.endsWith(".tex")) await saveCurrentFile();
  const mainFile = getMainFile() || "main.tex";
  const compilerApi = getUseCompilerApi() ? getStoredCompilerApi() : "";
  setCompileLoading(true);
  try {
    if (compilerApi) {
      const compilerUrl = normalizeCompilerApiUrl(compilerApi);
      const bundleRes = await fetchApi("/repo-files-content");
      const bundleData = await bundleRes.json();
      const files = Array.isArray(bundleData.files) ? bundleData.files : [];
      const apiKey = getStoredCompilerApiKey();
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
      const res = await fetch(compilerUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ main: mainFile, files, engine: getLatexEngine() })
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.pdf) {
        const pdfPath = mainFile.replace(/\.tex$/i, ".pdf");
        const pdfStr = typeof data.pdf === "string" ? data.pdf : "";
        const isDataUrl = pdfStr.includes("base64,");
        if (isDataUrl) {
          const base64 = pdfStr.includes(",") ? pdfStr.slice(pdfStr.indexOf(",") + 1).trim() : pdfStr;
          if (!base64) {
            document.getElementById("pdf").src = data.pdf;
            setConsole("Compiled " + mainFile + " via API.");
          } else {
            const savePayload = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pdfPath, content: base64 }) };
            const trySave = async (path) => {
              const saveRes = await fetchApi(path, savePayload);
              let saveData = {};
              try {
                saveData = await saveRes.json();
              } catch (_) {
                saveData = { error: "Invalid response (status " + saveRes.status + ")" };
              }
              return { saveRes, saveData };
            };
            let saveRes, saveData;
            const r1 = await trySave("/save-pdf");
            if (r1.saveRes.status === 404) {
              const r2 = await trySave("/api/save-pdf");
              saveRes = r2.saveRes;
              saveData = r2.saveData;
            } else {
              saveRes = r1.saveRes;
              saveData = r1.saveData;
            }
            try {
              if (saveRes.ok && saveData.success) {
                const base = getApiBase() || "";
                const pdfUrl = base + (pdfPath.includes("/") ? "/pdf?path=" + encodeURIComponent(pdfPath) : "/pdf/" + pdfPath);
                document.getElementById("pdf").src = pdfUrl;
                setConsole("Compiled " + mainFile + " via API. PDF saved to " + pdfPath);
              } else {
                document.getElementById("pdf").src = data.pdf;
                setConsole("Compiled " + mainFile + " via API. Save to repo failed: " + (saveData.error || saveRes.status || "unknown"));
              }
            } catch (e) {
              document.getElementById("pdf").src = data.pdf;
              setConsole("Compiled " + mainFile + " via API. Save to repo failed: " + (e.message || "network error"));
            }
          }
        } else {
          document.getElementById("pdf").src = data.pdf;
          setConsole("Compiled " + mainFile + " via API.");
        }
      } else if (data.error) {
        setConsole("Compile error:\n" + (data.error || res.statusText));
      } else {
        setConsole("Compile failed: " + (res.statusText || "Invalid response from API"));
      }
    } else {
      const res = await fetchApi("/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainFile, engine: getLatexEngine() })
      });
      let data = {};
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        setConsole("Compile failed: Server returned invalid JSON (status " + res.status + "). Is the backend running?");
        return;
      }
      applyProblems(data.problems || []);
      if (data.success && data.pdf) {
        // Cache-bust so the viewer shows the freshly built PDF.
        document.getElementById("pdf").src = (getApiBase() || "") + data.pdf + "?t=" + Date.now();
        renderProblems(data.problems || [], describeBuild(mainFile, data), data.log);
      } else if (data.error) {
        renderProblems(data.problems || [], "Compile error: " + data.error, data.log);
      } else {
        setConsole("Compile failed: " + (res.statusText || res.status || "Unknown error"));
      }
      refreshProjectIndex();
    }
  } catch (e) {
    const hint = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "http://localhost:5000";
    setConsole("Compile failed: " + (e.message || "Network error") + ". Check that a repo is selected and the server is running at " + hint + ".");
  } finally {
    setCompileLoading(false);
  }
}

// ----- Environment pair colouring -----
// \begin{X} and its \end{X} share a colour, derived from the name, so the
// same environment always looks the same. Unmatched ones are flagged.
const ENV_COLOR_COUNT = 12;
let envDecorations = null;

// Colours are handed out per document in order of first appearance, so the
// environments actually used in a file get distinct colours. Hashing the
// name instead left 6 of 16 common names sharing one colour.
function envColorAssigner() {
  const seen = new Map();
  return function (name) {
    if (!seen.has(name)) seen.set(name, seen.size % ENV_COLOR_COUNT);
    return seen.get(name);
  };
}

function refreshEnvDecorations() {
  if (!editor || !monacoApi) return;
  const model = editor.getModel();
  if (!model) return;
  if (!envDecorations) envDecorations = editor.createDecorationsCollection([]);
  const isTex = typeof model.getLanguageId === "function"
    ? model.getLanguageId() === "latex"
    : true;
  if (!isTex) {
    envDecorations.set([]);
    return;
  }

  const found = model.findMatches(
    "\\\\(begin|end)\\s*\\{([^}]*)\\}", false, true, false, null, true
  );
  const stack = [];
  const decorations = [];
  const unmatchedEnd = [];
  const colorFor = envColorAssigner();

  found.forEach(function (m) {
    const kind = m.matches[1];
    const name = (m.matches[2] || "").trim();
    if (kind === "begin") {
      stack.push({ name: name, range: m.range });
    } else {
      // Pop the nearest open environment with this name.
      let i = stack.length - 1;
      while (i >= 0 && stack[i].name !== name) i--;
      if (i >= 0) stack.splice(i, 1);
      else unmatchedEnd.push(m.range);
    }
    decorations.push({
      range: m.range,
      options: {
        inlineClassName: "tex-env tex-env-" + colorFor(name),
        hoverMessage: { value: "`" + name + "` environment" }
      }
    });
  });

  // Anything still open never got closed.
  stack.forEach(function (open) {
    decorations.push({
      range: open.range,
      options: {
        inlineClassName: "tex-env-unmatched",
        hoverMessage: { value: "Unclosed environment `" + open.name + "`" }
      }
    });
  });
  unmatchedEnd.forEach(function (range) {
    decorations.push({
      range: range,
      options: {
        inlineClassName: "tex-env-unmatched",
        hoverMessage: { value: "No matching `\\begin` for this `\\end`" }
      }
    });
  });

  envDecorations.set(decorations);
}

// ----- Document outline (sections of the open file) -----
const OUTLINE_LEVELS = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5
};

function parseOutline(text) {
  const items = [];
  const lines = (text || "").split("\n");
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/;
  lines.forEach(function (line, i) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("%")) return; // commented out
    const m = re.exec(line);
    if (!m) return;
    // Balance braces so titles containing {...} survive intact.
    let depth = 0, title = "";
    for (let k = m.index + m[0].length - 1; k < line.length; k++) {
      const ch = line[k];
      if (ch === "{") { depth++; if (depth === 1) continue; }
      else if (ch === "}") { depth--; if (depth === 0) break; }
      if (depth > 0) title += ch;
    }
    items.push({
      level: OUTLINE_LEVELS[m[1]],
      kind: m[1],
      title: title.replace(/\\[a-zA-Z]+\s*/g, "").replace(/[{}]/g, "").trim() || "(untitled)",
      line: i + 1
    });
  });
  return items;
}

function renderOutline() {
  const box = document.getElementById("outline-tree");
  if (!box) return;
  const isTex = currentFile && /\.(tex|sty|cls)$/i.test(currentFile);
  if (!isTex || !editor) {
    box.innerHTML = '<div class="outline-empty">Open a .tex file to see its outline.</div>';
    return;
  }
  const items = parseOutline(editor.getValue());
  if (!items.length) {
    box.innerHTML = '<div class="outline-empty">No sections found.</div>';
    return;
  }
  const minLevel = Math.min.apply(null, items.map(i => i.level));
  box.innerHTML = "";
  items.forEach(function (it) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "outline-item";
    row.style.paddingLeft = (8 + (it.level - minLevel) * 12) + "px";
    row.textContent = it.title;
    row.title = "\\" + it.kind + " - line " + it.line;
    row.dataset.line = String(it.line);
    row.addEventListener("click", function () {
      if (!editor) return;
      editor.revealLineInCenter(it.line);
      editor.setPosition({ lineNumber: it.line, column: 1 });
      editor.focus();
      highlightOutlineFor(it.line);
    });
    box.appendChild(row);
  });
  if (editor.getPosition) highlightOutlineFor(editor.getPosition().lineNumber);
}

// Marks the section the cursor currently sits in.
function highlightOutlineFor(line) {
  const box = document.getElementById("outline-tree");
  if (!box) return;
  const rows = Array.from(box.querySelectorAll(".outline-item"));
  let active = null;
  rows.forEach(function (r) {
    r.classList.remove("active");
    if (Number(r.dataset.line) <= line) active = r;
  });
  if (active) active.classList.add("active");
}

let outlineTimer = null;
function scheduleOutlineRefresh() {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(function () {
    renderOutline();
    refreshEnvDecorations();
  }, 300);
}

function toggleOutlineSection() {
  const section = document.getElementById("outline-section");
  const header = document.getElementById("outline-header");
  if (!section) return;
  const collapsed = section.classList.toggle("collapsed");
  if (header) header.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

// ----- Project index: labels and citation keys for autocomplete -----
let projectLabels = [];
let projectCitations = [];

async function refreshProjectIndex() {
  try {
    const res = await fetchApi("/project-index");
    if (!(res.headers.get("content-type") || "").includes("application/json")) return;
    const data = await res.json();
    if (data.error) return;
    projectLabels = data.labels || [];
    projectCitations = data.citations || [];
  } catch (_) {}
}

// ----- Compile problems: console list + Monaco markers -----
let lastProblems = [];

const LATEX_ENGINE_KEY = "gitlatex-engine";

function getLatexEngine() {
  try {
    const e = localStorage.getItem(LATEX_ENGINE_KEY);
    if (e === "xelatex" || e === "lualatex" || e === "pdflatex") return e;
  } catch (_) {}
  return "pdflatex";
}

function setLatexEngine(engine) {
  try { localStorage.setItem(LATEX_ENGINE_KEY, engine); } catch (_) {}
}

const USE_API_KEY = "gitlatex-use-compiler-api";

// Explicit opt-in, so a saved URL can be kept without always compiling remotely.
// Legacy setups that only have a URL stored keep working.
function getUseCompilerApi() {
  try {
    const v = localStorage.getItem(USE_API_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch (_) {}
  return !!getStoredCompilerApi();
}

function setUseCompilerApi(on) {
  try { localStorage.setItem(USE_API_KEY, on ? "true" : "false"); } catch (_) {}
}

function describeBuild(mainFile, data) {
  const steps = data.steps || [];
  const bib = steps.find(s => s.tool === "bibtex" || s.tool === "biber");
  const runs = steps.filter(s => s.tool === data.engine).length;
  let msg = "Compiled " + mainFile + " with " + (data.engine || "pdflatex") +
    " (" + runs + " pass" + (runs === 1 ? "" : "es");
  if (bib && !bib.missing) msg += " + " + bib.tool;
  msg += ").";
  if (bib && bib.missing) {
    msg += "\n" + bib.tool + " is not installed - citations will stay unresolved.";
  }
  return msg;
}

// Puts squiggles in the gutter for problems in the file being edited.
function applyProblems(problems) {
  lastProblems = problems || [];
  refreshEditorMarkers();
}

function refreshEditorMarkers() {
  if (!monacoApi || !editor) return;
  const model = editor.getModel();
  if (!model) return;
  const current = (currentFile || "").replace(/^\.\//, "");
  const mine = lastProblems.filter(function (p) {
    const f = (p.file || "").replace(/^\.\//, "");
    // Log paths can be relative to the project root or bare file names.
    return p.line && (f === current || current.endsWith("/" + f) || f.endsWith("/" + current));
  });
  monacoApi.editor.setModelMarkers(model, "latex", mine.map(function (p) {
    const line = Math.max(1, Math.min(p.line, model.getLineCount()));
    return {
      startLineNumber: line,
      endLineNumber: line,
      startColumn: 1,
      endColumn: model.getLineMaxColumn(line),
      message: p.message,
      severity: p.severity === "error"
        ? monacoApi.MarkerSeverity.Error
        : monacoApi.MarkerSeverity.Warning
    };
  }));
}

// LaTeX logs run to thousands of lines; keep the tail, which is where
// the interesting part is.
function trimLog(log) {
  const lines = (log || "").split("\n");
  const MAX = 500;
  if (lines.length <= MAX) return log;
  return "... " + (lines.length - MAX) + " earlier lines hidden ...\n" +
    lines.slice(-MAX).join("\n");
}

function clearProblems() {
  lastProblems = [];
  if (monacoApi && editor) {
    const model = editor.getModel();
    if (model) monacoApi.editor.setModelMarkers(model, "latex", []);
  }
  const box = document.getElementById("problems-list");
  if (box) box.innerHTML = "";
  setProblemsBadge([]);
  const out = document.getElementById("console");
  if (out) out.textContent = "";
  showConsoleTab("output");
}

// Fills the Problems tab; `summary` and the raw log go to Output.
function renderProblems(problems, summary, log) {
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

async function goToProblem(p) {
  if (!p.file) return;
  const target = p.file.replace(/^\.\//, "");
  if (target !== currentFile) {
    await loadFile(target);
  }
  if (!editor || !p.line) return;
  const model = editor.getModel();
  const line = model ? Math.max(1, Math.min(p.line, model.getLineCount())) : p.line;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.focus();
}

function ensureConsoleVisible() {
  if (isConsoleHidden()) setConsoleVisible(true);
}

function isConsoleHidden() {
  const view = document.getElementById("editor-view");
  return !!view && view.classList.contains("console-hidden");
}

function setConsoleVisible(visible) {
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

// Opens the console on the Problems tab; closes it if already open.
async function showCompileErrors() {
  if (!isConsoleHidden()) {
    setConsoleVisible(false);
    return;
  }
  setConsoleVisible(true);
  if (lastProblems.length) {
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

// Commits everything under a timestamp message, then pushes.
async function pushChanges() {
  ensureConsoleVisible();
  setConsole("Committing and pushing...");
  try {
    if (currentFile) await saveCurrentFile();
    const res = await fetchApi("/push", { method: "POST" });
    const data = await res.json();
    if (data.error) {
      setConsole("Push error: " + data.error);
      return;
    }
    setConsole(data.committed ? "Committed and pushed to remote." : "Pushed to remote.");
    invalidateVersions();
  } catch (e) {
    setConsole("Push failed: " + (e.message || ""));
  }
}

async function pullChanges() {
  ensureConsoleVisible();
  setConsole("Pulling from remote...");
  try {
    if (currentFile) await saveCurrentFile();
    const res = await fetchApi("/pull", { method: "POST" });
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      setConsole("Pull error: server did not recognise /pull (HTTP " + res.status + ").\nRestart the GitLaTeX server to load the new endpoint.");
      return;
    }
    const data = await res.json();
    if (data.error) {
      setConsole("Pull error: " + data.error);
      return;
    }
    setConsole("Pulled from remote.\n" + (data.output || ""));
    invalidateVersions();
    if (data.changed) {
      const reopen = currentFile;
      await loadFiles();
      if (reopen) await loadFile(reopen);
    }
  } catch (e) {
    setConsole("Pull failed: " + (e.message || ""));
  }
}

function formatStatus(s) {
  const lines = [];
  if (s.detached) lines.push("HEAD is detached (not on a branch).");
  else lines.push("On branch " + (s.current || "?"));

  if (!s.hasCommits) {
    lines.push("No commits yet.");
  } else if (!s.tracking) {
    lines.push("No upstream branch set.");
  } else if (s.ahead || s.behind) {
    const parts = [];
    if (s.ahead) parts.push(s.ahead + " ahead");
    if (s.behind) parts.push(s.behind + " behind");
    lines.push(parts.join(", ") + " of " + s.tracking + " (as of the last fetch)");
  } else {
    lines.push("Up to date with " + s.tracking + " (as of the last fetch)");
  }

  const groups = [
    ["Staged", s.staged],
    ["Modified", s.modified],
    ["Deleted", s.deleted],
    ["Untracked", s.untracked]
  ];
  let any = false;
  groups.forEach(function (g) {
    const list = g[1] || [];
    if (!list.length) return;
    any = true;
    lines.push("");
    lines.push(g[0] + " (" + list.length + "):");
    list.forEach(function (p) { lines.push("  " + p); });
  });
  if (!any) {
    lines.push("");
    lines.push("Working tree clean.");
  }
  return lines.join("\n");
}

async function showStatus() {
  ensureConsoleVisible();
  setConsole("Checking status...");
  try {
    if (currentFile) await saveCurrentFile();
    const res = await fetchApi("/status");
    const data = await res.json();
    setConsole(data.error ? "Status error: " + data.error : formatStatus(data.status || {}));
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

// Shows uncommitted changes in the Versions panel's side-by-side diff.
async function showDiff() {
  openVersionsPanel();
  if (!versionsLoaded) await loadCommits();
  const item = document.querySelector(".working-item");
  if (!item) return;
  if (!item.classList.contains("expanded")) {
    item.querySelector(".version-expand")?.click();
  }
}

// ----- Versions: commit history panel + diff viewer -----
let diffEditor = null;
let versionsLoaded = false;
let openCommitHash = null;
let diffSource = null; // "commit" | "compare" - what the open diff came from

function monacoLanguageFor(path) {
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

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

// DD/MM/YYYY HH:MM
function formatCommitDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || "";
  return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

// DD/MM/YYYY, for the compact compare bar.
function formatCommitDay(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || "";
  return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
}

function isVersionsPanelOpen() {
  const panel = document.getElementById("versions-panel");
  return !!panel && !panel.classList.contains("hidden");
}

function toggleVersionsPanel() {
  isVersionsPanelOpen() ? closeVersionsPanel() : openVersionsPanel();
}

function openVersionsPanel() {
  const panel = document.getElementById("versions-panel");
  const btn = document.getElementById("btn-versions");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  if (btn) { btn.classList.add("active"); btn.setAttribute("aria-pressed", "true"); }
  if (!versionsLoaded) loadCommits();
}

function closeVersionsPanel() {
  const panel = document.getElementById("versions-panel");
  const btn = document.getElementById("btn-versions");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");
  if (btn) { btn.classList.remove("active"); btn.setAttribute("aria-pressed", "false"); }
}

async function loadCommits() {
  const list = document.getElementById("versions-list");
  if (!list) return;
  // Selected hashes may not survive a reload (e.g. after a pull).
  compareSelection = [];
  compareOrderSwapped = false;
  renderCompareBar();
  loadComparison();
  list.innerHTML = '<div class="versions-placeholder">Loading history...</div>';
  try {
    const res = await fetchApi("/commits?limit=100");
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      list.innerHTML = '<div class="versions-placeholder">Restart the GitLaTeX server to use Versions.</div>';
      return;
    }
    const data = await res.json();
    if (data.error) {
      list.innerHTML = '<div class="versions-placeholder"></div>';
      list.firstChild.textContent = data.error;
      return;
    }
    versionsLoaded = true;
    renderCommits(data.commits || [], data.hasMore);
  } catch (e) {
    list.innerHTML = '<div class="versions-placeholder">Could not load history.</div>';
  }
}

function renderCommits(commits, hasMore) {
  const list = document.getElementById("versions-list");
  if (!list) return;
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
function renderWorkingTreeEntry(list) {
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
    files.innerHTML = '<div class="versions-placeholder">Loading changes...</div>';
    try {
      if (currentFile) await saveCurrentFile();
      const res = await fetchApi("/working-files");
      const data = await res.json();
      if (data.error) {
        files.innerHTML = '<div class="versions-placeholder"></div>';
        files.firstChild.textContent = data.error;
        return;
      }
      files.innerHTML = "";
      if (!(data.files || []).length) {
        files.innerHTML = '<div class="versions-placeholder">Working tree clean.</div>';
        return;
      }
      renderFileList(files, data.files, function (f, btn) {
        files.querySelectorAll(".version-file").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        diffSource = "working";
        showDiffFrom("/working-file?path=" + encodeURIComponent(f.path),
          f.path, "Last commit  →  now (uncommitted)");
      });
    } catch (e) {
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
let compareSelection = [];
let compareOrderSwapped = false;

function commitListOrder() {
  const list = document.getElementById("versions-list");
  if (!list) return [];
  return Array.from(list.querySelectorAll(".version-item")).map(el => el.dataset.hash);
}

function comparePair() {
  if (compareSelection.length !== 2) return null;
  const order = commitListOrder();
  const pair = compareSelection.slice().sort(function (x, y) {
    // Newest first in the list, so the later index is the older commit.
    return order.indexOf(y.hash) - order.indexOf(x.hash);
  });
  // Default direction: older -> newer, i.e. "what changed since".
  const from = pair[0], to = pair[1];
  return compareOrderSwapped ? { from: to, to: from } : { from: from, to: to };
}

function toggleCompareSelection(commit) {
  const i = compareSelection.findIndex(c => c.hash === commit.hash);
  if (i >= 0) {
    compareSelection.splice(i, 1);
  } else {
    compareSelection.push(commit);
    // Selecting a third drops the oldest selection.
    if (compareSelection.length > 2) compareSelection.shift();
  }
  compareOrderSwapped = false;
  renderCompareBar();
  loadComparison();
}

function clearCompareSelection() {
  compareSelection = [];
  compareOrderSwapped = false;
  renderCompareBar();
  loadComparison();
  // The open diff belonged to the cleared selection.
  hideDiffView();
}

function renderCompareBar() {
  const bar = document.getElementById("versions-compare-bar");
  const list = document.getElementById("versions-list");
  if (!bar || !list) return;

  const selected = new Set(compareSelection.map(c => c.hash));
  list.querySelectorAll(".version-item").forEach(function (item) {
    const on = selected.has(item.dataset.hash);
    item.classList.toggle("selected", on);
    const icon = item.querySelector(".version-select .material-icons");
    if (icon) icon.textContent = on ? "check_box" : "check_box_outline_blank";
  });

  if (!compareSelection.length) {
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
    if (a) { a.textContent = formatCommitDay(compareSelection[0].date); a.title = compareSelection[0].message || ""; }
    if (b) { b.textContent = "Select a second"; b.title = ""; }
  }
  const swap = document.getElementById("compare-swap");
  if (swap) swap.disabled = !pair;
}

async function loadComparison() {
  const box = document.getElementById("versions-compare-files");
  if (!box) return;
  const pair = comparePair();
  if (!pair) {
    box.classList.add("hidden");
    box.innerHTML = "";
    // Only close a diff that came from a comparison, not a single-commit one.
    if (diffSource === "compare") hideDiffView();
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = '<div class="versions-placeholder">Comparing...</div>';
  try {
    const res = await fetchApi("/compare-files?from=" + encodeURIComponent(pair.from.hash) +
      "&to=" + encodeURIComponent(pair.to.hash));
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      box.innerHTML = '<div class="versions-placeholder">Restart the GitLaTeX server to compare commits.</div>';
      return;
    }
    const data = await res.json();
    if (data.error) {
      box.innerHTML = '<div class="versions-placeholder"></div>';
      box.firstChild.textContent = data.error;
      return;
    }
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
    box.innerHTML = '<div class="versions-placeholder">Could not compare commits.</div>';
  }
}

async function openCompareDiff(pair, file) {
  diffSource = "compare";
  const url = "/compare-file?from=" + encodeURIComponent(pair.from.hash) +
    "&to=" + encodeURIComponent(pair.to.hash) +
    "&path=" + encodeURIComponent(file.path) +
    (file.oldPath ? "&oldPath=" + encodeURIComponent(file.oldPath) : "");
  await showDiffFrom(url, file.path,
    formatCommitDate(pair.from.date) + "  →  " + formatCommitDate(pair.to.date));
}

// Shared renderer for a list of changed files.
function renderFileList(container, files, onSelect) {
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

async function toggleCommit(hash, item, filesEl) {
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

function ensureDiffEditor() {
  if (diffEditor || !monacoApi) return diffEditor;
  const host = document.getElementById("diff-editor");
  if (!host) return null;
  diffEditor = monacoApi.editor.createDiffEditor(host, {
    readOnly: true,
    originalEditable: false,
    automaticLayout: true,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
    fontSize: 13,
    minimap: { enabled: false },
    theme: getMonacoTheme()
  });
  return diffEditor;
}

function showDiffMessage(text) {
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

async function openCommitDiff(hash, file, commitInfo) {
  openCommitHash = hash;
  diffSource = "commit";
  const url = "/commit-file?hash=" + encodeURIComponent(hash) +
    "&path=" + encodeURIComponent(file.path) +
    (file.oldPath ? "&oldPath=" + encodeURIComponent(file.oldPath) : "");
  await showDiffFrom(url, file.path,
    (commitInfo.message || "").split("\n")[0] + " · " + formatCommitDate(commitInfo.date));
}

// Loads before/after text from `url` into the side-by-side diff view.
async function showDiffFrom(url, path, meta) {
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
        original: monacoApi.editor.createModel(data.before || "", lang),
        modified: monacoApi.editor.createModel(data.after || "", lang)
      });
    });
  } catch (e) {
    showDiffMessage("Could not load diff: " + (e.message || "network error"));
  }
}

// History changed (push/pull/repo switch) - reload now if visible, else on next open.
function invalidateVersions() {
  versionsLoaded = false;
  if (isVersionsPanelOpen()) loadCommits();
}

function hideDiffView() {
  const pane = document.getElementById("editor-pane");
  const view = document.getElementById("diff-view");
  if (pane) pane.classList.remove("diff-active");
  if (view) {
    view.classList.add("hidden");
    view.setAttribute("aria-hidden", "true");
  }
  openCommitHash = null;
  diffSource = null;
}

function closeGitDropdown() {
  const wrapper = document.getElementById("toolbar-git");
  const btn = document.getElementById("git-dropdown-btn");
  const menu = document.getElementById("git-dropdown-menu");
  if (menu && menu.parentNode === document.body) {
    if (wrapper) wrapper.appendChild(menu);
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.minWidth = "";
    menu.style.display = "";
  }
  if (wrapper) wrapper.classList.remove("open");
  if (btn) btn.setAttribute("aria-expanded", "false");
  if (menu) menu.setAttribute("aria-hidden", "true");
}

function setMenuItemState(btnId, labelId, baseLabel, enabled, label, title) {
  const btn = document.getElementById(btnId);
  const text = document.getElementById(labelId);
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = title || "";
  if (text) text.textContent = label || baseLabel;
}

function setPullState(enabled, label, title) {
  setMenuItemState("git-pull-btn", "git-pull-label", "Pull", enabled, label, title);
}

function setPushState(enabled, label, title) {
  setMenuItemState("git-push-btn", "git-push-label", "Push", enabled, label, title);
}

// Fetches from origin, so only called when the menu is opened.
async function refreshGitMenuState() {
  setPullState(false, "Pull", "Checking for remote changes...");
  setPushState(false, "Push", "Checking for local changes...");
  try {
    if (currentFile) await saveCurrentFile();
    const res = await fetchApi("/remote-status");
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      const msg = "Restart the GitLaTeX server to enable this.";
      setPullState(false, "Pull", msg);
      setPushState(false, "Push", msg);
      return;
    }
    const data = await res.json();
    if (data.error) {
      const msg = "Could not reach remote: " + data.error;
      setPullState(false, "Pull", msg);
      setPushState(false, "Push", msg);
      return;
    }

    if (!data.hasRemote) {
      setPullState(false, "Pull", "This project has no remote.");
    } else if (!data.tracking) {
      setPullState(false, "Pull", "This branch isn't tracking a remote branch.");
    } else if (data.behind > 0) {
      setPullState(true, "Pull (" + data.behind + ")", "Pull " + data.behind + " commit(s) from " + data.tracking);
    } else {
      setPullState(false, "Pull", "Already up to date with " + data.tracking + ".");
    }

    if (!data.hasRemote) {
      setPushState(false, "Push", "This project has no remote.");
    } else if (data.dirty) {
      setPushState(true, "Push", "Commit all changes and push to " + (data.tracking || "origin"));
    } else if (data.ahead > 0) {
      setPushState(true, "Push (" + data.ahead + ")", "Push " + data.ahead + " commit(s) to " + data.tracking);
    } else {
      setPushState(false, "Push", "Nothing to push.");
    }
  } catch (e) {
    const msg = "Could not reach remote: " + (e.message || "network error");
    setPullState(false, "Pull", msg);
    setPushState(false, "Push", msg);
  }
}

function toggleGitDropdown(e) {
  e.stopPropagation();
  const wrapper = document.getElementById("toolbar-git");
  const btn = document.getElementById("git-dropdown-btn");
  const menu = document.getElementById("git-dropdown-menu");
  const wasOpen = wrapper && wrapper.classList.contains("open");
  if (wasOpen) {
    closeGitDropdown();
    return;
  }
  if (!wrapper || !btn || !menu) return;
  const rect = btn.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.left = "auto";
  menu.style.right = (window.innerWidth - rect.right) + "px";
  menu.style.minWidth = Math.max(rect.width, 140) + "px";
  menu.style.display = "block";
  document.body.appendChild(menu);
  wrapper.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  menu.setAttribute("aria-hidden", "false");
  refreshGitMenuState();
}

// ----- Resizable panels -----
const STORAGE_KEYS = { sidebar: "gitlatex-sidebar-width", pdf: "gitlatex-pdf-width", console: "gitlatex-console-height", consoleVisible: "gitlatex-console-visible" };

function px(n) {
  return n + "px";
}

function getView() {
  return document.getElementById("editor-view");
}

function createResizeOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "resize-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:col-resize;pointer-events:auto;";
  return overlay;
}

function setupResizers() {
  const view = getView();
  const sidebar = document.getElementById("sidebar");
  const pdf = document.getElementById("pdf");
  const consoleEl = document.getElementById("console");
  if (!view || !sidebar || !pdf || !consoleEl) return;

  function loadStored() {
    const sw = localStorage.getItem(STORAGE_KEYS.sidebar);
    const pw = localStorage.getItem(STORAGE_KEYS.pdf);
    const ch = localStorage.getItem(STORAGE_KEYS.console);
    if (sw) view.style.setProperty("--sidebar-width", sw);
    if (pw) view.style.setProperty("--pdf-width", pw);
    if (ch) view.style.setProperty("--console-height", ch);
  }
  loadStored();

  function onResizeSidebar(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    view.classList.add("resizing");
    document.getElementById("resizer-sidebar").classList.add("active");
    const overlay = createResizeOverlay();
    overlay.style.cursor = "col-resize";
    document.body.appendChild(overlay);

    function move(e2) {
      const delta = e2.clientX - startX;
      let w = Math.round(startW + delta);
      w = Math.max(160, Math.min(480, w));
      view.style.setProperty("--sidebar-width", px(w));
    }
    function up() {
      view.classList.remove("resizing");
      document.getElementById("resizer-sidebar").classList.remove("active");
      overlay.remove();
      localStorage.setItem(STORAGE_KEYS.sidebar, px(sidebar.offsetWidth));
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function onResizePdf(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = pdf.offsetWidth;
    view.classList.add("resizing");
    document.getElementById("resizer-pdf").classList.add("active");
    const overlay = createResizeOverlay();
    overlay.style.cursor = "col-resize";
    document.body.appendChild(overlay);

    function move(e2) {
      const delta = startX - e2.clientX;
      let w = Math.round(startW + delta);
      w = Math.max(200, Math.min(window.innerWidth - 400, w));
      view.style.setProperty("--pdf-width", px(w));
    }
    function up() {
      view.classList.remove("resizing");
      document.getElementById("resizer-pdf").classList.remove("active");
      overlay.remove();
      localStorage.setItem(STORAGE_KEYS.pdf, px(pdf.offsetWidth));
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function onResizeConsole(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = consoleEl.offsetHeight;
    view.classList.add("resizing");
    document.getElementById("resizer-console").classList.add("active");
    const overlay = createResizeOverlay();
    overlay.style.cursor = "row-resize";
    document.body.appendChild(overlay);

    function move(e2) {
      const delta = startY - e2.clientY;
      let h = Math.round(startH + delta);
      h = Math.max(80, Math.min(window.innerHeight - 200, h));
      view.style.setProperty("--console-height", px(h));
    }
    function up() {
      view.classList.remove("resizing");
      document.getElementById("resizer-console").classList.remove("active");
      overlay.remove();
      localStorage.setItem(STORAGE_KEYS.console, px(consoleEl.offsetHeight));
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  document.getElementById("resizer-sidebar").addEventListener("mousedown", onResizeSidebar);
  document.getElementById("resizer-pdf").addEventListener("mousedown", onResizePdf);
  document.getElementById("resizer-console").addEventListener("mousedown", onResizeConsole);

  const consoleToggle = document.getElementById("console-toggle");
  if (consoleToggle) {
    const stored = localStorage.getItem(STORAGE_KEYS.consoleVisible);
    setConsoleVisible(stored !== "false");
    consoleToggle.addEventListener("click", function () {
      setConsoleVisible(isConsoleHidden());
    });
  }
}

// ----- Init -----
document.documentElement.setAttribute("data-theme", getStoredTheme());
populateMainFileDropdown();
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
document.getElementById("compare-swap")?.addEventListener("click", function () {
  compareOrderSwapped = !compareOrderSwapped;
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
