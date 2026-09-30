/**
 * The Compiler panel: pick where documents are built, and see the details of
 * the compiler in use: the in-browser engine and its packages, the local TeX
 * programs, or the Compiler API endpoint.
 */
import { useEffect } from 'react';
import { Cpu, Package, Trash2, RefreshCw, CheckCircle2, Circle, Cloud, Monitor, Globe, XCircle, Settings } from 'lucide-react';
import { useStore, toast, openDialog, getCompilerApi, normalizeCompilerApiUrl } from '../state/store';
import { engine, reconfigureEngine, setCompiler, useCompiler, type Compiler } from '../state/actions';
import type { CompilerMode } from '../types';
import { formatBytes } from '../utils/misc';
import { Button, ProgressBar, SectionTitle, clsx } from './ui';

const MODES: { id: CompilerMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'browser', label: 'Browser' },
  { id: 'local', label: 'Local TeX' },
  { id: 'api', label: 'API' },
];

const ACTIVE_LABEL: Record<Compiler, string> = { browser: 'in-browser TeX', local: 'local TeX', api: 'the Compiler API' };

export function EnginePanel() {
  const { chosen, active, latex } = useCompiler();
  const result = useStore((s) => s.compile.result);
  const backend = useStore((s) => s.compile.backend);

  return (
    <div className="flex h-full flex-col">
      <SectionTitle>Compiler</SectionTitle>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 text-[13px]">
        <div>
          <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Compiler">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={chosen === m.id}
                onClick={() => setCompiler(m.id)}
                className={clsx('flex-1 rounded-md px-1.5 py-1 text-[12px] font-medium', chosen === m.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
              >
                {m.label}
              </button>
            ))}
          </div>
          {chosen === 'auto' && (
            <p className="mt-1.5 text-[11.5px] text-faint">
              {!active
                ? 'Checking for a local TeX installation…'
                : active === 'browser'
                  ? 'Auto is using in-browser TeX: no local TeX installation was found.'
                  : `Auto is using ${ACTIVE_LABEL[active]}.`}
            </p>
          )}
        </div>

        {active === 'browser' && <BrowserEngine />}
        {active === 'local' && <LocalTex latex={latex} />}
        {active === 'api' && <CompilerApi />}

        {result && backend === active && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Last build</div>
            <div className="space-y-0.5 font-mono text-[11px] text-muted">
              {result.steps.map((s, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className={s.exitCode === 0 ? '' : 'text-warn'}>{s.tool}</span>
                  <span>{s.ms ? `${s.ms} ms` : ''}</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 border-t border-line pt-1 text-fg">
                <span>total{result.passes ? ` (${result.passes} pass${result.passes > 1 ? 'es' : ''})` : ''}</span>
                <span>{result.durationMs} ms</span>
              </div>
            </div>
            {result.fetched.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {result.fetched.map((f) => (
                  <span key={f} className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                    <Package className="size-2.5" />
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LocalTex({ latex }: { latex: Record<'pdflatex' | 'xelatex' | 'lualatex', boolean> | null }) {
  const texEngine = useStore((s) => s.project?.engine);
  const program = texEngine === 'xetex' ? 'xelatex' : texEngine === 'luatex' ? 'lualatex' : 'pdflatex';
  const found = latex ? Object.values(latex).some(Boolean) : null;
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <div className="flex items-center gap-2">
        <Monitor className="size-4 text-accent" />
        <span className="font-medium text-fg">TeX installation on this machine</span>
      </div>
      <div className="mt-2 space-y-1">
        {(['pdflatex', 'xelatex', 'lualatex'] as const).map((name) => (
          <div key={name} className="flex items-center gap-2 text-xs">
            {latex?.[name] ? <CheckCircle2 className="size-3.5 text-ok" /> : <XCircle className="size-3.5 text-faint" />}
            <span className={clsx('font-mono', latex?.[name] ? 'text-fg' : 'text-faint')}>{name}</span>
            {name === program && <span className="rounded bg-accent/10 px-1.5 text-[10px] text-accent">this project</span>}
          </div>
        ))}
      </div>
      {found === false && (
        <p className="mt-2 text-xs text-warn">No TeX installation was found on the PATH of the machine running gitlatex. Install TeX Live, MiKTeX or MacTeX, or switch to Browser.</p>
      )}
      {latex && found && !latex[program] && <p className="mt-2 text-xs text-warn">{program} is not installed. Pick another engine in the top bar, or install it.</p>}
      <p className="mt-2 text-[11px] text-faint">Runs {program}, then bibtex or biber when needed, and reruns until references settle. The PDF is written next to the main file.</p>
    </div>
  );
}

function CompilerApi() {
  // Re-read when Settings closes, in case the endpoint was changed there.
  useStore((s) => s.dialog);
  const { url, key } = getCompilerApi();
  const endpoint = normalizeCompilerApiUrl(url);
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-accent" />
        <span className="font-medium text-fg">Remote Compiler API</span>
      </div>
      {endpoint ? (
        <div className="mt-2 space-y-1 text-xs text-muted">
          <div className="break-all font-mono text-fg">{endpoint}</div>
          <div>{key ? 'Sends an API key as a Bearer token.' : 'No API key.'}</div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-warn">No Compiler API URL is set yet.</p>
      )}
      <Button size="sm" className="mt-3" icon={<Settings className="size-3.5" />} onClick={() => openDialog({ type: 'settings' })}>
        {endpoint ? 'Change in Settings' : 'Set it up in Settings'}
      </Button>
    </div>
  );
}

function BrowserEngine() {
  const snap = useStore((s) => s.engine);
  const info = snap.info;

  // Only the browser compiler needs the (large) engine, so start it here on demand.
  useEffect(() => {
    if (snap.state === 'idle') void engine.start().catch(() => undefined);
  }, [snap.state]);

  return (
    <>
      <div className="rounded-lg border border-line bg-panel-2 p-3">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-accent" />
          <span className="font-medium text-fg">{info?.name ?? 'WebAssembly TeX'}</span>
        </div>
        <div className="mt-1 text-xs text-muted">
          {snap.state === 'booting' ? 'Starting…' : snap.state === 'error' ? 'Failed to start' : info ? `Ready in ${(info.initMs / 1000).toFixed(1)} s · runs in a Web Worker` : 'Not started'}
        </div>
        {snap.progress && (
          <div className="mt-2 space-y-1">
            <div className="truncate text-[11px] text-muted">{snap.progress.message}</div>
            <ProgressBar value={snap.progress.loaded} total={snap.progress.total} />
          </div>
        )}
        {snap.error && <div className="mt-2 text-xs text-danger">{snap.error}</div>}
        {info && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(['pdftex', 'xetex', 'luatex'] as const).map((e) => (
              <span key={e} className={info.engines.includes(e) ? 'rounded bg-ok/15 px-1.5 py-0.5 text-[10px] font-medium text-ok' : 'rounded bg-line px-1.5 py-0.5 text-[10px] text-faint line-through'}>
                {e === 'pdftex' ? 'pdfLaTeX' : e === 'xetex' ? 'XeLaTeX' : 'LuaLaTeX'}
              </span>
            ))}
            <span className="rounded bg-line px-1.5 py-0.5 text-[10px] text-muted">BibTeX</span>
            <span className="rounded bg-line px-1.5 py-0.5 text-[10px] text-muted">makeindex</span>
          </div>
        )}
      </div>

      {info && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">TeX Live {info.texlive} collections</div>
          <div className="space-y-1">
            {info.collections.map((c) => (
              <div key={c.id} className="flex items-start gap-2 rounded-md px-1 py-1" title={c.id}>
                {c.loaded ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-faint" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-fg">{c.label}</div>
                  <div className="text-[11px] text-faint">
                    {formatBytes(c.bytes)} · {c.loaded ? 'mounted' : 'mounted automatically when needed'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {info && (
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center gap-2 font-medium text-fg">
            <Cloud className="size-4 text-accent-2" /> On-demand package shelf
          </div>
          {info.shelf.enabled ? (
            <div className="mt-1 space-y-1 text-xs text-muted">
              <div>{info.shelf.label}</div>
              <div>
                {info.shelf.bundles.toLocaleString()} packages & fonts available · {info.shelf.cached} cached offline
              </div>
              <div className="text-faint">Missing packages (TikZ, biblatex, cm-super fonts, …) are fetched automatically the first time a document needs them.</div>
            </div>
          ) : (
            <div className="mt-1 text-xs text-muted">Disabled — only the base collections are available. Enable it in Settings.</div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={reconfigureEngine}>
          Restart engine
        </Button>
        <Button
          size="sm"
          icon={<Trash2 className="size-3.5" />}
          onClick={() =>
            openDialog({
              type: 'confirm',
              title: 'Clear engine caches?',
              message: 'Downloaded TeX Live data and packages will be removed from this browser and downloaded again on the next compile. Your projects are not affected.',
              confirm: 'Clear caches',
              danger: true,
              onConfirm: async () => {
                await engine.clearCache();
                reconfigureEngine();
                toast({ kind: 'success', title: 'Engine caches cleared' });
              },
            })
          }
        >
          Clear caches
        </Button>
      </div>
    </>
  );
}
