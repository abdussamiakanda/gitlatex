/**
 * Choosing which .tex file the Compile button builds.
 */

import { state } from "../core/state.js";

export function mainFileKey() {
  return state.currentRepo ? "gitlatex-mainfile:" + state.currentRepo : null;
}

export function getMainFile() {
  const key = mainFileKey();
  if (!key) return "";
  try {
    return localStorage.getItem(key) || "";
  } catch (_) {}
  return "";
}

/** The one place the toolbar label is written, so an empty project cannot be
 *  left advertising a file it does not have. */
function setMainFileLabel(path) {
  const label = document.getElementById("mainfile-label");
  if (!label) return;
  label.textContent = path || "No .tex file";
  label.classList.toggle("mainfile-label-empty", !path);
}

export function setMainFile(path) {
  const key = mainFileKey();
  if (key) {
    try {
      if (path) localStorage.setItem(key, path);
      else localStorage.removeItem(key);
    } catch (_) {}
  }
  setMainFileLabel(path);
}

export function collectTexFiles(files, basePath) {
  const list = [];
  for (const node of files || []) {
    const fullPath = basePath ? basePath + "/" + node.name : node.name;
    if (node.type === "file" && node.name.endsWith(".tex")) list.push(fullPath);
    else if (node.type === "folder" && node.children) list.push.apply(list, collectTexFiles(node.children, fullPath));
  }
  return list;
}

export function populateMainFileDropdown() {
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

export function openMainFileDropdown() {
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

export function closeMainFileDropdown() {
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

export async function refreshMainFileDropdown(files) {
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
  setMainFileLabel(selected);
}
