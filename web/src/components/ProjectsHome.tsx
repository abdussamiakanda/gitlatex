/**
 * The projects home: every folder in the server's repos directory. New project
 * opens the dialog that also offers a Git clone, a .zip or a folder import.
 */
import { useMemo, useState } from 'react';
import { FolderGit2, Folder, Plus, Search, MoreHorizontal, Pencil, Copy, Trash2, Moon, Sun, Settings } from 'lucide-react';
import { useStore, openDialog } from '../state/store';
import { confirmDeleteProject, duplicateProject, newProjectDialog, openProject, promptRenameProject, setTheme } from '../state/actions';
import { TEMPLATES } from '../templates';
import { timeAgo } from '../utils/misc';
import { Button, IconButton, TextInput, useMenu } from './ui';
import { Wordmark } from './TopBar';
import { MaterialIcon } from './MaterialIcon';

export function ProjectsHome() {
  const projects = useStore((s) => s.projects);
  const theme = useStore((s) => s.settings.theme);
  const update = useStore((s) => s.update);
  const [query, setQuery] = useState('');
  const menu = useMenu();
  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())), [projects, query]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <Wordmark className="h-8" />
        <div className="flex-1" />
        <IconButton label="Toggle light/dark theme" onClick={() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </IconButton>
        <IconButton label={update?.updateAvailable ? `Settings: GitLaTeX ${update.latest} is available` : 'Settings'} onClick={() => openDialog({ type: 'settings' })} className="relative">
          <Settings className="size-4" />
          {update?.updateAvailable && <span className="absolute right-1 top-1 size-2 rounded-full bg-accent-2 ring-2 ring-panel" aria-hidden />}
        </IconButton>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-fg">Projects</h1>
            <p className="mt-1 text-[13px] text-muted">Folders on this machine. Git projects can be committed, pushed and pulled from the editor.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => newProjectDialog()}>New project</Button>
        </div>

        {projects.length > 6 && (
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <TextInput className="pl-8" placeholder="Filter projects" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}

        {projects.length ? (
          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {shown.map((p) => (
              <li key={p.id} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
                <button className="focus-ring flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void openProject(p.id)}>
                  {p.hasGit ? <FolderGit2 className="size-5 shrink-0 text-accent" /> : <Folder className="size-5 shrink-0 text-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-fg">{p.name}</span>
                    <span className="block text-[11.5px] text-faint">{p.hasGit ? 'Git repository' : 'Folder'}{p.updatedAt ? ` · changed ${timeAgo(p.updatedAt)}` : ''}</span>
                  </span>
                </button>
                <IconButton
                  label={`Actions for ${p.name}`}
                  onClick={(e) =>
                    menu.open(e, [
                      { label: 'Rename…', icon: <Pencil className="size-3.5" />, onSelect: () => promptRenameProject(p.id) },
                      { label: 'Duplicate', icon: <Copy className="size-3.5" />, onSelect: () => void duplicateProject(p.id) },
                      'separator',
                      { label: 'Delete…', icon: <Trash2 className="size-3.5" />, danger: true, onSelect: () => confirmDeleteProject(p.id) },
                    ])
                  }
                >
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </li>
            ))}
            {!shown.length && <li className="px-3 py-6 text-center text-[13px] text-faint">No project matches “{query}”.</li>}
          </ul>
        ) : (
          <section className="mt-8">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">Start from a template</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {TEMPLATES.filter((t) => t.id !== 'welcome').map((t) => (
                <button
                  key={t.id}
                  onClick={() => newProjectDialog(t.id)}
                  className="flex flex-col items-start gap-1 rounded-xl border border-line p-3 text-left hover:border-muted hover:bg-hover"
                >
                  <MaterialIcon name={t.icon} size={28} className="text-accent" />
                  <span className="text-[13px] font-semibold text-fg">{t.name}</span>
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted">{t.description}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      {menu.node}
    </div>
  );
}
