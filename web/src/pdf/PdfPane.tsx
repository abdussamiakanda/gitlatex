/**
 * Right-hand pane: PDF toolbar, the viewer (pdf.js or the browser's native
 * viewer), engine boot progress and the friendly compile-error overlay.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ZoomIn, ZoomOut, MoveHorizontal, Maximize, Moon, Sun, Download, ExternalLink, FileWarning, Wrench, ScrollText, RefreshCw, MonitorSmartphone, Sparkles, AlertTriangle, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import { useStore, setState, updateSettings } from '../state/store';
import { applyQuickFix, compile, downloadPdf, inverseSearch, openPdfInNewTab, revealDiagnostic } from '../state/actions';
import { explain } from '../latex/explain';
import type { PdfViewerHandle, Zoom } from './PdfViewer';
import { Button, IconButton, ProgressBar, Spinner, clsx } from '../components/ui';
import { formatBytes } from '../utils/misc';
import type { Diagnostic } from '../types';

// pdf.js (~1.8 MB with its worker) is split out of the main bundle so the editor
// paints first; the chunk is prefetched while the engine boots, long before the
// first PDF exists.
const loadViewer = () => import('./PdfViewer');
const PdfViewer = lazy(() => loadViewer().then((m) => ({ default: m.PdfViewer })));

export function PdfPane() {
  const compileState = useStore((s) => s.compile);
  const engine = useStore((s) => s.engine);
  const settings = useStore((s) => s.settings);
  const target = useStore((s) => s.pdfTarget);
  const [zoom, setZoom] = useState<Zoom>(() => {
    const z = localStorage.getItem('texbrowser.pdfZoom');
    return z === 'page' ? 'page' : z && !isNaN(Number(z)) ? Number(z) : 'width';
  });
  const [page, setPage] = useState({ n: 1, total: 0 });
  const onPageChange = useCallback((n: number, total: number) => setPage((p) => (p.n === n && p.total === total ? p : { n, total })), []);
  const [scale, setScale] = useState(1);
  const viewer = useRef<PdfViewerHandle>(null);

  useEffect(() => localStorage.setItem('texbrowser.pdfZoom', String(zoom)), [zoom]);
  useEffect(() => {
    const t = setTimeout(() => void loadViewer().catch(() => undefined), 500);
    return () => clearTimeout(t);
  }, []);

  const { pdf, pdfVersion, cursorPage, status, diagnostics } = compileState;
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const running = status === 'running';
  const failed = status === 'failed' || status === 'crashed';

  const nativeUrl = useMemo(() => (settings.pdfNative && pdf ? URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' })) : null), [pdf, settings.pdfNative]);
  useEffect(() => () => void (nativeUrl && URL.revokeObjectURL(nativeUrl)), [nativeUrl]);

  const zoomBy = (f: number) => setZoom(Math.max(0.25, Math.min(5, Math.round(scale * f * 100) / 100)));

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel-2">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-2">
        <span className="mr-1 text-[12px] tabular-nums text-muted" aria-live="polite">
          {page.total ? `${page.n} / ${page.total}` : '—'}
        </span>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconButton size="sm" label="Zoom out" onClick={() => zoomBy(1 / 1.15)} disabled={!pdf}><ZoomOut className="size-3.5" /></IconButton>
        <button
          className="h-6 min-w-12 rounded px-1 text-[11px] tabular-nums text-muted hover:bg-hover hover:text-fg"
          onClick={() => setZoom(zoom === 'width' ? 'page' : 'width')}
          title="Toggle fit width / fit page"
        >
          {Math.round(scale * 100)}%
        </button>
        <IconButton size="sm" label="Zoom in" onClick={() => zoomBy(1.15)} disabled={!pdf}><ZoomIn className="size-3.5" /></IconButton>
        <IconButton size="sm" label="Fit width" active={zoom === 'width'} onClick={() => setZoom('width')}><MoveHorizontal className="size-3.5" /></IconButton>
        <IconButton size="sm" label="Fit page" active={zoom === 'page'} onClick={() => setZoom('page')}><Maximize className="size-3.5" /></IconButton>
        <div className="flex-1" />
        <CompileStatusChip />
        <IconButton size="sm" label={settings.pdfDarkMode ? 'Light pages' : 'Dark pages (easier on the eyes)'} active={settings.pdfDarkMode} onClick={() => updateSettings({ pdfDarkMode: !settings.pdfDarkMode })}>
          {settings.pdfDarkMode ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </IconButton>
        <IconButton size="sm" label={settings.pdfNative ? 'Use the built-in viewer' : "Use the browser's built-in PDF viewer"} active={settings.pdfNative} onClick={() => updateSettings({ pdfNative: !settings.pdfNative })}>
          <MonitorSmartphone className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label="Open PDF in a new tab" onClick={openPdfInNewTab} disabled={!pdf}><ExternalLink className="size-3.5" /></IconButton>
        <IconButton size="sm" label="Download PDF" onClick={downloadPdf} disabled={!pdf}><Download className="size-3.5" /></IconButton>
      </div>

      {running && <ProgressBar className="h-0.5 rounded-none" />}

      <div className="relative min-h-0 flex-1">
        {pdf ? (
          settings.pdfNative && nativeUrl ? (
            <iframe title="PDF" src={nativeUrl + (cursorPage ? `#page=${cursorPage}` : '')} className="h-full w-full border-0 bg-white" />
          ) : (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner className="size-6 text-accent" /></div>}>
              <PdfViewer
                ref={viewer}
                data={pdf}
                version={pdfVersion}
                cursorPage={cursorPage}
                zoom={zoom}
                onZoomChange={setZoom}
                onScaleChange={setScale}
                onPageChange={onPageChange}
                onInverseSearch={inverseSearch}
                target={target}
                dark={settings.pdfDarkMode}
              />
            </Suspense>
          )
        ) : engine.state === 'booting' || engine.state === 'idle' ? (
          <BootCard />
        ) : running ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted">
            <Spinner className="size-6 text-accent" />
            <div>{engine.progress?.message ?? 'Compiling…'}</div>
          </div>
        ) : null}

        {(failed || (errors.length > 0 && !running)) && <ErrorOverlay diagnostics={diagnostics} hasPdf={!!pdf} stale={failed && !!pdf} />}
        {engine.state === 'error' && !pdf && <EngineErrorCard message={engine.error ?? 'Unknown error'} />}
      </div>
    </div>
  );
}

function CompileStatusChip() {
  const { status, result, lastCompiledAt, dirtySinceCompile, diagnostics } = useStore((s) => s.compile);
  const engine = useStore((s) => s.engine);
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  let text = '';
  let tone = 'text-muted';
  if (status === 'running') text = engine.progress?.message?.replace(/…$/, '') ?? 'Compiling';
  else if (status === 'success' || status === 'warnings') {
    text = `${result ? (result.durationMs / 1000).toFixed(1) + ' s' : 'Done'}${warnings ? ` · ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}`;
    tone = warnings ? 'text-warn' : 'text-ok';
  } else if (status === 'errors') {
    text = `${errors} error${errors === 1 ? '' : 's'}`;
    tone = 'text-danger';
  } else if (status === 'failed' || status === 'crashed') {
    text = 'Failed';
    tone = 'text-danger';
  } else if (status === 'cancelled') text = 'Stopped';
  return (
    <button
      onClick={() => setState({ bottom: status === 'errors' || status === 'failed' || warnings ? 'problems' : 'log' })}
      className={clsx('mr-1 flex max-w-60 items-center gap-1.5 truncate rounded px-2 py-0.5 text-[11px] hover:bg-hover', tone)}
      title={lastCompiledAt ? `Last compiled ${new Date(lastCompiledAt).toLocaleTimeString()}${dirtySinceCompile ? ' · changes since' : ''}` : ''}
    >
      {status === 'running' && <Loader2 className="size-3 animate-spin" />}
      <span className="truncate">{text}</span>
      {dirtySinceCompile && status !== 'running' && lastCompiledAt && <span className="size-1.5 shrink-0 rounded-full bg-warn" title="Edited since the last compile" />}
    </button>
  );
}

function BootCard() {
  const engine = useStore((s) => s.engine);
  const p = engine.progress;
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-5 shadow-pop">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-fg">
          <Sparkles className="size-4 text-accent" /> Starting the TeX engine
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Real TeX Live, compiled to WebAssembly, is loading into a background thread. The first visit downloads it once (it is then cached for offline use); after that it starts in about a second.
        </p>
        <ProgressBar value={p?.loaded} total={p?.total} />
        <div className="mt-2 flex justify-between text-[11px] text-muted">
          <span className="truncate">{p?.message ?? 'Preparing…'}</span>
          {p?.total ? <span className="tabular-nums">{formatBytes(p.loaded ?? 0)} / {formatBytes(p.total)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function EngineErrorCard({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-danger/40 bg-panel p-5 shadow-pop">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger">
          <AlertTriangle className="size-4" /> The TeX engine could not start
        </div>
        <p className="mb-3 whitespace-pre-wrap text-xs leading-relaxed text-muted">{message}</p>
        <p className="mb-4 text-[11px] text-faint">
          The gitlatex server downloads the engine on first use, so this machine needs internet access once. You can also run <code>gitlatex --fetch-engine</code>, or switch Settings → Compiler to Local TeX.
        </p>
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void compile({ reason: 'manual' })}>Try again</Button>
      </div>
    </div>
  );
}

function ErrorOverlay({ diagnostics, hasPdf, stale }: { diagnostics: Diagnostic[]; hasPdf: boolean; stale: boolean }) {
  const beginner = useStore((s) => s.settings.beginnerMode);
  const status = useStore((s) => s.compile.status);
  const error = useStore((s) => s.compile.error);
  const [collapsed, setCollapsed] = useState(hasPdf && !stale);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const first = errors[0];
  const ex = first ? explain(first) : null;

  useEffect(() => setCollapsed(hasPdf && !stale), [hasPdf, stale, first?.message]);

  if (status === 'crashed' && error) {
    return (
      <div className="absolute inset-x-3 top-3 z-20 rounded-xl border border-danger/40 bg-panel p-4 shadow-pop">
        <div className="flex items-center gap-2 text-sm font-semibold text-danger"><AlertTriangle className="size-4" /> Compiler error</div>
        <p className="mt-1 text-xs text-muted">{error}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void compile({ reason: 'manual', clean: true })}>Recompile from scratch</Button>
        </div>
      </div>
    );
  }
  if (!errors.length && !stale) return null;

  return (
    <div className={clsx('absolute inset-x-3 z-20 overflow-hidden rounded-xl border border-danger/40 bg-panel shadow-pop', hasPdf ? 'bottom-3' : 'top-3')}>
      {/* Header: the toggle and the one-click fix are siblings (never nest interactive elements). */}
      <div className="flex items-center gap-2 pr-3">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-4 text-left"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <FileWarning className="size-4 shrink-0 text-danger" />
          <span className="flex-1 truncate text-[13px] font-semibold text-fg">
            {stale ? 'Compilation failed — showing the last successful PDF' : errors.length === 1 ? '1 error' : `${errors.length} errors`}
            {first && <span className="font-normal text-muted"> · {ex?.title ?? first.message}</span>}
          </span>
          {collapsed ? <ChevronUp className="size-4 shrink-0 text-muted" /> : <ChevronDown className="size-4 shrink-0 text-muted" />}
        </button>
        {collapsed && ex?.fixes[0] && (
          <Button size="sm" variant="primary" className="shrink-0" icon={<Wrench className="size-3" />} onClick={() => applyQuickFix(ex.fixes[0])}>
            {ex.fixes[0].label}
          </Button>
        )}
      </div>
      {!collapsed && first && (
        <div className="max-h-[45vh] space-y-3 overflow-y-auto border-t border-line px-4 py-3">
          {beginner && ex && (
            <div className="rounded-lg bg-accent/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-accent"><Sparkles className="size-3.5" /> What does this mean?</div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg">{ex.detail}</p>
              {ex.fixes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {ex.fixes.map((f, i) => (
                    <Button key={i} size="sm" variant="primary" icon={<Wrench className="size-3.5" />} onClick={() => applyQuickFix(f)}>
                      {f.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {errors.slice(0, 5).map((d, i) => (
            <button key={i} onClick={() => revealDiagnostic(d)} className="block w-full rounded-lg border border-line p-2.5 text-left hover:bg-hover">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium text-danger">{d.message}</span>
              </div>
              {d.file && <div className="mt-0.5 font-mono text-[11px] text-muted">{d.file}{d.line ? `:${d.line}` : ''}</div>}
              {d.context && <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded bg-bg/60 p-2 font-mono text-[11px] text-muted">{d.context}</pre>}
            </button>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<ScrollText className="size-3.5" />} onClick={() => setState({ bottom: 'log' })}>View full log</Button>
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void compile({ reason: 'manual', clean: true })}>Recompile from scratch</Button>
          </div>
        </div>
      )}
    </div>
  );
}
