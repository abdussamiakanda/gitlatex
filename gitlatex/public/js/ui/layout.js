/**
 * Resizable sidebar, PDF pane and console, with sizes remembered.
 */

import { isConsoleHidden, setConsoleVisible } from "./consolepane.js";

export function toggleSidebar() {
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

// ----- Resizable panels -----
export const STORAGE_KEYS = { sidebar: "gitlatex-sidebar-width", pdf: "gitlatex-pdf-width", console: "gitlatex-console-height", consoleVisible: "gitlatex-console-visible", versions: "gitlatex-versions-width" };

export function px(n) {
  return n + "px";
}

export function getView() {
  return document.getElementById("editor-view");
}

export function createResizeOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "resize-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:col-resize;pointer-events:auto;";
  return overlay;
}

export function setupResizers() {
  const view = getView();
  const sidebar = document.getElementById("sidebar");
  const pdf = document.getElementById("pdf");
  const consoleEl = document.getElementById("console");
  const versions = document.getElementById("versions-panel");
  if (!view || !sidebar || !pdf || !consoleEl) return;

  function loadStored() {
    const sw = localStorage.getItem(STORAGE_KEYS.sidebar);
    const pw = localStorage.getItem(STORAGE_KEYS.pdf);
    const ch = localStorage.getItem(STORAGE_KEYS.console);
    const vw = localStorage.getItem(STORAGE_KEYS.versions);
    if (sw) view.style.setProperty("--sidebar-width", sw);
    if (pw) view.style.setProperty("--pdf-width", pw);
    if (ch) view.style.setProperty("--console-height", ch);
    if (vw) view.style.setProperty("--versions-width", vw);
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

  // Drags from the panel's left edge, so moving left widens it - same
  // direction as the PDF pane.
  function onResizeVersions(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = versions.offsetWidth;
    view.classList.add("resizing");
    document.getElementById("resizer-versions").classList.add("active");
    const overlay = createResizeOverlay();
    overlay.style.cursor = "col-resize";
    document.body.appendChild(overlay);

    function move(e2) {
      const delta = startX - e2.clientX;
      let w = Math.round(startW + delta);
      w = Math.max(220, Math.min(window.innerWidth - 400, w));
      view.style.setProperty("--versions-width", px(w));
    }
    function up() {
      view.classList.remove("resizing");
      document.getElementById("resizer-versions").classList.remove("active");
      overlay.remove();
      localStorage.setItem(STORAGE_KEYS.versions, px(versions.offsetWidth));
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
  if (versions) {
    document.getElementById("resizer-versions")?.addEventListener("mousedown", onResizeVersions);
  }

  const consoleToggle = document.getElementById("console-toggle");
  if (consoleToggle) {
    const stored = localStorage.getItem(STORAGE_KEYS.consoleVisible);
    setConsoleVisible(stored !== "false");
    consoleToggle.addEventListener("click", function () {
      setConsoleVisible(isConsoleHidden());
    });
  }
}
