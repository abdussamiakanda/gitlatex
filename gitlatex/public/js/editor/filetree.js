/**
 * The sidebar file tree: icons, drag and drop, and create/delete/upload.
 */

import { state } from "../core/state.js";
import { fetchJson } from "../core/api.js";
import { loadFile, loadFiles } from "./session.js";
import { setConsole } from "../ui/consolepane.js";
import { showConfirmModal, showInputModal } from "../ui/modals.js";
import { showEditorPane } from "../ui/viewer.js";

// Folders the user has collapsed, so the tree keeps its shape across the
// re-renders that follow every create/delete/move. Only this module cares.
const collapsedFolderPaths = new Set();

export const FILE_KINDS = [
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

export function fileKind(name) {
  const lower = (name || "").toLowerCase();
  for (const k of FILE_KINDS) {
    if (k.ext.some(e => lower.endsWith(e))) return k;
  }
  return { icon: "fa-regular fa-file", kind: "other" };
}

// Font Awesome has no glyph for LaTeX or EPS, so those use an inline
// page-with-folded-corner icon carrying a short label. Same 16px box and
// stroke weight as the FA icons, so nothing looks out of place.
export const DOC_PATH = "M9.3 1.6H4.6a1.5 1.5 0 0 0-1.5 1.5v9.8a1.5 1.5 0 0 0 1.5 1.5h6.8" +
  "a1.5 1.5 0 0 0 1.5-1.5V5.2L9.3 1.6Z";

export function labelledDocSvg(label) {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">' +
    '<path d="' + DOC_PATH + '" fill="currentColor" fill-opacity=".16"/>' +
    '<path d="' + DOC_PATH + '" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M9.1 1.7v2.6c0 .6.4 1 1 1h2.6" stroke="currentColor" stroke-width="1.1" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
    '<text class="doc-label" x="8" y="12.2" text-anchor="middle" font-size="4.8" ' +
      'font-weight="700" font-family="Georgia, \'Times New Roman\', serif">' + label + '</text>' +
  '</svg>';
}

export const DOC_LABELS = { tex: "TEX", vector: "EPS", svg: "SVG" };

export function makeFileIcon(name) {
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

export function renderFileTree(files, container, basePath = "", activePath = null, selectedFolderPath = null) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  const activeFilePath = activePath;
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
          state.currentFolderPath = fullPath;
          container.querySelectorAll("li.folder").forEach(el => el.classList.toggle("selected", el.dataset.path === fullPath));
          container.querySelectorAll("li.file").forEach(el => el.classList.remove("active"));
        });
      } else {
        li.classList.add("file");
        li.dataset.path = fullPath;
        if (activeFilePath === fullPath && !selectedFolderPath) li.classList.add("active");
        if (node.name.endsWith(".tex")) li.classList.add("tex-file");
        const row = makeRow(node.name, fullPath, false);
        li.appendChild(row);
        setupDragSource(li, fullPath, false);
        row.addEventListener("click", () => {
          state.currentFolderPath = null;
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

export async function moveSidebarItem(fromPath, toPath) {
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
    if (state.currentFile === fromPath) {
      state.currentFile = newPath;
      loadFile(newPath);
    }
    if (state.currentFolderPath === fromPath || (state.currentFolderPath && fromPath.startsWith(state.currentFolderPath + "/"))) {
      state.currentFolderPath = newPath.startsWith(state.currentFolderPath + "/") ? state.currentFolderPath : null;
    }
    await loadFiles();
    setConsole("Moved " + fromPath + " → " + newPath);
  } catch (e) {
    setConsole("Move failed: " + (e.message || ""));
  }
}

export async function deleteSidebarItem(path, isFolder) {
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
    if (state.currentFile === path) {
      state.currentFile = null;
      showEditorPane();
      if (state.editor) {
        state.editor.setValue("");
        if (state.monacoApi) {
          const model = state.editor.getModel();
          if (model) state.monacoApi.editor.setModelLanguage(model, "latex");
        }
      }
    }
    if (state.currentFolderPath === path || (state.currentFolderPath && path.startsWith(state.currentFolderPath + "/"))) {
      state.currentFolderPath = null;
    }
    await loadFiles();
    setConsole("Deleted " + path);
  } catch (e) {
    setConsole("Delete failed: " + (e.message || ""));
  }
}

export function findFirstTexFile(files, basePath = "") {
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

export function getSidebarTreeEl() {
  return document.getElementById("sidebar-tree");
}

export async function addNewFileSidebar() {
  const prefix = state.currentFolderPath ? state.currentFolderPath + "/" : "";
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

export async function addNewFolderSidebar() {
  const prefix = state.currentFolderPath ? state.currentFolderPath + "/" : "";
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

export function uploadFilesSidebar() {
  const input = document.getElementById("sidebar-file-input");
  if (!input) return;
  input.value = "";
  input.click();
}

export async function handleSidebarFileInputChange(e) {
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
    const basePath = state.currentFolderPath ? state.currentFolderPath + "/" : "";
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
