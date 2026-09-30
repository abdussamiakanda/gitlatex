import { AlertCircle, AlertTriangle, ArrowUpCircle, Cpu, WifiOff, Cloud, GitBranch, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore, setState, openDialog } from '../state/store';
import { ENGINE_LABELS } from '../engine/protocol';
import { useCompiler } from '../state/actions';
import { clsx } from './ui';

export function StatusBar() {
  const engine = useStore((s) => s.engine);
  const project = useStore((s) => s.project);
  const cursor = useStore((s) => s.cursor);
  const activePath = useStore((s) => s.activePath);
  const diags = useStore((s) => s.compile.diagnostics);
  const update = useStore((s) => s.update);
  const lastBackend = useStore((s) => s.compile.backend);
  const { active } = useCompiler();
  // What the last build used, or before any build, what the next one will use.
  const backend = lastBackend ?? active;
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity === 'warning').length;
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const engineText =
    engine.state === 'booting'
      ? engine.progress?.message ?? 'Starting engine…'
      : engine.state === 'error'
        ? 'Engine failed'
        : engine.info
          ? `${engine.info.name}`
          : 'Engine idle';

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[11px] text-muted">
      <button onClick={() => setState({ bottom: 'problems' })} className="flex items-center gap-2 hover:text-fg" title="Problems">
        <span className={clsx('flex items-center gap-1', errors && 'text-danger')}><AlertCircle className="size-3" />{errors}</span>
        <span className={clsx('flex items-center gap-1', warnings && 'text-warn')}><AlertTriangle className="size-3" />{warnings}</span>
      </button>
      {backend === 'api' ? (
        <button onClick={() => setState({ bottom: 'log' })} className="flex items-center gap-1 truncate hover:text-fg" title="Compiled by the remote Compiler API">
          <Cloud className="size-3" /> <span className="truncate">Compiler API</span>
        </button>
      ) : backend === 'local' ? (
        <button onClick={() => setState({ bottom: 'log' })} className="flex items-center gap-1 truncate hover:text-fg" title="Compiled with the TeX installation on this machine">
          <Monitor className="size-3" /> <span className="truncate">Local TeX</span>
        </button>
      ) : (
        <button onClick={() => setState({ sidebar: 'engine' })} className={clsx('flex items-center gap-1 truncate hover:text-fg', engine.state === 'error' && 'text-danger')}>
          <Cpu className="size-3" /> <span className="truncate">{engineText}</span>
        </button>
      )}
      {backend === 'browser' && engine.info?.shelf.enabled && (
        <span className="hidden items-center gap-1 lg:flex" title="On-demand packages available">
          <Cloud className="size-3" /> {engine.info.shelf.bundles.toLocaleString()} packages on demand
        </span>
      )}
      {!online && (
        <span className="flex items-center gap-1 text-warn" title="Offline — everything already downloaded keeps working">
          <WifiOff className="size-3" /> Offline
        </span>
      )}
      <div className="flex-1" />
      {project?.hasGit && (
        <button onClick={() => setState({ sidebar: 'git' })} className="flex items-center gap-1 hover:text-fg" title="Source control">
          <GitBranch className="size-3" /> Git
        </button>
      )}
      {project && <span>{ENGINE_LABELS[project.engine]}</span>}
      {activePath && cursor && (
        <span className="tabular-nums">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
      <span className="hidden sm:inline">UTF-8</span>
      {update && (
        <button
          onClick={() => openDialog({ type: 'settings', section: 'about' })}
          className={clsx('flex items-center gap-1 hover:text-fg', update.updateAvailable && 'text-accent-2')}
          title={update.updateAvailable ? `GitLaTeX ${update.latest} is available (you have ${update.current})` : 'About GitLaTeX'}
        >
          {update.updateAvailable && <ArrowUpCircle className="size-3" />}v{update.current}
        </button>
      )}
    </div>
  );
}
