import { Play, Square, ChevronDown, FolderOpen, Plus, FileArchive, FolderInput, Pencil, Copy, Trash2, Download, Moon, Sun, Search, RotateCcw, Zap, FileDown, FileText, Check, Columns2, PanelLeft, GitBranch, Home, ArrowUpFromLine } from 'lucide-react';
import { useStore, openDialog, setState, updateSettings } from '../state/store';
import {
  cancelCompile, closeProject, compile, confirmDeleteProject, downloadActive, downloadPdf, downloadZip, duplicateProject, importFolderAsProject, importZipAsProject, newProjectDialog, openProject, promptClone, promptRenameProject, setEngine, setTheme,
} from '../state/actions';
import { pickFiles } from '../storage/local-disk';
import { ENGINE_LABELS, type TexEngine } from '../engine/protocol';
import { modKey, timeAgo } from '../utils/misc';
import { Button, IconButton, Kbd, useMenu, clsx, type MenuItem } from './ui';

/** The square GitLaTeX mark (public/logo-sq.png, also the favicon). */
export function Logo({ className }: { className?: string }) {
  return <img src="./logo-sq.png" alt="" width={28} height={28} className={clsx('size-7 shrink-0', className)} />;
}

/** The GitLaTeX wordmark, in the variant drawn for the current theme. Size it by height. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('flex shrink-0', className)}>
      <img src="./logo-light.png" alt="GitLaTeX" className="h-full w-auto dark:hidden" />
      <img src="./logo-dark.png" alt="GitLaTeX" className="hidden h-full w-auto dark:block" />
    </span>
  );
}

export function TopBar({ compact, mobileView, onMobileView }: { compact: boolean; mobileView: 'editor' | 'pdf'; onMobileView: (v: 'editor' | 'pdf') => void }) {
  const project = useStore((s) => s.project);
  const projects = useStore((s) => s.projects);
  const status = useStore((s) => s.compile.status);
  const settings = useStore((s) => s.settings);
  const engineInfo = useStore((s) => s.engine.info);
  const sidebar = useStore((s) => s.sidebar);
  const projectMenu = useMenu();
  const compileMenu = useMenu();
  const downloadMenu = useMenu();
  const engineMenu = useMenu();
  const running = status === 'running';

  const projectItems = (): (MenuItem | 'separator')[] => [
    { label: 'All projects', icon: <Home className="size-3.5" />, onSelect: () => void closeProject() },
    'separator',
    ...projects.slice(0, 8).map<MenuItem>((p) => ({
      label: p.name,
      icon: p.id === project?.id ? <Check className="size-3.5 text-accent" /> : <FileText className="size-3.5" />,
      shortcut: timeAgo(p.updatedAt),
      onSelect: () => void openProject(p.id),
    })),
    'separator',
    { label: 'New project…', icon: <Plus className="size-3.5" />, onSelect: () => newProjectDialog() },
    { label: 'Clone repository…', icon: <GitBranch className="size-3.5" />, onSelect: promptClone },
    { label: 'Import .zip…', icon: <FileArchive className="size-3.5" />, onSelect: async () => { const [f] = await pickFiles({ accept: '.zip', multiple: false }); if (f) void importZipAsProject(f); } },
    { label: 'Open folder…', icon: <FolderInput className="size-3.5" />, onSelect: async () => { const files = await pickFiles({ directory: true }); if (files.length) void importFolderAsProject(files); } },
    'separator',
    { label: 'Rename project…', icon: <Pencil className="size-3.5" />, onSelect: promptRenameProject },
    { label: 'Duplicate project', icon: <Copy className="size-3.5" />, onSelect: () => project && void duplicateProject(project.id) },
    { label: 'Delete project…', icon: <Trash2 className="size-3.5" />, danger: true, onSelect: () => project && confirmDeleteProject(project.id) },
  ];

  const engineItems = (): MenuItem[] =>
    (['pdftex', 'xetex', 'luatex'] as TexEngine[]).map((e) => {
      const available = !engineInfo || engineInfo.engines.includes(e);
      return {
        label: `${ENGINE_LABELS[e]}${available ? '' : ' (not in this engine build)'}`,
        icon: project?.engine === e ? <Check className="size-3.5 text-accent" /> : undefined,
        disabled: !available,
        onSelect: () => setEngine(e),
      };
    });

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <IconButton label="Toggle sidebar" onClick={() => setState({ sidebar: sidebar ? null : 'files' })} className="sm:hidden">
        <PanelLeft className="size-4" />
      </IconButton>
      <button
        onClick={() => void closeProject()}
        className="focus-ring flex items-center rounded-md px-1 py-1 hover:bg-hover"
        title="All projects"
        aria-label="All projects"
      >
        <Logo className="md:hidden" />
        <div className="hidden md:block">
          <Wordmark className="h-6" />
        </div>
      </button>
      <span className="hidden h-5 w-px bg-line md:block" />
      <button
        onClick={(e) => projectMenu.open(e, projectItems(), true)}
        className="focus-ring flex min-w-0 max-w-64 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-fg hover:bg-hover"
        title="Switch project"
      >
        <FolderOpen className="size-4 shrink-0 text-muted" />
        <span className="truncate">{project?.name ?? 'Loading…'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </button>

      <div className="flex-1" />

      {compact && (
        <div className="flex rounded-md border border-line p-0.5">
          {(['editor', 'pdf'] as const).map((v) => (
            <button key={v} onClick={() => onMobileView(v)} className={clsx('rounded px-2.5 py-0.5 text-xs font-medium', mobileView === v ? 'bg-accent text-white' : 'text-muted')}>
              {v === 'editor' ? 'Source' : 'PDF'}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={(e) => engineMenu.open(e, engineItems(), true)}
        className="focus-ring hidden items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg sm:flex"
        title="TeX engine for this project"
      >
        <Columns2 className="size-3.5" />
        {project ? ENGINE_LABELS[project.engine] : '…'}
        <ChevronDown className="size-3" />
      </button>

      <div className="flex items-stretch">
        {running ? (
          <Button variant="danger" className="rounded-r-none" icon={<Square className="size-3.5 fill-current" />} onClick={cancelCompile} title="Stop compiling">
            Stop
          </Button>
        ) : (
          <Button variant="primary" className="rounded-r-none" icon={<Play className="size-3.5 fill-current" />} onClick={() => void compile({ reason: 'manual' })} title={`Compile (${modKey}+Enter)`}>
            Compile
          </Button>
        )}
        <button
          aria-label="Compile options"
          onClick={(e) =>
            compileMenu.open(
              e,
              [
                { label: 'Recompile from scratch', icon: <RotateCcw className="size-3.5" />, onSelect: () => void compile({ reason: 'manual', clean: true }) },
                { label: settings.autoCompile ? 'Auto-compile: on' : 'Auto-compile: off', icon: <Zap className={clsx('size-3.5', settings.autoCompile && 'text-accent')} />, onSelect: () => updateSettings({ autoCompile: !settings.autoCompile }) },
                { label: settings.haltOnError ? 'Stop on first error: on' : 'Stop on first error: off', icon: <Square className="size-3.5" />, onSelect: () => updateSettings({ haltOnError: !settings.haltOnError }) },
              ],
              true,
            )
          }
          className={clsx(
            'focus-ring flex w-7 items-center justify-center rounded-r-md border-l border-white/20 text-white',
            running ? 'bg-danger' : 'brand-gradient',
          )}
        >
          <ChevronDown className="size-3.5" />
        </button>
      </div>

      {project?.hasGit && (
        <IconButton label="Source control: commit, push and pull" onClick={() => setState({ sidebar: 'git' })}>
          <ArrowUpFromLine className="size-4" />
        </IconButton>
      )}
      <IconButton
        label="Download"
        onClick={(e) =>
          downloadMenu.open(
            e,
            [
              { label: 'PDF', icon: <FileDown className="size-3.5" />, onSelect: downloadPdf },
              { label: 'Project as .zip', icon: <FileArchive className="size-3.5" />, onSelect: downloadZip },
              { label: 'Current file', icon: <FileText className="size-3.5" />, onSelect: downloadActive },
            ],
            true,
          )
        }
      >
        <Download className="size-4" />
      </IconButton>
      <IconButton label="Toggle light/dark theme" onClick={() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')}>
        {settings.theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </IconButton>
      <button
        onClick={() => openDialog({ type: 'command-palette' })}
        className="focus-ring hidden h-8 items-center gap-2 rounded-md border border-line bg-panel-2 pl-2 pr-1.5 text-[12px] text-faint hover:text-muted lg:flex"
      >
        <Search className="size-3.5" /> Commands <Kbd>{modKey}⇧P</Kbd>
      </button>
      {projectMenu.node}
      {compileMenu.node}
      {downloadMenu.node}
      {engineMenu.node}
    </header>
  );
}
