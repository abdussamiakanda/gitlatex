import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, X, Wrench, Copy, Search, FileText } from 'lucide-react';
import { useStore, setState, toast, type BottomView } from '../state/store';
import { applyQuickFix, revealDiagnostic } from '../state/actions';
import { explain } from '../latex/explain';
import type { Diagnostic, Severity } from '../types';
import { Button, IconButton, EmptyState, clsx } from './ui';

export function BottomPanel() {
  const view = useStore((s) => s.bottom);
  const diags = useStore((s) => s.compile.diagnostics);
  const counts = useMemo(
    () => ({ error: diags.filter((d) => d.severity === 'error').length, warning: diags.filter((d) => d.severity === 'warning').length, info: diags.filter((d) => d.severity === 'info').length }),
    [diags],
  );
  if (!view) return null;
  const tab = (v: BottomView, label: string, badge?: React.ReactNode) => (
    <button
      role="tab"
      aria-selected={view === v}
      onClick={() => setState({ bottom: v })}
      className={clsx('flex h-full items-center gap-1.5 border-b-2 px-3 text-[12px] font-medium', view === v ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
    >
      {label}
      {badge}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col border-t border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center border-b border-line pr-1" role="tablist">
        {tab(
          'problems',
          'Problems',
          <span className="flex gap-1 text-[10px]">
            {counts.error > 0 && <span className="rounded bg-danger/15 px-1 text-danger">{counts.error}</span>}
            {counts.warning > 0 && <span className="rounded bg-warn/15 px-1 text-warn">{counts.warning}</span>}
          </span>,
        )}
        {tab('log', 'Raw log')}
        {tab('console', 'Build console')}
        <div className="flex-1" />
        <IconButton size="sm" label="Close panel" onClick={() => setState({ bottom: null })}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'problems' && <Problems diags={diags} counts={counts} />}
        {view === 'log' && <RawLog />}
        {view === 'console' && <Console />}
      </div>
    </div>
  );
}

const ICON: Record<Severity, React.ReactNode> = {
  error: <AlertCircle className="size-3.5 shrink-0 text-danger" />,
  warning: <AlertTriangle className="size-3.5 shrink-0 text-warn" />,
  info: <Info className="size-3.5 shrink-0 text-info" />,
};

type ProblemGroup = { d: Diagnostic; ex: ReturnType<typeof explain>; count: number; lines: number[] };

/** Plain-text form of one Problems row, for the clipboard. */
function problemText({ d, ex, count, lines }: ProblemGroup): string {
  const where = d.file ? `${d.file}${lines.length ? `:${lines.join(', ')}` : ''}` : d.source === 'engine' ? 'engine' : '';
  const head = `[${d.severity}]${where ? ` ${where}` : ''}${count > 1 ? ` (×${count})` : ''}`;
  return [head, ex ? `${ex.title}: ${ex.detail}` : null, d.message, d.raw && d.raw !== d.message ? d.raw : null].filter(Boolean).join('\n');
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast({ kind: 'info', title: 'Copied to clipboard', timeout: 1500 }),
    () => toast({ kind: 'error', title: 'Could not copy to the clipboard' }),
  );
}

function Problems({ diags, counts }: { diags: Diagnostic[]; counts: Record<Severity, number> }) {
  const [show, setShow] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: false });
  const beginner = useStore((s) => s.settings.beginnerMode);
  const rawLog = useStore((s) => s.compile.result?.log ?? '');
  const list = diags.filter((d) => show[d.severity]);
  // Merge repeats: the same error on the same line (TeX often reports one cascade
  // dozens of times), and the same explained warning across lines (70 undefined
  // citations become one row listing the lines).
  const groups = useMemo(() => {
    const map = new Map<string, ProblemGroup>();
    for (const d of list) {
      const ex = d.severity !== 'info' && beginner ? explain(d) : null;
      const key = d.severity === 'warning' && ex
        ? `w|${ex.title}|${d.file ?? ''}`
        : `${d.severity}|${ex?.title ?? d.message}|${d.message}|${d.file ?? ''}|${d.line ?? ''}`;
      const g = map.get(key);
      if (g) {
        g.count++;
        if (d.line && !g.lines.includes(d.line)) g.lines.push(d.line);
      } else map.set(key, { d, ex, count: 1, lines: d.line ? [d.line] : [] });
    }
    return [...map.values()];
  }, [list, beginner]);
  return (
    <div>
      <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-panel px-2 py-1">
        {(['error', 'warning', 'info'] as Severity[]).map((s) => (
          <button
            key={s}
            onClick={() => setShow((x) => ({ ...x, [s]: !x[s] }))}
            className={clsx('flex items-center gap-1 rounded px-2 py-0.5 text-[11px]', show[s] ? 'bg-hover text-fg' : 'text-faint')}
          >
            {ICON[s]} {counts[s]} {s === 'info' ? 'box warnings' : s === 'error' ? 'errors' : 'warnings'}
          </button>
        ))}
        <span className="ml-auto" />
        <IconButton size="sm" label="Copy all shown problems" disabled={!groups.length} onClick={() => copyText(groups.map(problemText).join('\n\n'))}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label="Copy full raw log" disabled={!rawLog} onClick={() => copyText(rawLog)}>
          <FileText className="size-3.5" />
        </IconButton>
      </div>
      {!list.length ? (
        <EmptyState icon={<Info className="size-7" />} title={diags.length ? 'Nothing to show with these filters' : 'No problems'}>
          {diags.length ? null : 'Compile the document to check it for errors.'}
        </EmptyState>
      ) : (
        groups.map(({ d, ex, count, lines }, i) => (
          <div key={i} className="group border-b border-line/60 px-3 py-1.5 hover:bg-hover/50">
            <div className="flex items-start gap-1">
            <button className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => revealDiagnostic(d)}>
              <span className="mt-0.5">{ICON[d.severity]}</span>
              <span className="min-w-0 flex-1">
                <span className="text-[12.5px] text-fg">{ex ? ex.title : d.message}</span>
                {count > 1 && <span className="ml-2 rounded-full bg-panel-2 px-1.5 text-[10px] tabular-nums text-muted">×{count}</span>}
                {ex && <span className="mt-0.5 block truncate font-mono text-[11px] text-faint" title={d.message}>{d.message}</span>}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-faint" title={lines.length > 1 ? `Lines ${lines.join(', ')}` : undefined}>
                {d.file ?? (d.source === 'engine' ? 'engine' : '')}
                {lines.length ? `:${lines[0]}${lines.length > 1 ? ` +${lines.length - 1}` : ''}` : ''}
              </span>
            </button>
            <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <IconButton size="sm" label="Copy this problem" onClick={() => copyText(problemText({ d, ex, count, lines }))}>
                <Copy className="size-3.5" />
              </IconButton>
            </span>
            </div>
            {ex && d.severity !== 'info' && (
              <div className="mt-1 flex flex-wrap items-center gap-2 pl-5.5 text-[12px] text-muted">
                <span>{ex.detail}</span>
                {ex.fixes.map((f, k) => (
                  <Button key={k} size="sm" variant="subtle" icon={<Wrench className="size-3" />} onClick={() => applyQuickFix(f)}>
                    {f.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function RawLog() {
  const result = useStore((s) => s.compile.result);
  const [q, setQ] = useState('');
  const log = result?.log ?? '';
  const lines = useMemo(() => log.split('\n'), [log]);
  if (!result) return <EmptyState icon={<Info className="size-7" />} title="No log yet">Compile to see TeX's log.</EmptyState>;
  const shown = q ? lines.filter((l) => l.toLowerCase().includes(q.toLowerCase())) : lines;
  return (
    <div className="relative">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel px-2 py-1">
        <Search className="size-3.5 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter log lines…" className="h-6 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint" />
        <span className="text-[11px] text-faint">{shown.length} lines</span>
        <IconButton size="sm" label="Copy log" onClick={() => void navigator.clipboard?.writeText(log)}><Copy className="size-3.5" /></IconButton>
      </div>
      <pre className="px-3 py-2 font-mono text-[11.5px] leading-[1.55]">
        {shown.map((l, i) => (
          <div key={i} className={clsx(/^!|:\d+: /.test(l) ? 'text-danger' : /Warning/.test(l) ? 'text-warn' : /^(Over|Under)full/.test(l) ? 'text-info' : 'text-muted')}>
            {l || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

function Console() {
  const result = useStore((s) => s.compile.result);
  const live = useStore((s) => s.compile.console);
  const status = useStore((s) => s.compile.status);
  const text = status === 'running' ? live : result?.transcript ?? live;
  if (!text) return <EmptyState icon={<Info className="size-7" />} title="Console is empty">Every tool invocation (pdflatex, bibtex8, makeindex, xdvipdfmx) is shown here.</EmptyState>;
  return (
    <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-muted">
      {text.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('$ ') ? 'mt-2 font-semibold text-accent' : /^\[exit [1-9]/.test(l) ? 'text-danger' : /^\[exit/.test(l) ? 'text-ok' : undefined}>
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}
