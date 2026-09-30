import { useEffect, useState } from 'react';
import { useStore, openDialog, getState, setState } from './state/store';
import * as actions from './state/actions';
import { TopBar, Logo } from './components/TopBar';
import { ActivityBar, Sidebar } from './components/Sidebar';
import { SplitPane } from './components/SplitPane';
import { EditorPane } from './editor/EditorPane';
import { PdfPane } from './pdf/PdfPane';
import { BottomPanel } from './components/BottomPanel';
import { StatusBar } from './components/StatusBar';
import { Dialogs } from './components/Dialogs';
import { Toasts } from './components/Toasts';
import { Spinner } from './components/ui';
import { ProjectsHome } from './components/ProjectsHome';
import { editorBridge } from './editor/bridge';
import { monaco } from './editor/monaco';

function useCompact() {
  const [compact, setCompact] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const on = () => setCompact(window.innerWidth < 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return compact;
}

export default function App() {
  const booting = useStore((s) => s.booting);
  const hasProject = useStore((s) => !!s.project);
  const sidebar = useStore((s) => s.sidebar);
  const bottom = useStore((s) => s.bottom);
  const theme = useStore((s) => s.settings.theme);
  const compact = useCompact();
  const [mobileView, setMobileView] = useState<'editor' | 'pdf'>('editor');

  useEffect(() => {
    void actions.boot();
  }, []);

  useEffect(() => {
    actions.applyTheme();
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const on = () => actions.applyTheme();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [theme]);

  // Global shortcuts (Monaco handles its own while focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 's' || e.key === 'Enter')) {
        e.preventDefault();
        void actions.compile({ reason: 'manual' });
      } else if (mod && (e.key === 'p' || e.key === 'P' || e.key === 'k')) {
        e.preventDefault();
        if (!getState().dialog) openDialog({ type: 'command-palette' });
      } else if (e.key === 'Escape' && getState().bottom && !getState().dialog && !(e.target as HTMLElement).closest?.('.monaco-editor')) {
        setState({ bottom: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (booting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Logo className="size-12 text-xl" />
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading your projects…
        </div>
      </div>
    );
  }

  if (!hasProject) {
    return (
      <>
        <ProjectsHome />
        <Dialogs />
        <Toasts />
      </>
    );
  }

  const editorAndLog = (
    <SplitPane
      id="bottom"
      direction="vertical"
      sizeTarget="second"
      initial={220}
      min={90}
      collapsed={!bottom}
      first={<EditorPane />}
      second={<BottomPanel />}
      className="h-full"
    />
  );

  return (
    <div className="flex h-full flex-col">
      <TopBar compact={compact} mobileView={mobileView} onMobileView={setMobileView} />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <SplitPane
          id="sidebar"
          initial={264}
          min={180}
          max={520}
          collapsed={!sidebar}
          first={<Sidebar />}
          className="min-w-0 flex-1"
          second={
            compact ? (
              <div className="h-full">{mobileView === 'editor' ? editorAndLog : <PdfPane />}</div>
            ) : (
              <SplitPane id="editor-pdf" initial={0.5} min={280} first={editorAndLog} second={<PdfPane />} className="h-full" />
            )
          }
        />
      </div>
      <StatusBar />
      <Dialogs />
      <Toasts />
    </div>
  );
}

// Handy for debugging and end-to-end tests.
Object.assign(window, { __GITLATEX__: { actions, store: useStore, editor: editorBridge, monaco } });
