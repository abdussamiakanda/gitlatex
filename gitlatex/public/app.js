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
  return t === "light" ? "vs" : "vs-dark";
}

function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {}
  applyTheme(theme);
  if (monacoApi && editor) {
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

function populateSettings() {
  const input = document.getElementById("settings-compiler-api");
  if (input) input.value = getStoredCompilerApi();
  const keyInput = document.getElementById("settings-compiler-api-key");
  if (keyInput) keyInput.value = getStoredCompilerApiKey();
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

async function populateSettingsTechInfo() {
  const versionEl = document.getElementById("settings-info-version");
  const urlEl = document.getElementById("settings-info-url");
  const repoEl = document.getElementById("settings-info-repo");
  const pypiEl = document.getElementById("settings-info-pypi");
  if (urlEl && typeof window !== "undefined" && window.location) urlEl.textContent = window.location.origin;
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
}

function setConsole(text) {
  const el = document.getElementById("console");
  if (!el) return;
  el.textContent = text || "";
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
    // Word pattern so that "\" and "\section" are "words" for suggest filtering (prefix matches our filterText "\\" + label)
    monaco.languages.setLanguageConfiguration("latex", {
      wordPattern: /\\[a-zA-Z*]*/
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
    const toolbarGit = document.getElementById("toolbar-git");
    if (toolbarGit) toolbarGit.style.display = (data.hasGit === true) ? "" : "none";
  } catch (e) {
    setConsole("Failed to open repo: " + (e.message || "Network error"));
    return;
  }
  currentRepo = decoded;
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

function renderFileTree(files, container, basePath = "", activePath = null, selectedFolderPath = null) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  const currentFile = activePath;
  function makeRow(name, fullPath, isFolder) {
    const row = document.createElement("span");
    row.className = "sidebar-item-row";
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
          const lang = path.endsWith(".tex") ? "latex" : path.endsWith(".bib") ? "bib" : "plaintext";
          monacoApi.editor.setModelLanguage(model, lang);
        }
      }
    }
    if (path.toLowerCase().endsWith(".tex")) {
      const pdfPath = path.replace(/\.tex$/i, ".pdf");
      const base = getApiBase() || "";
      const pdfUrl = base + (pdfPath.includes("/") ? "/pdf?path=" + encodeURIComponent(pdfPath) : "/pdf/" + pdfPath);
      const pdfEl = document.getElementById("pdf");
      if (pdfEl) {
        fetch(pdfUrl, { method: "HEAD" })
          .then((r) => {
            if (r.ok) pdfEl.src = pdfUrl;
            else pdfEl.removeAttribute("src");
          })
          .catch(() => pdfEl.removeAttribute("src"));
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

async function compile() {
  if (currentFile && currentFile.endsWith(".tex")) await saveCurrentFile();
  const mainFile = (currentFile && currentFile.endsWith(".tex")) ? currentFile : "main.tex";
  const compilerApi = getStoredCompilerApi();
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
        body: JSON.stringify({ main: mainFile, files })
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
        body: JSON.stringify({ main: mainFile })
      });
      let data = {};
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        setConsole("Compile failed: Server returned invalid JSON (status " + res.status + "). Is the backend running?");
        return;
      }
      if (data.success && data.pdf) {
        document.getElementById("pdf").src = (getApiBase() || "") + data.pdf;
        setConsole("Compiled " + mainFile + " successfully.");
      } else if (data.error) {
        setConsole("Compile error:\n" + data.error);
      } else {
        setConsole("Compile failed: " + (res.statusText || res.status || "Unknown error"));
      }
    }
  } catch (e) {
    const hint = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "http://localhost:5000";
    setConsole("Compile failed: " + (e.message || "Network error") + ". Check that a repo is selected and the server is running at " + hint + ".");
  } finally {
    setCompileLoading(false);
  }
}

function ensureConsoleVisible() {
  const view = document.getElementById("editor-view");
  if (!view || !view.classList.contains("console-hidden")) return;
  view.classList.remove("console-hidden");
  localStorage.setItem(STORAGE_KEYS.consoleVisible, "true");
  const consoleToggle = document.getElementById("console-toggle");
  if (consoleToggle) {
    consoleToggle.setAttribute("title", "Hide console");
    consoleToggle.setAttribute("aria-label", "Hide console");
  }
}

async function showCompileErrors() {
  ensureConsoleVisible();
  try {
    const res = await fetchApi("/compile-error");
    const data = await res.json();
    setConsole(data.error ? "Last compile error:\n" + data.error : "No compile errors stored.");
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

async function commit() {
  if (currentFile) await saveCurrentFile();
  const message = await showInputModal({
    title: "Commit",
    label: "Commit message",
    placeholder: "Your commit message",
    submitLabel: "Commit"
  });
  if (!message) return;
  try {
    const res = await fetchApi("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    setConsole(data.error ? "Commit error: " + data.error : 'Committed (no push).');
  } catch (e) {
    setConsole("Commit failed: " + (e.message || ""));
  }
}

async function pushChanges() {
  try {
    const res = await fetchApi("/push", { method: "POST" });
    const data = await res.json();
    setConsole(data.error ? "Push error: " + data.error : "Pushed to remote.");
  } catch (e) {
    setConsole("Push failed: " + (e.message || ""));
  }
}

async function showStatus() {
  ensureConsoleVisible();
  try {
    const res = await fetchApi("/status");
    const data = await res.json();
    setConsole(data.error ? "Status error: " + data.error : "Git status:\n" + JSON.stringify(data.status, null, 2));
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

async function showDiff() {
  ensureConsoleVisible();
  try {
    const res = await fetchApi("/diff");
    const data = await res.json();
    setConsole(data.error ? "Diff error: " + data.error : "Git diff:\n" + (data.diff || "(no diff)"));
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
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
    if (stored === "false") view.classList.add("console-hidden");
    function updateConsoleToggleLabel() {
      const hidden = view.classList.contains("console-hidden");
      consoleToggle.setAttribute("title", hidden ? "Show console" : "Hide console");
      consoleToggle.setAttribute("aria-label", hidden ? "Show console" : "Hide console");
    }
    updateConsoleToggleLabel();
    consoleToggle.addEventListener("click", function () {
      view.classList.toggle("console-hidden");
      localStorage.setItem(STORAGE_KEYS.consoleVisible, view.classList.contains("console-hidden") ? "false" : "true");
      updateConsoleToggleLabel();
    });
  }
}

// ----- Init -----
document.documentElement.setAttribute("data-theme", getStoredTheme());

document.addEventListener("click", function (e) {
  const opt = e.target.closest(".theme-option");
  if (opt) {
    const theme = opt.getAttribute("data-theme");
    if (theme) setTheme(theme);
  }
});

document.getElementById("settings-compiler-api")?.addEventListener("change", function () {
  setCompilerApi(this.value);
});
document.getElementById("settings-compiler-api")?.addEventListener("blur", function () {
  setCompilerApi(this.value);
});
document.getElementById("settings-compiler-api-key")?.addEventListener("change", function () {
  setCompilerApiKey(this.value);
});
document.getElementById("settings-compiler-api-key")?.addEventListener("blur", function () {
  setCompilerApiKey(this.value);
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
});
