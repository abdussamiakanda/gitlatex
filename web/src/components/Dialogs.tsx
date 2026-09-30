/**
 * All modal dialogs, rendered from the store's `dialog` field.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, FolderPlus, Search, Keyboard, GitCompare, FileArchive, FolderInput, Play, RotateCcw, FilePlus2, FolderPlus as FolderPlusIcon, Upload, Download, Moon, Crosshair, Zap, Files, ListTree, History, Cpu, FileText, Sparkles, GitBranch, GitCommitHorizontal, ArrowDownToLine, Home, ExternalLink } from 'lucide-react';
import { useStore, closeDialog, openDialog, setState, updateSettings, toast, getCompilerApi, setCompilerApi, type Dialog } from '../state/store';
import { MaterialIcon } from './MaterialIcon';
import {
  applyTheme, closeProject, compile, createProject, downloadPdf, downloadZip, forwardSearch, gitPull, importFolderAsProject, importZipAsProject, openFile, openProject, promptClone, promptNewFile, promptNewFolder, reconfigureEngine, runSlashCommand, serverInfo, setCompiler, setTheme, uploadFiles, workspace,
} from '../state/actions';
import { pickFiles } from '../storage/local-disk';
import { TEMPLATES } from '../templates';
import { SLASH_COMMANDS } from '../editor/slash-commands';
import { editorBridge } from '../editor/bridge';
import { monaco } from '../editor/monaco';
import { modKey } from '../utils/misc';
import { languageFor } from '../utils/paths';
import { WizardDialog } from './Wizards';
import { EditorFeatureSettings } from './EditorSettings';
import { AboutSettings } from './AboutSettings';
import { Button, Kbd, Modal, TextInput, Toggle, clsx } from './ui';
import { FileIcon } from './FileIcon';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  return <DialogSwitch dialog={dialog} />;
}

function DialogSwitch({ dialog }: { dialog: Dialog }) {
  switch (dialog.type) {
    case 'prompt':
      return <PromptDialog d={dialog} />;
    case 'confirm':
      return <ConfirmDialog d={dialog} />;
    case 'settings':
      return <SettingsDialog section={dialog.section} />;
    case 'new-project':
      return <NewProjectDialog initial={dialog.initialTemplate} />;
    case 'command-palette':
      return <CommandPalette />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'wizard':
      return <WizardDialog wizard={dialog.wizard} />;
    case 'diff':
      return <DiffDialog d={dialog} />;
  }
}

function PromptDialog({ d }: { d: Extract<Dialog, { type: 'prompt' }> }) {
  const [value, setValue] = useState(d.value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    closeDialog();
    d.onCancel?.();
  };
  const submit = async () => {
    setBusy(true);
    try {
      await d.onSubmit(value);
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={d.title} onClose={cancel} footer={<><Button variant="ghost" onClick={cancel}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>{d.confirm}</Button></>}>
      <label className="block text-[13px] text-muted">
        {d.label}
        <TextInput
          autoFocus
          className="mt-1.5"
          value={value}
          placeholder={d.placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf('.');
            const slash = e.target.value.lastIndexOf('/');
            e.target.setSelectionRange(slash + 1, dot > slash ? dot : e.target.value.length);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </label>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Modal>
  );
}

function ConfirmDialog({ d }: { d: Extract<Dialog, { type: 'confirm' }> }) {
  const [busy, setBusy] = useState(false);
  const cancel = () => {
    closeDialog();
    d.onCancel?.();
  };
  return (
    <Modal
      title={d.title}
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
          <Button
            variant={d.danger ? 'danger' : 'primary'}
            loading={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              try {
                closeDialog();
                await d.onConfirm();
              } catch (err) {
                toast({ kind: 'error', title: 'Something went wrong', message: err instanceof Error ? err.message : String(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {d.confirm}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{d.message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function SettingsDialog({ section: jumpTo }: { section?: 'about' }) {
  const s = useStore((st) => st.settings);
  useEffect(() => {
    if (jumpTo) requestAnimationFrame(() => document.getElementById(`settings-${jumpTo}`)?.scrollIntoView({ block: 'start' }));
  }, [jumpTo]);
  const [latex, setLatex] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    void serverInfo().then((info) => setLatex(info?.latex ?? null));
  }, []);
  const localNames = latex ? Object.entries(latex).filter(([, ok]) => ok).map(([name]) => name) : [];
  const [api, setApi] = useState(getCompilerApi);
  const section = (title: string) => <div className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted first:mt-0">{title}</div>;
  return (
    <Modal title="Settings" icon={<Settings className="size-4 text-accent" />} onClose={closeDialog} width="max-w-xl">
      {section('Appearance')}
      <div className="flex items-center justify-between py-2">
        <span className="text-[13px] text-fg">Theme</span>
        <div className="flex gap-1">
          {(['dark', 'light', 'system'] as const).map((t) => (
            <button key={t} onClick={() => setTheme(t)} className={clsx('rounded-md border px-3 py-1 text-xs capitalize', s.theme === t ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted')}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center justify-between py-2 text-[13px] text-fg">
        Editor font size
        <span className="flex items-center gap-2">
          <input type="range" min={11} max={22} value={s.editorFontSize} onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) })} className="accent-[var(--c-accent)]" />
          <span className="w-8 text-right tabular-nums text-muted">{s.editorFontSize}px</span>
        </span>
      </label>
      <Toggle label="Word wrap" checked={s.wordWrap} onChange={(v) => updateSettings({ wordWrap: v })} />
      <Toggle label="Minimap" checked={s.minimap} onChange={(v) => updateSettings({ minimap: v })} />
      <Toggle label="Formatting toolbar" description="Buttons for bold, lists, equations, tables, images…" checked={s.formatBar} onChange={(v) => updateSettings({ formatBar: v })} />

      {section('Writing assistance')}
      <Toggle label="Slash commands" description="Type / on an empty line to insert blocks" checked={s.slashCommands} onChange={(v) => updateSettings({ slashCommands: v })} />
      <Toggle label="Live math preview" description="Rendered preview of the formula under the cursor" checked={s.mathPreview} onChange={(v) => updateSettings({ mathPreview: v })} />
      <Toggle label="Explain errors in plain language" description="Friendly explanations and one-click fixes" checked={s.beginnerMode} onChange={(v) => updateSettings({ beginnerMode: v })} />

      <EditorFeatureSettings section={section} />

      {section('Compiler')}
      <div className="grid grid-cols-2 gap-1.5 py-2">
        {([
          ['auto', 'Auto', 'Local TeX if installed, otherwise the browser'],
          ['browser', 'In the browser', 'TeX Live as WebAssembly; nothing to install'],
          ['local', 'Local TeX', 'pdflatex / xelatex / lualatex on this machine'],
          ['api', 'Compiler API', 'A remote web service that compiles LaTeX'],
        ] as const).map(([id, label, hint]) => (
          <button
            key={id}
            onClick={() => setCompiler(id)}
            className={clsx('rounded-lg border p-2 text-left', s.compiler === id ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover')}
          >
            <div className="text-[13px] font-medium text-fg">{label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</div>
          </button>
        ))}
      </div>
      {s.compiler === 'api' && (
        <div className="space-y-2 rounded-lg border border-line bg-panel-2 p-3">
          <label className="block text-[13px] text-fg">
            Compiler API URL
            <TextInput
              className="mt-1"
              placeholder="https://latex.example.com/compile"
              value={api.url}
              onChange={(e) => setApi((a) => ({ ...a, url: e.target.value }))}
              onBlur={() => setCompilerApi({ url: api.url })}
            />
          </label>
          <label className="block text-[13px] text-fg">
            API key <span className="text-faint">(optional, sent as a Bearer token)</span>
            <TextInput
              className="mt-1"
              type="password"
              autoComplete="off"
              value={api.key}
              onChange={(e) => setApi((a) => ({ ...a, key: e.target.value }))}
              onBlur={() => setCompilerApi({ key: api.key })}
            />
          </label>
          <p className="text-[11.5px] text-faint">
            The project is sent as <code>{'{ main, files, engine }'}</code>; the service returns the PDF (and optionally SyncTeX).
            <a href="classic#/compiler-api" target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-accent hover:underline">
              How to build one <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      )}
      <p className="pb-1 text-[11.5px] text-faint">
        {latex === null ? 'Checking for a local TeX installation…' : localNames.length ? `Found on this machine: ${localNames.join(', ')}.` : 'No local TeX installation found, so Auto compiles in the browser.'}
      </p>
      <Toggle label="Save the PDF to the project folder" description="Browser and Compiler API builds write main.pdf next to main.tex, as local builds do" checked={s.savePdf} onChange={(v) => updateSettings({ savePdf: v })} />

      {section('Compilation')}
      <Toggle label="Auto-compile while typing" checked={s.autoCompile} onChange={(v) => updateSettings({ autoCompile: v })} />
      {s.autoCompile && (
        <label className="flex items-center justify-between py-2 text-[13px] text-fg">
          Delay after last keystroke
          <select value={s.autoCompileDelay} onChange={(e) => updateSettings({ autoCompileDelay: Number(e.target.value) })} className="h-8 rounded-md border border-line bg-panel-2 px-2 text-[13px]">
            {[800, 1500, 3000, 5000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center justify-between py-2 text-[13px] text-fg">
        Run BibTeX
        <select value={s.bibtex} onChange={(e) => updateSettings({ bibtex: e.target.value as typeof s.bibtex })} className="h-8 rounded-md border border-line bg-panel-2 px-2 text-[13px]">
          <option value="auto">When the document cites something</option>
          <option value="always">Always</option>
          <option value="never">Never</option>
        </select>
      </label>
      <Toggle label="Stop at the first error" description="Otherwise TeX recovers and still produces a PDF, like Overleaf" checked={s.haltOnError} onChange={(v) => updateSettings({ haltOnError: v })} />
      <Toggle
        label="Fetch missing packages on demand"
        description="Downloads TikZ, biblatex, extra fonts… from the package shelf when a document needs them"
        checked={s.useShelf}
        onChange={(v) => {
          updateSettings({ useShelf: v });
          reconfigureEngine();
        }}
      />

      {section('PDF')}
      <Toggle label="Dark pages" description="Invert PDF colours in the preview (not in the file)" checked={s.pdfDarkMode} onChange={(v) => updateSettings({ pdfDarkMode: v })} />
      <Toggle label="Use the browser's native PDF viewer" description="Loses SyncTeX double-click navigation" checked={s.pdfNative} onChange={(v) => updateSettings({ pdfNative: v })} />

      {section('Classic editor')}
      <div className="py-2 text-[13px] text-muted">
        The previous GitLaTeX editor is still available, and works on the same folders.
        <a href="classic" className="ml-1 inline-flex items-center gap-1 text-accent hover:underline">
          Open the classic editor <ExternalLink className="size-3" />
        </a>
      </div>

      {section('Advanced')}
      <label className="block py-1 text-[13px] text-fg">
        Engine manifest URL
        <TextInput className="mt-1" placeholder="engine/manifest.json (default)" value={s.engineUrl} onChange={(e) => updateSettings({ engineUrl: e.target.value })} onBlur={reconfigureEngine} />
      </label>
      <label className="block py-1 text-[13px] text-fg">
        Package shelf URL
        <TextInput className="mt-1" placeholder="shelf/index.json (default, cached by the gitlatex server)" value={s.shelfUrl} onChange={(e) => updateSettings({ shelfUrl: e.target.value })} onBlur={reconfigureEngine} />
      </label>

      <AboutSettings section={section} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function NewProjectDialog({ initial }: { initial?: string }) {
  const [tpl, setTpl] = useState(initial ?? 'paper');
  const [name, setName] = useState('');
  const [git, setGit] = useState(true);
  const [busy, setBusy] = useState(false);
  const t = TEMPLATES.find((x) => x.id === tpl)!;
  const create = async () => {
    setBusy(true);
    try {
      await createProject(name || t.name, tpl, git);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not create project', message: String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New project"
      icon={<FolderPlus className="size-4 text-accent" />}
      onClose={closeDialog}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" icon={<FileArchive className="size-3.5" />} className="mr-auto" onClick={async () => { const [f] = await pickFiles({ accept: '.zip', multiple: false }); if (f) { closeDialog(); void importZipAsProject(f); } }}>
            Import .zip
          </Button>
          <Button variant="ghost" icon={<FolderInput className="size-3.5" />} onClick={async () => { const files = await pickFiles({ directory: true }); if (files.length) { closeDialog(); void importFolderAsProject(files); } }}>
            Open folder
          </Button>
          <Button variant="ghost" icon={<GitBranch className="size-3.5" />} onClick={promptClone}>
            Clone repository
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>Create</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {TEMPLATES.map((x) => (
          <button
            key={x.id}
            onClick={() => setTpl(x.id)}
            onDoubleClick={() => void createProject(name || x.name, x.id, git)}
            className={clsx('flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors', tpl === x.id ? 'border-accent bg-accent/10' : 'border-line hover:border-muted hover:bg-hover')}
          >
            <MaterialIcon name={x.icon} size={28} className="text-accent" />
            <span className="text-[13px] font-semibold text-fg">{x.name}</span>
            <span className="line-clamp-2 text-[11px] leading-snug text-muted">{x.description}</span>
            <span className="mt-auto flex flex-wrap gap-1 pt-1">
              {x.tags.map((tag) => <span key={tag} className="rounded bg-panel-2 px-1.5 py-0.5 text-[9.5px] text-faint">{tag}</span>)}
            </span>
          </button>
        ))}
      </div>
      <label className="mt-4 block text-[13px] text-muted">
        Project name
        <TextInput className="mt-1.5" autoFocus placeholder={t.name} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
      </label>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
        <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} className="accent-[var(--c-accent)]" />
        Initialize a Git repository
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  group: string;
  run: () => void;
}

function CommandPalette() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const projects = useStore((s) => s.projects);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo<PaletteItem[]>(() => {
    const ws = workspace();
    const cmd = (id: string, label: string, icon: React.ReactNode, run: () => void, hint?: string): PaletteItem => ({ id, label, icon, run, hint, group: 'Commands' });
    return [
      cmd('compile', 'Compile', <Play className="size-4" />, () => void compile({ reason: 'manual' }), `${modKey}+Enter`),
      cmd('clean', 'Recompile from scratch', <RotateCcw className="size-4" />, () => void compile({ reason: 'manual', clean: true })),
      cmd('sync', 'Show current line in PDF (SyncTeX)', <Crosshair className="size-4" />, () => forwardSearch(), `${modKey}+Alt+J`),
      cmd('newfile', 'New file…', <FilePlus2 className="size-4" />, () => promptNewFile('')),
      cmd('newfolder', 'New folder…', <FolderPlusIcon className="size-4" />, () => promptNewFolder('')),
      cmd('upload', 'Upload files…', <Upload className="size-4" />, async () => void uploadFiles(await pickFiles())),
      cmd('newproject', 'New project…', <FolderPlus className="size-4" />, () => openDialog({ type: 'new-project' })),
      cmd('pdf', 'Download PDF', <Download className="size-4" />, downloadPdf),
      cmd('zip', 'Download project as .zip', <FileArchive className="size-4" />, downloadZip),
      cmd('pull', 'Git: pull', <ArrowDownToLine className="size-4" />, () => void gitPull()),
      cmd('commit', 'Git: commit or push…', <GitCommitHorizontal className="size-4" />, () => setState({ sidebar: 'git' })),
      cmd('clone', 'Clone a Git repository…', <GitBranch className="size-4" />, promptClone),
      cmd('home', 'All projects', <Home className="size-4" />, () => void closeProject()),
      cmd('auto', 'Toggle auto-compile', <Zap className="size-4" />, () => updateSettings({ autoCompile: !useStore.getState().settings.autoCompile })),
      cmd('theme', 'Toggle light/dark theme', <Moon className="size-4" />, () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')),
      cmd('files', 'Show files', <Files className="size-4" />, () => setState({ sidebar: 'files' })),
      cmd('outline', 'Show outline', <ListTree className="size-4" />, () => setState({ sidebar: 'outline' })),
      cmd('git', 'Source control', <GitBranch className="size-4" />, () => setState({ sidebar: 'git' })),
      cmd('history', 'Commit history', <History className="size-4" />, () => setState({ sidebar: 'history' })),
      cmd('engine', 'Compiler', <Cpu className="size-4" />, () => setState({ sidebar: 'engine' })),
      cmd('settings', 'Settings', <Settings className="size-4" />, () => openDialog({ type: 'settings' })),
      cmd('keys', 'Keyboard shortcuts', <Keyboard className="size-4" />, () => openDialog({ type: 'shortcuts' })),
      ...(ws?.paths() ?? []).map<PaletteItem>((p) => ({ id: `file:${p}`, label: p, icon: <FileIcon path={p} />, group: 'Files', run: () => openFile(p) })),
      ...projects.filter((p) => p.id !== ws?.project.id).map<PaletteItem>((p) => ({ id: `project:${p.id}`, label: p.name, icon: <FileText className="size-4" />, group: 'Switch project', run: () => void openProject(p.id) })),
      ...SLASH_COMMANDS.map<PaletteItem>((c) => ({
        id: `insert:${c.id}`,
        label: `Insert ${c.title.toLowerCase()}`,
        hint: `/${c.id}`,
        icon: <Sparkles className="size-4" />,
        group: 'Insert',
        run: () => {
          editorBridge.setSlashRange(null);
          runSlashCommand(c);
        },
      })),
    ];
  }, [projects]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items.filter((i) => i.group !== 'Insert').slice(0, 60);
    return items
      .map((i) => {
        const l = i.label.toLowerCase();
        let score = l.startsWith(t) ? 3 : l.includes(t) ? 2 : 0;
        if (!score) {
          let k = 0;
          for (const ch of l) if (ch === t[k]) k++;
          score = k === t.length ? 1 : 0;
        }
        return { i, score };
      })
      .filter((x) => x.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.i);
  }, [q, items]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }), [sel]);

  const run = (it?: PaletteItem) => {
    if (!it) return;
    closeDialog();
    setTimeout(it.run, 10);
  };
  let lastGroup = '';
  return (
    <Modal title="Command palette" icon={<Search className="size-4 text-accent" />} onClose={closeDialog} width="max-w-xl">
      <TextInput
        autoFocus
        placeholder="Type a command, file or /block…"
        value={q}
        onChange={(e) => setQ(e.target.value.replace(/^\//, 'insert '))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === 'Enter') run(filtered[sel]);
        }}
      />
      <div ref={listRef} className="mt-3 max-h-[50vh] overflow-y-auto">
        {filtered.map((it, idx) => {
          const header = it.group !== lastGroup;
          lastGroup = it.group;
          return (
            <div key={it.id}>
              {header && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{it.group}</div>}
              <button data-i={idx} onMouseEnter={() => setSel(idx)} onClick={() => run(it)} className={clsx('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]', idx === sel ? 'bg-accent/15 text-fg' : 'text-muted')}>
                <span className="text-muted">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
              </button>
            </div>
          );
        })}
        {!filtered.length && <div className="p-4 text-center text-xs text-muted">Nothing matches.</div>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ShortcutsDialog() {
  const rows: [string, string][] = [
    [`${modKey}+Enter  /  ${modKey}+S`, 'Compile'],
    [`${modKey}+Shift+P`, 'Command palette'],
    ['/', 'Slash commands (on an empty line or after a space)'],
    [`${modKey}+Space`, 'Autocomplete (commands, \\cite keys, \\ref labels, files)'],
    [`${modKey}+B / ${modKey}+I / ${modKey}+U`, 'Bold / italic / underline'],
    [`${modKey}+/`, 'Toggle comment'],
    [`${modKey}+Alt+J`, 'Show current line in the PDF (SyncTeX)'],
    ['Double-click PDF', 'Jump to the source line (SyncTeX)'],
    [`${modKey}+Click / F12`, 'Go to definition (\\ref → \\label, \\cite → .bib, \\input → file)'],
    [`${modKey}+F / ${modKey}+H`, 'Find / replace'],
    [`${modKey}+Shift+O`, 'Go to section'],
    [`${modKey}+.`, 'Quick fix for the error under the cursor'],
    [`${modKey}+Wheel on PDF`, 'Zoom the PDF'],
  ];
  return (
    <Modal title="Keyboard shortcuts" icon={<Keyboard className="size-4 text-accent" />} onClose={closeDialog} width="max-w-lg">
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-line/60 last:border-0">
              <td className="py-2 pr-4"><Kbd>{k}</Kbd></td>
              <td className="py-2 text-muted">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function DiffDialog({ d }: { d: Extract<Dialog, { type: 'diff' }> }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const lang = languageFor(d.path);
    const original = monaco.editor.createModel(d.original, lang);
    const modified = monaco.editor.createModel(d.modified, lang);
    const editor = monaco.editor.createDiffEditor(host.current, { readOnly: true, automaticLayout: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12.5, originalEditable: false });
    editor.setModel({ original, modified });
    applyTheme();
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [d]);
  return (
    <Modal
      title={d.title}
      icon={<GitCompare className="size-4 text-accent" />}
      onClose={closeDialog}
      width="max-w-6xl"
      footer={
        <>
          <span className="mr-auto text-xs text-muted">Left: saved version · Right: current</span>
          <Button variant="ghost" onClick={closeDialog}>Close</Button>
          {d.onRestore && (
            <Button variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => { closeDialog(); d.onRestore?.(); }}>
              Restore this version
            </Button>
          )}
        </>
      }
    >
      <div ref={host} className="h-[60vh] overflow-hidden rounded-lg border border-line" />
    </Modal>
  );
}
