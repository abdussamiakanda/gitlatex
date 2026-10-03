/**
 * PDF viewer built on pdf.js: continuous scrolling, lazy HiDPI rendering,
 * selectable text layer, flicker-free updates after recompiles (old pages
 * stay visible until the new ones are painted), zoom, and SyncTeX hooks.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
// The "legacy" build bundles polyfills (e.g. Map.prototype.getOrInsertComputed)
// that the modern build expects from the very newest browsers.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { SyncRect } from '../latex/synctex';
import { changedPageTiles, type ChangeTile } from './changes';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type Zoom = 'width' | 'page' | number;

export interface PdfViewerHandle {
  scrollToPage(page: number): void;
}

interface PageSize {
  w: number;
  h: number;
}

const GAP = 14;
const PAD = 16;

export const PdfViewer = forwardRef<
  PdfViewerHandle,
  {
    data: Uint8Array;
    version: number;
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
  const scroller = useRef<HTMLDivElement>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const taskRef = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [error, setError] = useState<string | null>(null);
  const rendered = useRef(new Map<number, string>()); // page → "version:scale"
  const tasks = useRef(new Map<number, pdfjs.RenderTask>());
  const docVersion = useRef(0);
  const [highlight, setHighlight] = useState<{ rects: SyncRect[]; nonce: number } | null>(null);

  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const navigatedVersion = useRef<number | null>(null);
  const [changes, setChanges] = useState<{ page: number; tiles: ChangeTile[] } | null>(null);
  useEffect(() => {
    if (!changes) return;
    const timer = setTimeout(() => setChanges(null), 3000);
    return () => clearTimeout(timer);
  }, [changes]);

  // ---- load document ----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ data: data.slice() });
    task.promise.then(
      async (doc) => {
        if (cancelled) {
          void task.destroy();
          return;
        }
        const next: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          next.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return void task.destroy();
        const oldDoc = docRef.current;
        const page = cursorPage ? Math.min(cursorPage, doc.numPages) : null;
        let tiles: ChangeTile[] = [];
        if (oldDoc && page && page <= oldDoc.numPages) {
          try { tiles = await changedPageTiles(await oldDoc.getPage(page), await doc.getPage(page)); }
          catch { /* A comparison failure must not prevent PDF display. */ }
        }
        if (cancelled) return void task.destroy();
        const oldTask = taskRef.current;
        docRef.current = doc;
        taskRef.current = task;
        docVersion.current++;
        rendered.current.clear();
        setError(null);
        setSizes(next);
        setLoadedVersion(version);
        setChanges(page && tiles.length ? { page, tiles } : null);
        // Destroy the previous document once its canvases have been replaced.
        if (oldTask) setTimeout(() => void oldTask.destroy(), 4000);
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
  }, [data, version, cursorPage]);

  useEffect(() => () => void taskRef.current?.destroy(), []);

  // ---- container size -----------------------------------------------------------------------
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxW = Math.max(1, ...sizes.map((s) => s.w));
  const maxH = Math.max(1, ...sizes.map((s) => s.h));
  const scale =
    zoom === 'width'
      ? Math.max(0.2, (box.w - PAD * 2) / maxW)
      : zoom === 'page'
        ? Math.max(0.2, Math.min((box.w - PAD * 2) / maxW, (box.h - PAD * 2) / maxH))
        : zoom;

  useEffect(() => onScaleChange?.(scale), [scale, onScaleChange]);

  // ---- render visible pages ----------------------------------------------------------------------
  const renderPage = useCallback(
    async (index: number) => {
      const doc = docRef.current;
      const el = scroller.current?.querySelector<HTMLDivElement>(`[data-page="${index + 1}"]`);
      if (!doc || !el) return;
      const key = `${docVersion.current}:${scale.toFixed(3)}`;
      if (rendered.current.get(index) === key) return;
      rendered.current.set(index, key);
      tasks.current.get(index)?.cancel();
      try {
        const page = await doc.getPage(index + 1);
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        const task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        tasks.current.set(index, task);
        await task.promise;
        if (rendered.current.get(index) !== key) return;
        // Swap in the fresh canvas only when it is fully painted (no flicker).
        el.querySelector('canvas')?.replaceWith(canvas) ?? el.prepend(canvas);
        const old = el.querySelector('.textLayer');
        const layer = document.createElement('div');
        layer.className = 'textLayer';
        const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        await tl.render().catch(() => undefined);
        if (old) old.replaceWith(layer);
        else el.appendChild(layer);
        page.cleanup();
      } catch (err) {
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.warn('[pdf] render failed', index + 1, err);
          rendered.current.delete(index);
        }
      }
    },
    [scale],
  );

  useEffect(() => {
    const root = scroller.current;
    if (!root || !sizes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) void renderPage(Number((e.target as HTMLElement).dataset.page) - 1);
      },
      { root, rootMargin: '600px 0px' },
    );
    root.querySelectorAll('[data-page]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sizes, renderPage]);

  // ---- page tracking -------------------------------------------------------------------------------
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || !sizes.length) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let y = PAD;
    let page = 1;
    for (let i = 0; i < sizes.length; i++) {
      const h = sizes[i].h * scale;
      if (mid < y + h + GAP) {
        page = i + 1;
        break;
      }
      y += h + GAP;
      page = i + 1;
    }
    onPageChange(page, sizes.length);
  }, [sizes, scale, onPageChange]);

  useEffect(() => onScroll(), [onScroll]);

  // Keep the reading position when the zoom changes.
  const lastScale = useRef(scale);
  useEffect(() => {
    const el = scroller.current;
    if (el && lastScale.current !== scale) {
      const ratio = scale / lastScale.current;
      el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
      lastScale.current = scale;
    }
  }, [scale]);

  // Ctrl/Cmd + wheel zoom
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = Math.max(0.25, Math.min(5, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      onZoomChange(Math.round(next * 100) / 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, onZoomChange]);

  const pageTop = useCallback(
    (page: number) => {
      let y = PAD;
      for (let i = 0; i < page - 1 && i < sizes.length; i++) y += sizes[i].h * scale + GAP;
      return y;
    },
    [sizes, scale],
  );

  useImperativeHandle(ref, () => ({
    scrollToPage(page: number) {
      scroller.current?.scrollTo({ top: pageTop(page) - 8, behavior: 'smooth' });
    },
  }));

  // Navigate once, only after the PDF matching this compile has been loaded.
  useEffect(() => {
    if (loadedVersion !== version || navigatedVersion.current === version || !sizes.length) return;
    navigatedVersion.current = version;
    if (cursorPage && scroller.current) {
      const page = Math.min(cursorPage, sizes.length);
      scroller.current.scrollTop = Math.max(0, pageTop(page) - 8);
      void renderPage(page - 1);
      onScroll();
    }
  }, [loadedVersion, version, cursorPage, sizes, pageTop, renderPage, onScroll]);

  // SyncTeX forward search target.
  useEffect(() => {
    if (!target) { setHighlight(null); return; }
    if (!target.rects.length || !scroller.current) return;
    const r = target.rects[0];
    const top = pageTop(r.page) + r.y * scale - scroller.current.clientHeight / 3;
    scroller.current.scrollTo({ top, behavior: 'smooth' });
    setHighlight(target);
  }, [target, pageTop, scale]);

  const onDoubleClick = (e: React.MouseEvent) => {
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    window.getSelection()?.removeAllRanges();
    onInverseSearch(Number(pageEl.dataset.page), (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
  };

  if (error) return <div className="p-6 text-sm text-danger">Could not display the PDF: {error}</div>;

  return (
    <div ref={scroller} onScroll={onScroll} onDoubleClick={onDoubleClick} className={dark ? 'pdf-dark h-full overflow-auto' : 'h-full overflow-auto'} data-testid="pdf-viewer" title="Double-click to jump to the source">
      <div className="flex flex-col items-center" style={{ padding: PAD, gap: GAP, minWidth: maxW * scale + PAD * 2 }}>
        {sizes.map((s, i) => (
          <div
            key={i}
            data-page={i + 1}
            className="pdf-page relative shrink-0 bg-white"
            style={{ width: s.w * scale, height: s.h * scale, ['--total-scale-factor' as string]: scale, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}
          >
            {changes?.page === i + 1 && changes.tiles.map((tile, k) => (
              <div key={`change-${version}-${k}`} aria-hidden="true"
                className="pointer-events-none absolute z-10"
                style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.w}%`, height: `${tile.h}%`, background: 'rgba(255,185,0,0.35)' }} />
            ))}
            {highlight?.rects
              .filter((r) => r.page === i + 1)
              .map((r, k) => (
                <div
                  key={`${highlight.nonce}-${k}`}
                  className="synctex-flash pointer-events-none absolute z-10 rounded-sm"
                  style={{ left: r.x * scale - 3, top: r.y * scale - 3, width: r.w * scale + 6, height: r.h * scale + 6 }}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
});
