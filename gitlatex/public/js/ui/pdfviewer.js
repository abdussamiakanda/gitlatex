/**
 * The compiled-PDF pane, drawn with PDF.js's PDFViewer.
 *
 * The browser's own PDF viewer can neither say where it was clicked nor
 * scroll to a spot inside a page, and SyncTeX needs both. PDFViewer also makes
 * links clickable and text selectable, and PDFJumpHistory (from our PDF.js
 * fork) adds marks and a return point on top:
 *
 *   M        mark the selected line, or the line at the top of the view
 *   B        go back to where the last link / Show in PDF jump started
 *   C        go to the previous mark (Shift+C: the next one)
 *
 * The keys only act while the PDF pane has focus. If PDF.js cannot load or
 * parse a file, the pane falls back to the old iframe.
 */

import { getApiBase } from "../core/api.js";
import { state } from "../core/state.js";
import { changedPageOverlay } from "./pdfchanges.js";

//const PDFJS_ROOT = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/";
const PDFJS_ROOT = "https://cdn.jsdelivr.net/gh/revolutionibus/pdf.js@v1.0.1/";
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
const MARKS_KEY = "gitlatex-pdf-marks:";

const view = {
  url: null,
  path: null,       // repo-relative path of the shown PDF, when it has one
  doc: null,
  scale: 1,
  fit: true,
  loadId: 0,
  location: null,   // last "updateviewarea" location, to keep place on a rebuild
  settle: null,     // resolves a showPdf still waiting for its pages
  usingFallback: false,
};

let viewer = null;  // { lib, eventBus, linkService, pdfViewer, jumpHistory }
let viewerPromise = null;
let dblclickHandler = null;

function els() {
  return {
    pane: document.getElementById("pdf"),
    pages: document.getElementById("pdf-pages"),
    scroller: document.getElementById("pdf-scroller"),
    fallback: document.getElementById("pdf-fallback"),
    empty: document.getElementById("pdf-empty"),
    zoomLabel: document.getElementById("pdf-zoom-label"),
    markButton: document.getElementById("pdf-mark-selection"),
  };
}

function loadViewer() {
  if (!viewerPromise) {
    viewerPromise = (async () => {
      const lib = await import(PDFJS_ROOT + "build/pdf.min.mjs");
      // PDF.js wraps a cross-origin worker URL in a same-origin blob itself.
      lib.GlobalWorkerOptions.workerSrc = PDFJS_ROOT + "build/pdf.worker.min.mjs";
      // pdf_viewer.mjs takes the library from this global when it loads.
      globalThis.pdfjsLib = lib;
      const [ui] = await Promise.all([
        import(PDFJS_ROOT + "web/pdf_viewer.mjs"),
        loadStylesheet(PDFJS_ROOT + "web/pdf_viewer.css"),
      ]);
      viewer = createViewer(lib, ui);
      return viewer;
    })();
    // A failed CDN fetch should be retried on the next PDF, not cached forever.
    viewerPromise.catch(() => { viewerPromise = null; });
  }
  return viewerPromise;
}

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = resolve;
    link.onerror = () => { link.remove(); reject(new Error("Could not load " + href)); };
    document.head.appendChild(link);
  });
}

function createViewer(lib, ui) {
  const { scroller, zoomLabel } = els();
  const byId = (id) => document.getElementById(id);
  const eventBus = new ui.EventBus();
  const linkService = new ui.PDFLinkService({ eventBus, externalLinkTarget: ui.LinkTarget.BLANK });
  const pdfViewer = new ui.PDFViewer({
    container: scroller,
    eventBus,
    linkService,
    // The annotation editor listens for paste and drop on the whole page,
    // which would steal them from the rest of the app.
    annotationEditorMode: lib.AnnotationEditorType.DISABLE,
  });
  linkService.setViewer(pdfViewer);
  const jumpHistory = new ui.PDFJumpHistory({
    container: byId("jumpHistory"),
    backButton: byId("jumpHistoryBack"),
    listButton: byId("jumpHistoryList"),
    panel: byId("jumpHistoryPanel"),
    entries: byId("jumpHistoryEntries"),
    saveButton: byId("jumpHistorySave"),
    maxEntriesSelect: byId("jumpHistoryMaxEntries"),
    clearButton: byId("jumpHistoryClear"),
  }, eventBus, pdfViewer);
  // Their labels are data-l10n-ids; the viewer's l10n has the English text.
  pdfViewer.l10n.translate(byId("jumpHistory"));
  pdfViewer.l10n.translate(byId("jumpHistoryPanel"));

  eventBus.on("updateviewarea", ({ location }) => { view.location = location; });
  eventBus.on("scalechanging", ({ scale }) => {
    view.scale = scale;
    if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + "%";
  });
  return { lib, eventBus, linkService, pdfViewer, jumpHistory };
}

/** URL the server serves a repo-relative PDF from. */
export function pdfUrlFor(pdfPath) {
  const base = getApiBase() || "";
  return base + (pdfPath.includes("/") ? "/pdf?path=" + encodeURIComponent(pdfPath) : "/pdf/" + pdfPath);
}

/** Repo-relative path of the PDF on screen, or null (remote or none). */
export function getPdfPath() {
  return view.usingFallback ? null : view.path;
}

/** Called with (pdfPath, page, x, y) in PDF points from the page's top-left. */
export function setPdfDoubleClickHandler(fn) {
  dblclickHandler = fn;
}

/**
 * Shows the PDF at url. path is its repo-relative path when it lives in the
 * project; SyncTeX needs it. Resolves true when PDF.js drew it, false when the
 * iframe fallback took over. options.page selects the cursor page after a build;
 * options.highlightChanges briefly marks visual changes on that page only.
 */
export async function showPdf(url, path = null, options = {}) {
  const requestedPage = Number.isInteger(options.page) && options.page > 0 ? options.page : null;
  const id = ++view.loadId;
  const { empty } = els();
  if (empty) empty.classList.add("hidden");
  let v;
  let doc;
  try {
    v = await loadViewer();
    doc = await v.lib.getDocument({
      url,
      isEvalSupported: false,
      cMapUrl: PDFJS_ROOT + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: PDFJS_ROOT + "standard_fonts/",
    }).promise;
  } catch (e) {
    if (id !== view.loadId) return false;
    console.warn("PDF.js could not show the PDF, using the browser viewer:", e);
    if (requestedPage) {
      const [base, hash = ""] = url.split("#", 2);
      const fragment = new URLSearchParams(hash);
      fragment.set("page", String(requestedPage));
      url = base + "#" + fragment;
    }
    showFallback(url, path);
    return false;
  }
  if (id !== view.loadId) {
    destroyDoc(doc);
    return false;
  }
  const oldDoc = view.doc;
  const sameFile = view.path && view.path === path && !view.usingFallback;
  const page = requestedPage ? Math.min(requestedPage, doc.numPages) : null;
  let overlay = null;
  if (options.highlightChanges && sameFile && page && oldDoc && page <= oldDoc.numPages) {
    try {
      overlay = await changedPageOverlay(await oldDoc.getPage(page), await doc.getPage(page));
    } catch (_) {
      // Rendering/comparison is optional; navigation must still work.
    }
    if (id !== view.loadId) {
      destroyDoc(doc);
      return false;
    }
  }
  // A rebuild of the same file keeps the reader where they were, unless a page was asked for.
  const keep = page ? null : sameFile ? view.location : null;
  const cover = sameFile ? coverPages() : null;
  view.url = url;
  view.path = path;
  view.doc = doc;
  view.usingFallback = false;
  hideFallback();

  const ready = new Promise((resolve) => {
    view.settle = resolve;
    v.eventBus.on("pagesinit", resolve, { once: true });
  });
  v.jumpHistory.reset();
  v.pdfViewer.setDocument(doc);
  v.linkService.setDocument(doc);
  await ready;
  if (oldDoc && oldDoc !== doc) destroyDoc(oldDoc);
  if (id !== view.loadId) {
    if (cover) cover.remove();
    return false;
  }

  const pdfViewer = v.pdfViewer;
  if (view.fit) pdfViewer.currentScaleValue = "page-width";
  else pdfViewer.currentScale = view.scale;
  if (keep) {
    pdfViewer.scrollPageIntoView({
      pageNumber: Math.min(keep.pageNumber, pdfViewer.pagesCount),
      destArray: [null, { name: "XYZ" }, keep.left, keep.top, null],
      allowNegativeOffset: true,
      ignoreDestinationZoom: true,
    });
  }
  if (page) pdfViewer.scrollPageIntoView({ pageNumber: page });
  if (cover) uncoverWhenDrawn(cover, keep ? keep.pageNumber : page || 1);
  if (overlay) {
    pdfViewer.getPageView(page - 1)?.div.appendChild(overlay);
    setTimeout(() => overlay.remove(), 3000);
  }
  v.jumpHistory.initialize(path ? marksStore(path) : null, path ? path.split("/").pop() : "document.pdf");
  return true;
}

// PDF.js 6 frees a document through the task that loaded it.
function destroyDoc(doc) {
  doc.loadingTask.destroy();
}

/**
 * Marks are kept per project and PDF, so they outlive a recompile or reload.
 * PDFJumpHistory only needs these two methods of PDF.js's ViewHistory.
 */
function marksStore(path) {
  const key = MARKS_KEY + (state.currentRepo || "") + ":" + path;
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch (_) {
      return {};
    }
  };
  return {
    async getMultiple(defaults) {
      return { ...defaults, ...read() };
    },
    async setMultiple(values) {
      try {
        localStorage.setItem(key, JSON.stringify({ ...read(), ...values }));
      } catch (_) {}
    },
  };
}

/**
 * setDocument drops every page at once. Until the new ones are drawn, a still
 * copy of the old ones sits on top so a recompile does not flash blank pages.
 */
function coverPages() {
  const { pane, scroller } = els();
  if (!scroller || !scroller.clientWidth || !scroller.clientHeight) return null;
  const dpr = window.devicePixelRatio || 1;
  const box = scroller.getBoundingClientRect();
  const cover = document.createElement("canvas");
  cover.className = "pdf-cover";
  cover.width = Math.floor(scroller.clientWidth * dpr);
  cover.height = Math.floor(scroller.clientHeight * dpr);
  cover.style.width = scroller.clientWidth + "px";
  cover.style.height = scroller.clientHeight + "px";
  const ctx = cover.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(pane).backgroundColor;
  ctx.fillRect(0, 0, scroller.clientWidth, scroller.clientHeight);
  scroller.querySelectorAll(".page canvas").forEach((canvas) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || r.bottom < box.top || r.top > box.bottom) return;
    ctx.drawImage(canvas, r.left - box.left, r.top - box.top, r.width, r.height);
  });
  scroller.after(cover);
  return cover;
}

function uncoverWhenDrawn(cover, pageNumber) {
  const onRendered = (e) => { if (e.pageNumber === pageNumber) done(); };
  const done = () => {
    clearTimeout(timer);
    viewer.eventBus.off("pagerendered", onRendered);
    cover.remove();
  };
  const timer = setTimeout(done, 2000);
  viewer.eventBus.on("pagerendered", onRendered);
}

// Project PDFs the empty viewer offers, and what picking one does.
let choices = { paths: [], onPick: null };

/** Sets the PDFs listed while nothing is shown (none: "Compile to see..."). */
export function setPdfChoices(paths, onPick) {
  choices = { paths: paths || [], onPick };
  renderEmpty();
}

function renderEmpty() {
  const { empty } = els();
  if (!empty) return;
  empty.textContent = "";
  const message = document.createElement("div");
  empty.appendChild(message);
  if (!choices.paths.length) {
    message.textContent = "Compile to see the PDF here.";
    return;
  }
  message.textContent = "Compile, or pick a PDF from this project:";
  const list = document.createElement("div");
  list.className = "pdf-empty-list";
  choices.paths.forEach((path) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pdf-empty-item";
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-file-pdf";
    const name = document.createElement("span");
    name.textContent = path;
    btn.append(icon, name);
    btn.addEventListener("click", () => { if (choices.onPick) choices.onPick(path); });
    list.appendChild(btn);
  });
  empty.appendChild(list);
}

/** Empties the viewer, e.g. when another project is opened. */
export function clearPdf() {
  choices = { paths: [], onPick: null };
  renderEmpty();
  view.loadId++;   // a load still in flight lands nowhere
  if (view.settle) view.settle();
  if (viewer) {
    viewer.jumpHistory.reset();
    viewer.pdfViewer.setDocument(null);
    viewer.linkService.setDocument(null);
  }
  if (view.doc) destroyDoc(view.doc);
  view.url = view.path = view.doc = view.location = null;
  view.usingFallback = false;
  hideFallback();
  hideMarkButton();
  const { empty } = els();
  if (empty) empty.classList.remove("hidden");
}

function showFallback(url, path) {
  const { pages, fallback } = els();
  view.usingFallback = true;
  view.url = url;
  view.path = path;
  if (viewer) viewer.jumpHistory.reset();
  hideMarkButton();
  if (pages) pages.classList.add("hidden");
  if (fallback) {
    fallback.classList.remove("hidden");
    fallback.src = url;
  }
}

function hideFallback() {
  const { pages, fallback } = els();
  if (fallback) {
    fallback.classList.add("hidden");
    fallback.removeAttribute("src");
  }
  if (pages) pages.classList.remove("hidden");
}

function hasPdf() {
  return !!(viewer && view.doc && !view.usingFallback);
}

function clampScale(s) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

export function zoomPdf(direction) {
  if (!hasPdf()) return;
  const current = viewer.pdfViewer.currentScale;
  view.fit = false;
  viewer.pdfViewer.currentScale = clampScale(direction > 0 ? current * ZOOM_STEP : current / ZOOM_STEP);
}

export function fitPdfWidth() {
  view.fit = true;
  if (hasPdf()) viewer.pdfViewer.currentScaleValue = "page-width";
}

/**
 * Scrolls to SyncTeX boxes ({page, h, v, W, H}, PDF points, v = baseline)
 * and flashes them. Only boxes on the first box's page are marked.
 */
export function revealPdfBoxes(boxes) {
  if (!hasPdf() || !boxes || !boxes.length) return false;
  const { scroller } = els();
  const pageNo = boxes[0].page;
  const pageView = viewer.pdfViewer.getPageView(pageNo - 1);
  if (!scroller || !pageView || !pageView.div) return false;
  const s = pageView.viewport.scale;
  const onPage = boxes.filter(b => b.page === pageNo);
  const top = Math.min(...onPage.map(b => b.v - (b.H || 12)));
  const left = Math.min(...onPage.map(b => b.h));
  // Show in PDF is a jump too, so B comes back from it.
  viewer.eventBus.dispatch("beforenavigate", { source: null, pageNumber: pageNo });
  const div = pageView.div;
  const origin = pageOrigin(div);
  scroller.scrollTop = origin.top + top * s - scroller.clientHeight / 3;
  if (div.offsetWidth > scroller.clientWidth) {
    scroller.scrollLeft = origin.left + left * s - 40;
  }
  onPage.forEach((b) => {
    const h = b.H > 0 ? b.H : 12;
    const w = b.W > 0 ? b.W : pageView.viewport.width / s - b.h;
    const mark = document.createElement("div");
    mark.className = "pdf-sync-mark";
    mark.style.left = b.h * s + "px";
    mark.style.top = (b.v - h) * s + "px";
    mark.style.width = w * s + "px";
    mark.style.height = Math.max(h * s, 4) + "px";
    div.appendChild(mark);
    mark.addEventListener("animationend", () => mark.remove());
  });
  return true;
}

/** Top-left of a page's content, in the scroller's scroll coordinates. */
function pageOrigin(div) {
  const { scroller } = els();
  const page = div.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  return {
    top: page.top - box.top + scroller.scrollTop + div.clientTop,
    left: page.left - box.left + scroller.scrollLeft + div.clientLeft,
  };
}

/** The selection, when it is text on a PDF page. */
function pdfSelectionRange() {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return el && el.closest("#pdf-scroller .textLayer") ? range : null;
}

/** Floats "Mark line" under a text selection on a page. */
function showMarkButton() {
  const { pages, markButton } = els();
  const range = hasPdf() ? pdfSelectionRange() : null;
  if (!markButton || !range) {
    hideMarkButton();
    return;
  }
  const rect = [...range.getClientRects()].filter(r => r.width && r.height).pop();
  if (!rect) return;
  const box = pages.getBoundingClientRect();
  markButton.hidden = false;
  const maxLeft = pages.clientWidth - markButton.offsetWidth - 8;
  markButton.style.left = Math.max(8, Math.min(rect.right - box.left - markButton.offsetWidth / 2, maxLeft)) + "px";
  markButton.style.top = Math.min(rect.bottom - box.top + 6, pages.clientHeight - markButton.offsetHeight - 8) + "px";
}

function hideMarkButton() {
  const { markButton } = els();
  if (markButton) markButton.hidden = true;
}

function markSelectionOrView() {
  const jumpHistory = viewer.jumpHistory;
  if (pdfSelectionRange()) jumpHistory.markSelection();
  else jumpHistory.markCurrentPosition();
  hideMarkButton();
}

function onKeyDown(e) {
  if (!hasPdf() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest("input, select, textarea, [contenteditable]")) return;
  const jumpHistory = viewer.jumpHistory;
  const key = e.key.toLowerCase();
  if (key === "m" && !e.shiftKey) markSelectionOrView();
  else if (key === "b" && !e.shiftKey && jumpHistory.canReturn) jumpHistory.toggleReturn();
  else if (key === "c" && jumpHistory.hasMarks) {
    if (e.shiftKey) jumpHistory.cycleForward();
    else jumpHistory.cycleBack();
  } else return;
  e.preventDefault();
}

/** Binds the zoom buttons, double-click, shortcuts and fit-on-resize. Call once. */
export function initPdfViewer() {
  const { pane, scroller, markButton } = els();
  if (!scroller) return;
  document.getElementById("pdf-zoom-in")?.addEventListener("click", () => zoomPdf(1));
  document.getElementById("pdf-zoom-out")?.addEventListener("click", () => zoomPdf(-1));
  document.getElementById("pdf-fit-width")?.addEventListener("click", fitPdfWidth);

  scroller.addEventListener("dblclick", (e) => {
    const pageDiv = e.target.closest(".page");
    if (!pageDiv || !dblclickHandler || !hasPdf()) return;
    const pageNumber = Number(pageDiv.dataset.pageNumber);
    const pageView = viewer.pdfViewer.getPageView(pageNumber - 1);
    if (!pageView) return;
    e.preventDefault();
    // A double-click on the text layer also selects a word; drop it.
    document.getSelection()?.removeAllRanges();
    const rect = pageDiv.getBoundingClientRect();
    const s = pageView.viewport.scale;
    const x = (e.clientX - rect.left - pageDiv.clientLeft) / s;
    const y = (e.clientY - rect.top - pageDiv.clientTop) / s;
    dblclickHandler(getPdfPath(), pageNumber, x, y);
  });

  pane.addEventListener("keydown", onKeyDown);
  scroller.addEventListener("pointerup", () => setTimeout(showMarkButton, 0));
  scroller.addEventListener("scroll", hideMarkButton, { passive: true });
  document.addEventListener("selectionchange", () => { if (!pdfSelectionRange()) hideMarkButton(); });
  if (markButton) {
    // Keep the selection, which a click would otherwise clear first.
    markButton.addEventListener("mousedown", (e) => e.preventDefault());
    markButton.addEventListener("click", () => { if (hasPdf()) markSelectionOrView(); });
  }

  // Fit-width follows the pane when the resizer or window changes it.
  let resizeTimer = null;
  let lastWidth = scroller.clientWidth;
  new ResizeObserver(() => {
    if (scroller.clientWidth === lastWidth) return;
    lastWidth = scroller.clientWidth;
    if (!view.fit) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitPdfWidth, 150);
  }).observe(scroller);
}
