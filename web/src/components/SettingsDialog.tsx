/**
 * The Settings dialog: a category list on the left, one page of grouped
 * settings on the right.
 */
import { useEffect, useState } from 'react';
import { Settings, Palette, SquarePen, SpellCheck, Braces, Cpu, FileText, SlidersHorizontal, Info, ExternalLink, Sun, Moon, Monitor, Wand2, Globe, Users, KeyRound } from 'lucide-react';
import { useStore, closeDialog, updateSettings, getCompilerApi, setCompilerApi } from '../state/store';
import { gitIdentity, reconfigureEngine, serverInfo, setCollabAdmin, setCompiler, setTheme } from '../state/actions';
import { AdminLogin, ColorPicker, RoomList } from './CollabPanel';
import { VimSettings, SpellSettings, SnippetManager } from './EditorSettings';
import { AboutSettings } from './AboutSettings';
import { COMPILER_API_REPO } from './EnginePanel';
import { Button, Modal, TextInput, Toggle, clsx } from './ui';

type Page = 'appearance' | 'editor' | 'spelling' | 'snippets' | 'compiler' | 'pdf' | 'collab' | 'advanced' | 'about';

const PAGES: { id: Page; label: string; icon: React.ReactNode; description: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette className="size-4" />, description: 'Theme, text size and what the editor shows.' },
  { id: 'editor', label: 'Editor', icon: <SquarePen className="size-4" />, description: 'Keybindings and writing assistance while you type.' },
  { id: 'spelling', label: 'Spelling', icon: <SpellCheck className="size-4" />, description: 'Spell checking and your personal dictionary.' },
  { id: 'snippets', label: 'Snippets', icon: <Braces className="size-4" />, description: 'Reusable blocks of LaTeX inserted from a short prefix.' },
  { id: 'compiler', label: 'Compiler', icon: <Cpu className="size-4" />, description: 'Where documents are built, and how.' },
  { id: 'pdf', label: 'PDF viewer', icon: <FileText className="size-4" />, description: 'How the compiled PDF is shown.' },
  { id: 'collab', label: 'Collaboration', icon: <Users className="size-4" />, description: 'Your live collaboration relay and how others see you. Used by every project.' },
  { id: 'advanced', label: 'Advanced', icon: <SlidersHorizontal className="size-4" />, description: 'The classic editor and engine download locations.' },
  { id: 'about', label: 'About', icon: <Info className="size-4" />, description: 'Version, updates and support.' },
];

/** Settings rows sit in bordered groups; this is their padding. */
const ROW = 'py-3';

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      {title && <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h4>}
      <div className="divide-y divide-line rounded-lg border border-line bg-panel-2/40 px-4">{children}</div>
    </section>
  );
}

/** A labelled setting with its control on the right (or below, with `stacked`). */
function Field({ label, description, stacked, children }: { label: string; description?: React.ReactNode; stacked?: boolean; children: React.ReactNode }) {
  return (
    <div className={clsx(ROW, !stacked && 'flex flex-wrap items-center justify-between gap-x-6 gap-y-2')}>
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
      </div>
      <div className={stacked ? 'mt-2' : 'shrink-0'}>{children}</div>
    </div>
  );
}

const Switch = (props: React.ComponentProps<typeof Toggle>) => <Toggle className={ROW} {...props} />;

const selectClass = 'focus-ring h-8 rounded-md border border-line bg-panel-2 px-2 text-[13px] text-fg';

export function SettingsDialog({ section }: { section?: 'about' }) {
  const [page, setPage] = useState<Page>(section ?? 'appearance');
  const current = PAGES.find((p) => p.id === page)!;
  return (
    <Modal title="Settings" icon={<Settings className="size-4 text-accent" />} onClose={closeDialog} width="max-w-4xl" bodyClassName="p-0">
      <div className="flex h-[min(680px,75vh)] flex-col sm:flex-row">
        <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-line bg-panel-2/40 p-2 sm:w-52 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r" aria-label="Settings sections">
          {PAGES.map((p) => (
            <button
              key={p.id}
              onClick={() => setPage(p.id)}
              aria-current={page === p.id ? 'page' : undefined}
              className={clsx(
                'focus-ring flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px]',
                page === p.id ? 'bg-accent/15 font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg',
              )}
            >
              <span className={page === p.id ? 'text-accent' : ''}>{p.icon}</span>
              {p.label}
            </button>
          ))}
        </nav>
        {/* Keyed so each page starts scrolled to the top. */}
        <div key={page} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <h3 className="text-[15px] font-semibold text-fg">{current.label}</h3>
          <p className="mb-5 mt-0.5 text-[12.5px] text-muted">{current.description}</p>
          {page === 'appearance' && <AppearancePage />}
          {page === 'editor' && <EditorPage />}
          {page === 'spelling' && (
            <Group>
              <SpellSettings rowClassName={ROW} />
            </Group>
          )}
          {page === 'snippets' && <SnippetManager />}
          {page === 'compiler' && <CompilerPage />}
          {page === 'pdf' && <PdfPage />}
          {page === 'collab' && <CollabPage />}
          {page === 'advanced' && <AdvancedPage />}
          {page === 'about' && (
            <AboutSettings section={(title) => <h4 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted first:mt-0">{title}</h4>} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function AppearancePage() {
  const s = useStore((st) => st.settings);
  return (
    <>
      <Group>
        <Field label="Theme">
          <div className="flex rounded-lg border border-line p-0.5" role="radiogroup" aria-label="Theme">
            {([
              ['light', 'Light', <Sun key="i" className="size-3.5" />],
              ['dark', 'Dark', <Moon key="i" className="size-3.5" />],
              ['system', 'System', <Monitor key="i" className="size-3.5" />],
            ] as const).map(([t, label, icon]) => (
              <button
                key={t}
                role="radio"
                aria-checked={s.theme === t}
                onClick={() => setTheme(t)}
                className={clsx('flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium', s.theme === t ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Editor font size">
          <span className="flex items-center gap-3">
            <input type="range" min={11} max={22} value={s.editorFontSize} onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) })} className="w-40 accent-[var(--c-accent)]" aria-label="Editor font size" />
            <span className="w-9 text-right text-[13px] tabular-nums text-muted">{s.editorFontSize}px</span>
          </span>
        </Field>
      </Group>
      <Group title="Editor layout">
        <Switch label="Word wrap" description="Wrap long lines instead of scrolling sideways" checked={s.wordWrap} onChange={(v) => updateSettings({ wordWrap: v })} />
        <Switch label="Minimap" description="A zoomed-out view of the file beside the scrollbar" checked={s.minimap} onChange={(v) => updateSettings({ minimap: v })} />
        <Switch label="Formatting toolbar" description="Buttons for bold, lists, equations, tables, images…" checked={s.formatBar} onChange={(v) => updateSettings({ formatBar: v })} />
      </Group>
    </>
  );
}

function EditorPage() {
  const s = useStore((st) => st.settings);
  return (
    <>
      <Group title="Writing assistance">
        <Switch label="Slash commands" description="Type / on an empty line to insert blocks" checked={s.slashCommands} onChange={(v) => updateSettings({ slashCommands: v })} />
        <Switch label="Live math preview" description="Rendered preview of the formula under the cursor" checked={s.mathPreview} onChange={(v) => updateSettings({ mathPreview: v })} />
        <Switch label="Explain errors in plain language" description="Friendly explanations and one-click fixes" checked={s.beginnerMode} onChange={(v) => updateSettings({ beginnerMode: v })} />
      </Group>
      <Group title="Keybindings">
        <VimSettings rowClassName={ROW} />
      </Group>
    </>
  );
}

const COMPILERS = [
  ['auto', 'Auto', 'Local TeX if installed, otherwise the browser', <Wand2 key="i" className="size-4" />],
  ['browser', 'In the browser', 'TeX Live as WebAssembly; nothing to install', <Cpu key="i" className="size-4" />],
  ['local', 'Local TeX', 'pdflatex / xelatex / lualatex on this machine', <Monitor key="i" className="size-4" />],
  ['api', 'Compiler API', 'A remote web service that compiles LaTeX', <Globe key="i" className="size-4" />],
] as const;

function CompilerPage() {
  const s = useStore((st) => st.settings);
  const [latex, setLatex] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    void serverInfo().then((info) => setLatex(info?.latex ?? null));
  }, []);
  const localNames = latex ? Object.entries(latex).filter(([, ok]) => ok).map(([name]) => name) : [];
  const [api, setApi] = useState(getCompilerApi);
  return (
    <>
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Build documents with</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {COMPILERS.map(([id, label, hint, icon]) => (
            <button
              key={id}
              onClick={() => setCompiler(id)}
              className={clsx('focus-ring flex items-start gap-3 rounded-lg border p-3 text-left', s.compiler === id ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover')}
            >
              <span className={clsx('mt-0.5', s.compiler === id ? 'text-accent' : 'text-muted')}>{icon}</span>
              <span>
                <span className="block text-[13px] font-medium text-fg">{label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{hint}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          {latex === null ? 'Checking for a local TeX installation…' : localNames.length ? `Found on this machine: ${localNames.join(', ')}.` : 'No local TeX installation found, so Auto compiles in the browser.'}
        </p>
      </section>

      {s.compiler === 'api' && (
        <Group title="Compiler API">
          <Field label="Endpoint URL" stacked>
            <TextInput placeholder="https://latex.example.com/compile" value={api.url} onChange={(e) => setApi((a) => ({ ...a, url: e.target.value }))} onBlur={() => setCompilerApi({ url: api.url })} />
          </Field>
          <Field label="API key" description="Optional; sent as a Bearer token." stacked>
            <TextInput type="password" autoComplete="off" value={api.key} onChange={(e) => setApi((a) => ({ ...a, key: e.target.value }))} onBlur={() => setCompilerApi({ key: api.key })} />
          </Field>
          <div className={clsx(ROW, 'text-[12px] text-muted')}>
            The project is sent as <code>{'{ main, files, engine }'}</code>; the service returns the PDF (and optionally SyncTeX).
            <a href={COMPILER_API_REPO} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-accent hover:underline">
              Deploy your own Compiler API (latex-fastapi) <ExternalLink className="size-3" />
            </a>
          </div>
        </Group>
      )}

      <Group title="Output">
        <Switch label="Save the PDF to the project folder" description="Browser and Compiler API builds write main.pdf next to main.tex, as local builds do" checked={s.savePdf} onChange={(v) => updateSettings({ savePdf: v })} />
      </Group>

      <Group title="Compilation">
        <Switch label="Auto-compile while typing" checked={s.autoCompile} onChange={(v) => updateSettings({ autoCompile: v })} />
        {s.autoCompile && (
          <Field label="Delay after last keystroke">
            <select value={s.autoCompileDelay} onChange={(e) => updateSettings({ autoCompileDelay: Number(e.target.value) })} className={selectClass}>
              {[800, 1500, 3000, 5000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s</option>)}
            </select>
          </Field>
        )}
        <Field label="Run BibTeX">
          <select value={s.bibtex} onChange={(e) => updateSettings({ bibtex: e.target.value as typeof s.bibtex })} className={selectClass}>
            <option value="auto">When the document cites something</option>
            <option value="always">Always</option>
            <option value="never">Never</option>
          </select>
        </Field>
        <Switch label="Stop at the first error" description="Otherwise TeX recovers and still produces a PDF, like Overleaf" checked={s.haltOnError} onChange={(v) => updateSettings({ haltOnError: v })} />
        <Switch
          label="Fetch missing packages on demand"
          description="Downloads TikZ, biblatex, extra fonts… from the package shelf when a document needs them"
          checked={s.useShelf}
          onChange={(v) => {
            updateSettings({ useShelf: v });
            reconfigureEngine();
          }}
        />
      </Group>
    </>
  );
}

function PdfPage() {
  const s = useStore((st) => st.settings);
  return (
    <Group>
      <Switch label="Dark pages" description="Invert PDF colours in the preview (not in the file)" checked={s.pdfDarkMode} onChange={(v) => updateSettings({ pdfDarkMode: v })} />
      <Switch label="Use the browser's native PDF viewer" description="Loses SyncTeX double-click navigation" checked={s.pdfNative} onChange={(v) => updateSettings({ pdfNative: v })} />
    </Group>
  );
}

function CollabPage() {
  const admin = useStore((st) => st.collabAdmin);
  const project = useStore((st) => st.project);
  const [me, setMe] = useState<{ name: string; configured: boolean } | null>(null);
  useEffect(() => {
    if (project) void gitIdentity().then(setMe);
  }, [project]);
  return (
    <>
      <Group title="Relay owner">
        {admin ? (
          <div className={clsx(ROW, 'flex items-center gap-3')}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok">
              <KeyRound className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-fg">Signed in as the relay’s owner</div>
              <div className="mt-0.5 truncate font-mono text-[12px] text-muted" title={admin.host}>
                {admin.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}
              </div>
              <div className="mt-1 text-xs text-faint">Host projects from the Live collaboration tab.</div>
            </div>
            <Button size="sm" className="shrink-0" onClick={() => setCollabAdmin(null)}>
              Sign out
            </Button>
          </div>
        ) : (
          <div className={ROW}>
            <p className="mb-3 flex items-start gap-2 text-xs text-muted">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-accent" />
              Only the relay’s owner signs in here, with the admin token chosen when deploying it. Co-authors don’t need this: they join from the Live collaboration tab with an invite.
            </p>
            <AdminLogin />
          </div>
        )}
      </Group>
      {admin && (
        <section className="mt-6">
          <RoomList admin={admin} />
        </section>
      )}
      <Group title="You">
        <Field
          label="Name"
          description={
            me && !me.configured ? (
              <>No git user.name is set, so others see you as “Anonymous”. Set it with <code>git config --global user.name "Your Name"</code>.</>
            ) : (
              'Your git user.name, the same name your commits and review comments use.'
            )
          }
        >
          {me?.configured && <span className="text-[13px] font-medium text-fg">{me.name}</span>}
        </Field>
        <Field label="Cursor colour" description="How your cursor and selection look to others.">
          <ColorPicker heading={false} />
        </Field>
      </Group>
    </>
  );
}

function AdvancedPage() {
  const s = useStore((st) => st.settings);
  return (
    <>
      <Group title="Classic editor">
        <div className={clsx(ROW, 'text-[13px] text-muted')}>
          The previous GitLaTeX editor is still available, and works on the same folders.
          <a href="classic" className="ml-1 inline-flex items-center gap-1 text-accent hover:underline">
            Open the classic editor <ExternalLink className="size-3" />
          </a>
        </div>
      </Group>
      <Group title="In-browser engine">
        <Field label="Engine manifest URL" stacked>
          <TextInput placeholder="engine/manifest.json (default)" value={s.engineUrl} onChange={(e) => updateSettings({ engineUrl: e.target.value })} onBlur={reconfigureEngine} />
        </Field>
        <Field label="Package shelf URL" stacked>
          <TextInput placeholder="shelf/index.json (default, cached by the gitlatex server)" value={s.shelfUrl} onChange={(e) => updateSettings({ shelfUrl: e.target.value })} onBlur={reconfigureEngine} />
        </Field>
      </Group>
    </>
  );
}
