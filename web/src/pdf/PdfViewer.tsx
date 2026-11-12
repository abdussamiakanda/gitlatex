/**
 * PDF viewer built on pdf.js's PDFViewer: continuous scrolling, lazy HiDPI
 * rendering, selectable text, clickable links, flicker-free updates after
 * recompiles (a still copy of the old pages stays on top until the new ones
 * are painted), zoom, and SyncTeX hooks.
 *
 * PDFJumpHistory (from our pdf.js fork, revolutionibus/pdf.js) adds marks and
 * a return point on top. While the PDF has focus:
 *   M        mark the selected line, or the line at the top of the view
 *   B        go back to where the last link / Show in PDF jump started
 *   C        go to the previous mark (Shift+C: the next one)
 *
 * After a compile the view moves to the cursor's page and briefly highlights
 * what changed there; a \ref to a figure lands on the whole figure.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { BookmarkPlus } from 'lucide-react';
// Must come first: pdf_viewer.mjs reads the library from a global set there.
import { pdfjs } from './pdfjs';
import * as pdfjsViewer from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import { getState } from '../state/store';
import type { SyncRect } from '../latex/synctex';
import { changedPageTiles, type ChangeTile } from './changes';
import { figureTopAbove, graphicsBoxes } from './link-target';

export type Zoom = 'width' | 'page' | number;

export interface PdfViewerHandle {
  scrollToPage(page: number): void;
}

interface Viewer {
  eventBus: pdfjsViewer.EventBus;
  linkService: pdfjsViewer.PDFLinkService;
  pdfViewer: pdfjsViewer.PDFViewer;
  jumpHistory: pdfjsViewer.PDFJumpHistory;
}

/** What PDFViewer reports in "updateviewarea": the view's top-left, in PDF units. */
interface ViewLocation {
  pageNumber: number;
  left: number;
  top: number;
}

const MARKS_KEY = 'gitlatex-pdf-marks:';

function applyZoom(pdfViewer: pdfjsViewer.PDFViewer, zoom: Zoom) {
  if (zoom === 'width') pdfViewer.currentScaleValue = 'page-width';
  else if (zoom === 'page') pdfViewer.currentScaleValue = 'page-fit';
  else pdfViewer.currentScale = zoom;
}

/**
 * Marks are kept per project and main file, so they outlive a recompile or a
 * reload. PDFJumpHistory only needs these two methods of pdf.js's ViewHistory.
 */
function marksStore() {
  const project = getState().project;
  if (!project) return null;
  const key = `${MARKS_KEY}${project.id}:${project.mainFile}`;
  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
    } catch {
      return {};
    }
  };
  return {
    async getMultiple(defaults: Record<string, unknown>) {
      return { ...defaults, ...read() };
    },
    async setMultiple(values: Record<string, unknown>) {
      try {
        localStorage.setItem(key, JSON.stringify({ ...read(), ...values }));
      } catch {
        // Storage full or blocked: the marks just do not persist.
      }
    },
  };
}

/** Room left above a link's target (CSS px), so it is not flush with the edge. */
const LANDING_MARGIN = 24;
/** Give up on finding a figure above the target after this long, and just jump. */
const LANDING_TIMEOUT = 400;

/**
 * For an XYZ destination (what hyperref writes), where the view should
 * start: the figure right above the target if there is one, else the target.
 * Null for anything else, which pdf.js then handles as usual.
 */
async function landingFor(pdfViewer: pdfjsViewer.PDFViewer, dest: string | unknown[]) {
  const doc = pdfViewer.pdfDocument;
  if (!doc) return null;
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || (explicit[1] as { name?: string })?.name !== 'XYZ' || typeof explicit[3] !== 'number') return null;
  const ref = explicit[0];
  const pageIndex = Number.isInteger(ref) ? (ref as number) : ref && typeof ref === 'object' ? await doc.getPageIndex(ref as never) : null;
  if (pageIndex === null) return null;
  const targetY = explicit[3] as number;
  const page = await doc.getPage(pageIndex + 1);
  const opList = await Promise.race([page.getOperatorList(), new Promise<null>((r) => setTimeout(() => r(null), LANDING_TIMEOUT))]);
  const figureTop = opList ? figureTopAbove(graphicsBoxes(opList, pdfjs.OPS), targetY, page.view[3] - page.view[1]) : null;
  const x = typeof explicit[2] === 'number' ? explicit[2] : 0;
  return (el: HTMLElement) => {
    const pageView = pdfViewer.getPageView(pageIndex);
    if (!pageView?.div) return;
    const [, top] = pageView.viewport.convertToViewportPoint(x, figureTop ?? targetY);
    el.scrollTop = pageOrigin(el, pageView.div).top + top - LANDING_MARGIN;
  };
}

/**
 * An overlay on a page, positioned in percent so it fits any zoom. pdf.js
 * clears foreign children when it re-lays a page out (on zoom), which suits
 * these short-lived highlights.
 */
function addOverlay(page: HTMLElement, className: string, box: { left: string; top: string; width: string; height: string }) {
  const el = document.createElement('div');
  el.className = `pointer-events-none absolute z-10 ${className}`;
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, box);
  page.appendChild(el);
  return el;
}

/** Top-left of a page's content, in the scroller's scroll coordinates. */
function pageOrigin(scroller: HTMLElement, div: HTMLElement) {
  const page = div.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  return {
    top: page.top - box.top + scroller.scrollTop + div.clientTop,
    left: page.left - box.left + scroller.scrollLeft + div.clientLeft,
  };
}

/** Still copy of the visible pages, laid over the scroller while new ones draw. */
function coverPages(scroller: HTMLElement): HTMLCanvasElement | null {
  const { clientWidth: w, clientHeight: h } = scroller;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  const box = scroller.getBoundingClientRect();
  const cover = document.createElement('canvas');
  cover.className = 'pointer-events-none absolute left-0 top-0 z-[1]';
  cover.width = Math.floor(w * dpr);
  cover.height = Math.floor(h * dpr);
  cover.style.width = `${w}px`;
  cover.style.height = `${h}px`;
  const ctx = cover.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(scroller.parentElement ?? scroller).backgroundColor;
  ctx.fillRect(0, 0, w, h);
  // Dark pages are a CSS filter on the canvas; copy it so the cover matches.
  scroller.querySelectorAll<HTMLCanvasElement>('.page canvas').forEach((canvas) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || r.bottom < box.top || r.top > box.bottom) return;
    ctx.filter = getComputedStyle(canvas).filter;
    ctx.drawImage(canvas, r.left - box.left, r.top - box.top, r.width, r.height);
  });
  scroller.after(cover);
  return cover;
}

/** The selection, when it is text on a PDF page inside root. */
function pdfSelectionRange(root: HTMLElement | null) {
  const sel = document.getSelection();
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('.textLayer') && root.contains(el) ? range : null;
}

export const PdfViewer = forwardRef<
  PdfViewerHandle,
  {
    data: Uint8Array;
    version: number;
    /** The page the cursor is on; after a compile the view moves there. */
    cursorPage: number | null;
    zoom: Zoom;
    onZoomChange: (z: Zoom) => void;
    onPageChange: (page: number, total: number) => void;
    onScaleChange?: (scale: number) => void;
    onInverseSearch: (page: number, x: number, y: number) => void;
    target: { rects: SyncRect[]; nonce: number } | null;
    dark: boolean;
  }
>(function PdfViewer({ data, version, cursorPage, zoom, onZoomChange, onPageChange, onScaleChange, onInverseSearch, target, dark }, ref) {
  const wrapper = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const jumpBar = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const entries = useRef<HTMLOListElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const maxEntries = useRef<HTMLSelectElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);

  const viewerRef = useRef<Viewer | null>(null);
  const taskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const location = useRef<ViewLocation | null>(null);
  const pendingTarget = useRef<{ rects: SyncRect[]; nonce: number } | null>(null);
  /** The `version` of the document on screen: a target that comes with a rebuild waits for it. */
  const shownVersion = useRef<number | null>(null);
  const versionRef = useRef(version);
  versionRef.current = version;
  const [error, setError] = useState<string | null>(null);
  const [markAt, setMarkAt] = useState<{ left: number; top: number } | null>(null);
  // pdf.js events outlive a render; they read the current props from here.
  const props = useRef({ zoom, cursorPage, onPageChange, onScaleChange });
  props.current = { zoom, cursorPage, onPageChange, onScaleChange };

  // ---- create the viewer (once: it keeps listeners on the DOM below) ---------------------------
  useEffect(() => {
    if (viewerRef.current || !scroller.current) return;
    const eventBus = new pdfjsViewer.EventBus();
    const linkService = new pdfjsViewer.PDFLinkService({ eventBus, externalLinkTarget: pdfjsViewer.LinkTarget.BLANK });
    const pdfViewer = new pdfjsViewer.PDFViewer({
      container: scroller.current,
      eventBus,
      linkService,
      removePageBorders: true,
      // The annotation editor listens for paste and drop on the whole page,
      // which would steal them from the editor.
      annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    });
    linkService.setViewer(pdfViewer);
    const jumpHistory = new pdfjsViewer.PDFJumpHistory(
      {
        container: jumpBar.current!,
        backButton: backButton.current!,
        listButton: listButton.current!,
        panel: panel.current!,
        entries: entries.current!,
        saveButton: saveButton.current!,
        maxEntriesSelect: maxEntries.current!,
        clearButton: clearButton.current!,
      },
      eventBus,
      pdfViewer,
    );
    // Land links with some room above, and a \ref to a figure (which points at
    // its caption) on the whole figure. Worked out before the jump, so the
    // view moves once.
    const goToDestination = linkService.goToDestination.bind(linkService);
    linkService.goToDestination = async (dest) => {
      const land = await landingFor(pdfViewer, dest).catch(() => null);
      await goToDestination(dest);
      if (land && scroller.current) land(scroller.current);
    };
    // Their labels are data-l10n-ids; the viewer's l10n has the English text.
    void pdfViewer.l10n?.translate(jumpBar.current);
    void pdfViewer.l10n?.translate(panel.current);

    eventBus.on('updateviewarea', ({ location: l }: { location: ViewLocation }) => (location.current = l));
    eventBus.on('scalechanging', ({ scale }: { scale: number }) => props.current.onScaleChange?.(scale));
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => props.current.onPageChange(pageNumber, pdfViewer.pagesCount));
    viewerRef.current = { eventBus, linkService, pdfViewer, jumpHistory };
  }, []);

  useEffect(() => () => void taskRef.current?.destroy(), []);

  // ---- SyncTeX forward search -------------------------------------------------------------------
  const showTarget = useCallback((t: { rects: SyncRect[]; nonce: number }) => {
    const v = viewerRef.current;
    const el = scroller.current;
    const first = t.rects[0];
    const firstView = v?.pdfViewer.getPageView(first.page - 1);
    if (!v || !el || !firstView?.div) return;
    // Show in PDF is a jump too, so B comes back from it.
    v.eventBus.dispatch('beforenavigate', { source: null, pageNumber: first.page });
    const s = firstView.viewport.scale;
    el.scrollTo({ top: pageOrigin(el, firstView.div).top + first.y * s - el.clientHeight / 3, behavior: 'smooth' });
    for (const r of t.rects) {
      const pageView = v.pdfViewer.getPageView(r.page - 1);
      if (!pageView?.div) continue;
      const k = pageView.viewport.scale;
      const flash = document.createElement('div');
      flash.className = 'synctex-flash pointer-events-none absolute z-10 rounded-sm';
      Object.assign(flash.style, { left: `${r.x * k - 3}px`, top: `${r.y * k - 3}px`, width: `${r.w * k + 6}px`, height: `${r.h * k + 6}px` });
      flash.addEventListener('animationend', () => flash.remove());
      pageView.div.appendChild(flash);
    }
  }, []);

  useEffect(() => {
    if (!target || !target.rects.length) return;
    if (viewerRef.current?.pdfViewer.pdfDocument && shownVersion.current === versionRef.current) showTarget(target);
    else pendingTarget.current = target;
  }, [target, showTarget]);

  // ---- load document ----------------------------------------------------------------------
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    let cancelled = false;
    const task = pdfjs.getDocument({ data: data.slice() });
    task.promise.then(
      async (doc) => {
        if (cancelled) return void task.destroy();
        const oldDoc = v.pdfViewer.pdfDocument;
        const cursor = props.current.cursorPage;
        // What changed on the cursor's page, compared before the old document goes.
        const changePage = oldDoc && cursor ? Math.min(cursor, doc.numPages) : null;
        let tiles: ChangeTile[] = [];
        if (oldDoc && changePage && changePage <= oldDoc.numPages) {
          try {
            tiles = await changedPageTiles(await oldDoc.getPage(changePage), await doc.getPage(changePage));
          } catch {
            // A comparison failure must not prevent PDF display.
          }
        }
        if (cancelled) return void task.destroy();
        const oldTask = taskRef.current;
        // A rebuild keeps the reader where they were, without a blank flash.
        const keep = oldTask ? location.current : null;
        const cover = oldTask && scroller.current ? coverPages(scroller.current) : null;
        taskRef.current = task;
        setError(null);
        v.jumpHistory.reset();
        v.eventBus.on(
          'pagesinit',
          () => {
            if (taskRef.current !== task) return void cover?.remove();
            shownVersion.current = version;
            const { pdfViewer } = v;
            applyZoom(pdfViewer, props.current.zoom);
            // After a compile, show the page being edited; otherwise stay put.
            if (cursor) pdfViewer.scrollPageIntoView({ pageNumber: Math.min(cursor, pdfViewer.pagesCount) });
            else if (keep) {
              pdfViewer.scrollPageIntoView({
                pageNumber: Math.min(keep.pageNumber, pdfViewer.pagesCount),
                destArray: [null, { name: 'XYZ' }, keep.left, keep.top, null],
                allowNegativeOffset: true,
                ignoreDestinationZoom: true,
              });
            }
            // [data-page] is what the rest of the app (and the e2e tests) look for.
            for (let i = 0; i < pdfViewer.pagesCount; i++) {
              const div = pdfViewer.getPageView(i)?.div;
              if (div) div.dataset.page = String(i + 1);
            }
            const changed = changePage ? pdfViewer.getPageView(changePage - 1)?.div : null;
            if (changed && tiles.length) {
              const shown = tiles.map((t) =>
                addOverlay(changed, 'bg-accent/40', { left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, height: `${t.h}%` }),
              );
              setTimeout(() => shown.forEach((el) => el.remove()), 3000);
            }
            props.current.onPageChange(pdfViewer.currentPageNumber, pdfViewer.pagesCount);
            if (pendingTarget.current) {
              showTarget(pendingTarget.current);
              pendingTarget.current = null;
            }
            if (cover) {
              const pageNumber = pdfViewer.currentPageNumber;
              const onRendered = (e: { pageNumber: number }) => e.pageNumber === pageNumber && done();
              const done = () => {
                clearTimeout(timer);
                v.eventBus.off('pagerendered', onRendered);
                cover.remove();
              };
              const timer = setTimeout(done, 2000);
              v.eventBus.on('pagerendered', onRendered);
            }
            void v.jumpHistory.initialize(marksStore() as never, `${getState().project?.mainFile.replace(/\.tex$/i, '') ?? 'document'}.pdf`);
          },
          { once: true },
        );
        v.pdfViewer.setDocument(doc);
        v.linkService.setDocument(doc);
        if (oldTask) void oldTask.destroy();
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      // Only abort if this task never became the displayed document.
      if (taskRef.current !== task) void task.destroy();
    };
  }, [data, version, showTarget]);

  // ---- zoom ---------------------------------------------------------------------------------
  useEffect(() => {
    const pdfViewer = viewerRef.current?.pdfViewer;
    if (pdfViewer?.pdfDocument) applyZoom(pdfViewer, zoom);
  }, [zoom]);

  // Fit width / fit page follow the pane when it is resized.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastW && el.clientHeight === lastH) return;
      lastW = el.clientWidth;
      lastH = el.clientHeight;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const pdfViewer = viewerRef.current?.pdfViewer;
        const z = props.current.zoom;
        if (pdfViewer?.pdfDocument && typeof z !== 'number') applyZoom(pdfViewer, z);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Ctrl/Cmd + wheel zoom
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const scale = viewerRef.current?.pdfViewer.currentScale ?? 1;
      const next = Math.max(0.25, Math.min(5, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      onZoomChange(Math.round(next * 100) / 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoomChange]);

  useImperativeHandle(ref, () => ({
    scrollToPage(page: number) {
      // Through the link service, so B can come back from it.
      viewerRef.current?.linkService.goToPage(page);
    },
  }));

  // ---- marks ----------------------------------------------------------------------------------
  const markSelectionOrView = () => {
    const jumpHistory = viewerRef.current?.jumpHistory;
    if (!jumpHistory) return;
    if (pdfSelectionRange(scroller.current)) jumpHistory.markSelection();
    else jumpHistory.markCurrentPosition();
    setMarkAt(null);
  };

  /** Floats "Mark line" under a text selection on a page. */
  const showMarkButton = () => {
    const range = pdfSelectionRange(scroller.current);
    const rect = range && [...range.getClientRects()].filter((r) => r.width && r.height).pop();
    const box = wrapper.current?.getBoundingClientRect();
    if (!rect || !box || !wrapper.current) return setMarkAt(null);
    setMarkAt({
      left: Math.max(8, Math.min(rect.right - box.left - 50, wrapper.current.clientWidth - 116)),
      top: Math.min(rect.bottom - box.top + 6, wrapper.current.clientHeight - 40),
    });
  };

  useEffect(() => {
    const onSelectionChange = () => {
      if (!pdfSelectionRange(scroller.current)) setMarkAt(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = viewerRef.current;
    if (!v?.pdfViewer.pdfDocument || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('input, select, textarea, [contenteditable]')) return;
    const { jumpHistory } = v;
    const key = e.key.toLowerCase();
    if (key === 'm' && !e.shiftKey) markSelectionOrView();
    else if (key === 'b' && !e.shiftKey && jumpHistory.canReturn) jumpHistory.toggleReturn();
    else if (key === 'c' && jumpHistory.hasMarks) {
      if (e.shiftKey) jumpHistory.cycleForward();
      else jumpHistory.cycleBack();
    } else return;
    e.preventDefault();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.page');
    const pageNumber = Number(pageEl?.dataset.pageNumber);
    const pageView = viewerRef.current?.pdfViewer.getPageView(pageNumber - 1);
    if (!pageEl || !pageView) return;
    const rect = pageEl.getBoundingClientRect();
    const s = pageView.viewport.scale;
    window.getSelection()?.removeAllRanges();
    onInverseSearch(pageNumber, (e.clientX - rect.left - pageEl.clientLeft) / s, (e.clientY - rect.top - pageEl.clientTop) / s);
  };

  return (
    <div ref={wrapper} onKeyDown={onKeyDown} className={dark ? 'pdf-pane pdf-dark relative isolate h-full' : 'pdf-pane relative isolate h-full'}>
      {/* PDFViewer refuses a scroller that is not absolutely positioned. */}
      <div
        ref={scroller}
        tabIndex={0}
        onDoubleClick={onDoubleClick}
        onPointerUp={() => setTimeout(showMarkButton, 0)}
        onScroll={() => markAt && setMarkAt(null)}
        className="absolute inset-0 overflow-auto outline-none"
        data-testid="pdf-viewer"
        title="Double-click to jump to the source · M mark a line · B back · C / Shift+C cycle marks"
      >
        <div className="pdfViewer" />
      </div>

      {markAt && (
        <button
          type="button"
          className="absolute z-20 flex items-center gap-1 rounded-full border border-line bg-panel py-1 pl-2 pr-2.5 text-[12px] font-medium text-fg shadow-pop hover:border-accent"
          style={markAt}
          title="Mark this line (M)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={markSelectionOrView}
        >
          <BookmarkPlus className="size-3.5 text-accent" /> Mark line
        </button>
      )}

      {/* Driven by PDFJumpHistory; the ids are the ones its CSS expects. */}
      <div id="jumpHistory" ref={jumpBar} role="group" hidden>
        <button id="jumpHistoryBack" ref={backButton} className="jumpHistoryButton" type="button" data-l10n-id="pdfjs-jump-history-back-button-empty" disabled>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M6 3 2.5 6.5 6 10M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="jumpHistoryPage" aria-hidden="true" />
        </button>
        <button id="jumpHistoryList" ref={listButton} className="jumpHistoryButton" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="jumpHistoryPanel" data-l10n-id="pdfjs-jump-history-list-button">
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M5.5 4h8M5.5 8h8M5.5 12h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="2.5" cy="4" r="1" fill="currentColor" /><circle cx="2.5" cy="8" r="1" fill="currentColor" /><circle cx="2.5" cy="12" r="1" fill="currentColor" /></svg>
        </button>
      </div>
      <div id="jumpHistoryPanel" ref={panel} role="dialog" aria-labelledby="jumpHistoryPanelTitle" hidden>
        <div className="jumpHistoryPanelHeader">
          <span id="jumpHistoryPanelTitle" data-l10n-id="pdfjs-jump-history-panel-title" />
          <div className="jumpHistoryPanelActions">
            <button id="jumpHistoryClear" ref={clearButton} className="jump-history-action" type="button" data-l10n-id="pdfjs-jump-history-clear-button" />
            <button id="jumpHistorySave" ref={saveButton} className="jump-history-action" type="button" data-l10n-id="pdfjs-jump-history-save-button" />
          </div>
        </div>
        <ol id="jumpHistoryEntries" ref={entries} />
        <div className="jumpHistoryPanelFooter">
          <label htmlFor="jumpHistoryMaxEntries" data-l10n-id="pdfjs-jump-history-max-entries-label" />
          <select id="jumpHistoryMaxEntries" ref={maxEntries} />
        </div>
      </div>

      {error && <div className="absolute inset-0 z-20 bg-panel-2 p-6 text-sm text-danger">Could not display the PDF: {error}</div>}
    </div>
  );
});
