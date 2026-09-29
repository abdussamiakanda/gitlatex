/**
 * The compiled-PDF pane, drawn with PDF.js.
 *
 * The browser's own PDF viewer can neither say where it was clicked nor
 * scroll to a spot inside a page, and SyncTeX needs both. Pages are drawn
 * lazily as they scroll into view and dropped again once far away, so long
 * documents stay cheap. If PDF.js cannot load or parse a file, the pane falls
 * back to the old iframe.
 */

import { getApiBase } from "../core/api.js";

const PDFJS_ROOT = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/";
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
// Matches the .pdf-pages-inner padding, so fit-width leaves an even margin.
const PAGE_PADDING = 12;

const view = {
  url: null,
  path: null,       // repo-relative path of the shown PDF, when it has one
  doc: null,
  pages: [],        // PDFPageProxy per page
  entries: [],      // { page, viewport, div, canvas, task } per page
  scale: 1,
  fit: true,
  loadId: 0,
  observer: null,
  usingFallback: false,
};

let pdfjsPromise = null;
let dblclickHandler = null;

function els() {
  return {
    pane: document.getElementById("pdf"),
    scroller: document.getElementById("pdf-pages"),
    fallback: document.getElementById("pdf-fallback"),
    empty: document.getElementById("pdf-empty"),
    zoomLabel: document.getElementById("pdf-zoom-label"),
  };
}

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_ROOT + "build/pdf.min.mjs").then((lib) => {
      // PDF.js wraps a cross-origin worker URL in a same-origin blob itself.
      lib.GlobalWorkerOptions.workerSrc = PDFJS_ROOT + "build/pdf.worker.min.mjs";
      return lib;
    });
    // A failed CDN fetch should be retried on the next PDF, not cached forever.
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
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
 * iframe fallback took over.
 */
export async function showPdf(url, path = null) {
  const id = ++view.loadId;
  const { empty } = els();
  if (empty) empty.classList.add("hidden");
  let doc;
  let pages;
  try {
    const lib = await loadPdfJs();
    doc = await lib.getDocument({
      url,
      isEvalSupported: false,
      cMapUrl: PDFJS_ROOT + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: PDFJS_ROOT + "standard_fonts/",
    }).promise;
    pages = [];
    for (let n = 1; n <= doc.numPages; n++) pages.push(await doc.getPage(n));
  } catch (e) {
    if (doc) doc.destroy();
    if (id !== view.loadId) return false;
    console.warn("PDF.js could not show the PDF, using the browser viewer:", e);
    showFallback(url, path);
    return false;
  }
  if (id !== view.loadId) {
    doc.destroy();
    return false;
  }
  const oldDoc = view.doc;
  const sameFile = view.path && view.path === path && !view.usingFallback;
  view.url = url;
  view.path = path;
  view.doc = doc;
  view.pages = pages;
  view.usingFallback = false;
  hideFallback();
  const scale = view.fit ? fitScale() : view.scale;
  // A rebuild of the same file keeps the reader where they were.
  const { scroller } = els();
  const keep = sameFile && scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : { top: 0, left: 0 };
  await mountPages(scale, keep, id);
  if (oldDoc && oldDoc !== doc) oldDoc.destroy();
  return true;
}

function showFallback(url, path) {
  const { scroller, fallback } = els();
  view.usingFallback = true;
  view.url = url;
  view.path = path;
  if (scroller) scroller.classList.add("hidden");
  if (fallback) {
    fallback.classList.remove("hidden");
    fallback.src = url;
  }
}

function hideFallback() {
  const { scroller, fallback } = els();
  if (fallback) {
    fallback.classList.add("hidden");
    fallback.removeAttribute("src");
  }
  if (scroller) scroller.classList.remove("hidden");
}

function fitScale() {
  const { scroller } = els();
  if (!scroller || !view.pages.length) return 1;
  const width = view.pages[0].getViewport({ scale: 1 }).width;
  const avail = Math.max(scroller.clientWidth - 2 * PAGE_PADDING, 100);
  return clampScale(avail / width);
}

function clampScale(s) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

/**
 * Lays out every page at scale. The new layout is built hidden on top of the
 * old one and the visible pages are drawn before the swap, so a recompile or
 * zoom does not flash blank pages.
 */
async function mountPages(scale, keep, id) {
  const { scroller, zoomLabel } = els();
  if (!scroller) return;
  const inner = document.createElement("div");
  inner.className = "pdf-pages-inner staging";
  const entries = view.pages.map((page, i) => {
    const viewport = page.getViewport({ scale });
    const div = document.createElement("div");
    div.className = "pdf-page";
    div.dataset.page = String(i + 1);
    div.style.width = viewport.width + "px";
    div.style.height = viewport.height + "px";
    inner.appendChild(div);
    return { page, viewport, div, canvas: null, task: null };
  });
  scroller.appendChild(inner);

  const top = keep.top;
  const bottom = top + scroller.clientHeight;
  await Promise.all(entries
    .filter(e => e.div.offsetTop < bottom && e.div.offsetTop + e.div.offsetHeight > top)
    .map(renderEntry));
  if (id !== view.loadId) {
    inner.remove();
    return;
  }

  if (view.observer) view.observer.disconnect();
  view.entries.forEach(cancelEntry);
  scroller.querySelectorAll(".pdf-pages-inner:not(.staging)").forEach(el => el.remove());
  inner.classList.remove("staging");
  view.entries = entries;
  view.scale = scale;
  scroller.scrollTop = keep.top;
  scroller.scrollLeft = keep.left;
  if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + "%";

  // Draw pages near the viewport, forget the ones far from it.
  view.observer = new IntersectionObserver((items) => {
    items.forEach((item) => {
      const entry = view.entries[Number(item.target.dataset.page) - 1];
      if (!entry) return;
      if (item.isIntersecting) renderEntry(entry);
      else cancelEntry(entry);
    });
  }, { root: scroller, rootMargin: "100% 0px" });
  entries.forEach(e => view.observer.observe(e.div));
}

function renderEntry(entry) {
  if (entry.canvas) return Promise.resolve();
  if (entry.task) return entry.task.promise.catch(() => {});
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = entry.viewport;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  const task = entry.page.render({
    canvasContext: canvas.getContext("2d"),
    viewport: entry.viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  });
  entry.task = task;
  return task.promise.then(() => {
    if (entry.task !== task) return;
    entry.task = null;
    entry.canvas = canvas;
    entry.div.prepend(canvas);
  }).catch(() => {
    if (entry.task === task) entry.task = null;
  });
}

function cancelEntry(entry) {
  if (entry.task) {
    entry.task.cancel();
    entry.task = null;
  }
  if (entry.canvas) {
    entry.canvas.remove();
    // Frees the backing store now rather than whenever GC gets to it.
    entry.canvas.width = entry.canvas.height = 0;
    entry.canvas = null;
  }
}

function rescale(scale, fit) {
  if (!view.doc || view.usingFallback) return;
  const { scroller } = els();
  if (!scroller) return;
  const next = clampScale(scale);
  const ratio = next / view.scale;
  view.fit = fit;
  // Keep the point at the top-left of the viewport in place.
  const keep = { top: scroller.scrollTop * ratio, left: scroller.scrollLeft * ratio };
  if (Math.abs(ratio - 1) < 0.001) return;
  mountPages(next, keep, view.loadId);
}

export function zoomPdf(direction) {
  rescale(direction > 0 ? view.scale * ZOOM_STEP : view.scale / ZOOM_STEP, false);
}

export function fitPdfWidth() {
  view.fit = true;
  rescale(fitScale(), true);
}

/**
 * Scrolls to SyncTeX boxes ({page, h, v, W, H}, PDF points, v = baseline)
 * and flashes them. Only boxes on the first box's page are marked.
 */
export function revealPdfBoxes(boxes) {
  if (view.usingFallback || !boxes || !boxes.length) return false;
  const { scroller } = els();
  const pageNo = boxes[0].page;
  const entry = view.entries[pageNo - 1];
  if (!scroller || !entry) return false;
  const s = view.scale;
  const onPage = boxes.filter(b => b.page === pageNo);
  const top = Math.min(...onPage.map(b => b.v - (b.H || 12)));
  const left = Math.min(...onPage.map(b => b.h));
  scroller.scrollTop = entry.div.offsetTop + top * s - scroller.clientHeight / 3;
  if (entry.div.offsetWidth > scroller.clientWidth) {
    scroller.scrollLeft = entry.div.offsetLeft + left * s - 40;
  }
  onPage.forEach((b) => {
    const h = b.H > 0 ? b.H : 12;
    const w = b.W > 0 ? b.W : entry.viewport.width / s - b.h;
    const mark = document.createElement("div");
    mark.className = "pdf-sync-mark";
    mark.style.left = b.h * s + "px";
    mark.style.top = (b.v - h) * s + "px";
    mark.style.width = w * s + "px";
    mark.style.height = Math.max(h * s, 4) + "px";
    entry.div.appendChild(mark);
    mark.addEventListener("animationend", () => mark.remove());
  });
  return true;
}

/** Binds the zoom buttons, double-click and fit-on-resize. Call once. */
export function initPdfViewer() {
  const { scroller } = els();
  if (!scroller) return;
  document.getElementById("pdf-zoom-in")?.addEventListener("click", () => zoomPdf(1));
  document.getElementById("pdf-zoom-out")?.addEventListener("click", () => zoomPdf(-1));
  document.getElementById("pdf-fit-width")?.addEventListener("click", fitPdfWidth);

  scroller.addEventListener("dblclick", (e) => {
    const pageDiv = e.target.closest(".pdf-page");
    if (!pageDiv || !dblclickHandler) return;
    e.preventDefault();
    const rect = pageDiv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / view.scale;
    const y = (e.clientY - rect.top) / view.scale;
    dblclickHandler(getPdfPath(), Number(pageDiv.dataset.page), x, y);
  });

  // Fit-width follows the pane when the resizer or window changes it.
  let resizeTimer = null;
  let lastWidth = scroller.clientWidth;
  new ResizeObserver(() => {
    if (scroller.clientWidth === lastWidth) return;
    lastWidth = scroller.clientWidth;
    if (!view.fit) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => rescale(fitScale(), true), 150);
  }).observe(scroller);
}
