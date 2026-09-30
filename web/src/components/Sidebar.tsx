import { Files, ListTree, History, Cpu, Settings, Keyboard, CircleHelp, GitBranch, Home, MessageSquareText } from 'lucide-react';
import { useStore, setState, openDialog, type SidebarView } from '../state/store';
import { FileTree } from './FileTree';
import { OutlinePanel } from './OutlinePanel';
import { GitPanel } from './GitPanel';
import { ReviewPanel } from './ReviewPanel';
import { HistoryPanel } from './HistoryPanel';
import { EnginePanel } from './EnginePanel';
import { clsx } from './ui';
import { closeProject, newProjectDialog } from '../state/actions';

const VIEWS: { id: SidebarView; label: string; icon: React.ReactNode }[] = [
  { id: 'files', label: 'Files', icon: <Files className="size-[18px]" /> },
  { id: 'outline', label: 'Outline', icon: <ListTree className="size-[18px]" /> },
  { id: 'review', label: 'Review comments', icon: <MessageSquareText className="size-[18px]" /> },
  { id: 'git', label: 'Source control', icon: <GitBranch className="size-[18px]" /> },
  { id: 'history', label: 'Commit history', icon: <History className="size-[18px]" /> },
  { id: 'engine', label: 'Compiler', icon: <Cpu className="size-[18px]" /> },
];

export function ActivityBar() {
  const sidebar = useStore((s) => s.sidebar);
  const reviewCount = useStore((s) => s.reviewCount);
  const update = useStore((s) => s.update);
  const hasUpdate = !!update?.updateAvailable;
  const btn = (active: boolean, label: string, icon: React.ReactNode, onClick: () => void, badge = 0) => (
    <button
      key={label}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'focus-ring relative flex size-10 items-center justify-center rounded-lg transition-colors',
        active ? 'text-fg before:absolute before:-left-1.5 before:h-5 before:w-0.5 before:rounded-full before:bg-accent' : 'text-faint hover:text-fg',
      )}
    >
      {icon}
      {badge < 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-accent-2 ring-2 ring-panel" aria-hidden />}
      {badge > 0 && (
        <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent-2 px-1 text-[9.5px] font-semibold leading-4 text-white">{badge}</span>
      )}
    </button>
  );
  return (
    <nav className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2 sm:flex" aria-label="Sidebar views">
      {btn(false, 'All projects', <Home className="size-[18px]" />, () => void closeProject())}
      <div className="my-1 h-px w-6 bg-line" />
      {VIEWS.map((v) => btn(sidebar === v.id, v.label, v.icon, () => setState({ sidebar: sidebar === v.id ? null : v.id }), v.id === 'review' ? reviewCount : 0))}
      <div className="flex-1" />
      {btn(false, 'Help & templates', <CircleHelp className="size-[18px]" />, () => newProjectDialog())}
      {btn(false, 'Keyboard shortcuts', <Keyboard className="size-[18px]" />, () => openDialog({ type: 'shortcuts' }))}
      {btn(false, hasUpdate ? `Settings: GitLaTeX ${update?.latest} is available` : 'Settings', <Settings className="size-[18px]" />, () => openDialog({ type: 'settings' }), hasUpdate ? -1 : 0)}
    </nav>
  );
}

export function Sidebar() {
  const sidebar = useStore((s) => s.sidebar);
  return (
    <aside className="h-full border-r border-line bg-panel" aria-label="Sidebar">
      {sidebar === 'files' && <FileTree />}
      {sidebar === 'outline' && <OutlinePanel />}
      {sidebar === 'review' && <ReviewPanel />}
      {sidebar === 'git' && <GitPanel />}
      {sidebar === 'history' && <HistoryPanel />}
      {sidebar === 'engine' && <EnginePanel />}
    </aside>
  );
}
