/**
 * Editor area: tabs, formatting bar, the Monaco editor (with slash menu, live
 * math preview, Vim mode, spell checking, snippets and review comments) and
 * previews for binary files.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Bold, FileText, Image as ImageIcon, Italic, Link2, List, ListOrdered, Sigma, Table2, Quote, X, FileCode2, BookMarked, Heading1, Download, Braces, Crosshair,
} from 'lucide-react';
import { monaco, registerLanguages } from './monaco';
import { getModel } from './models';
import { editorBridge } from './bridge';
import { registerProviders, mathAt } from './providers';
import { SlashMenu, MathPreview } from './SlashMenu';
import { filterSlash, SLASH_COMMANDS, type SlashCommand } from './slash-commands';
import { useStore, getState, setState, openDialog, promptText, toast } from '../state/store';
import { installSpellCheck, setSpellCheckEnabled } from './spell';
import { installSnippets } from './snippets';
import { installReview } from './review';
import { installConflictTools } from './conflicts';
import { setVimMode, type VimHooks } from './vim';
import {
  applyMarkers, applyQuickFix, closeTab, compile, ensurePackage, forwardSearch, openFile, runSlashCommand, uploadFiles, workspace, downloadActive,
} from '../state/actions';
import { basename, extname, isImagePath } from '../utils/paths';
import { formatBytes, modKey } from '../utils/misc';
import { IconButton, Button, EmptyState } from '../components/ui';
import { FileIcon } from '../components/FileIcon';

registerLanguages();

interface SlashState {
  line: number;
  column: number; // column of "/"
  query: string;
  selected: number;
  x: number;
  y: number;
  flipUp: boolean;
  /** Height available for the list, in px. */
  maxHeight: number;
}

/** Full height of the slash menu's list (Tailwind max-h-80) plus its border. */
const SLASH_MENU_HEIGHT = 330;

/** Whether `column` (1-based) is inside the braces of a command that Ctrl+click follows to its target. */
function onLinkArgument(line: string, column: number) {
  const re = /\\(?:\w*ref|cite\w*|input|include|subfile|includegraphics|bibliography|addbibresource)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const open = m.index + m[0].length - m[1].length; // 1-based column of the first argument character
    if (column >= open && column <= open + m[1].length) return true;
  }
  return false;
}

const vimHooks: VimHooks = {
  currentFile: () => getState().activePath,
  save: () => void workspace()?.flush(),
  compile: () => void compile({ reason: 'manual' }),
  view: () => forwardSearch(),
  toc: () => setState((s) => ({ sidebar: s.sidebar === 'outline' ? 'files' : 'outline' })),
  errors: () => setState({ bottom: 'problems' }),
  prompt: (title, value) => promptText(title, 'Name', value, 'Change'),
};

export function EditorPane() {
  const openTabs = useStore((s) => s.openTabs);
  const activePath = useStore((s) => s.activePath);
  const settings = useStore((s) => s.settings);
  const reveal = useStore((s) => s.reveal);
  const mainFile = useStore((s) => s.project?.mainFile);
  const treeVersion = useStore((s) => s.treeVersion);
  const epoch = useStore((s) => s.epoch);
  const hostRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  slashRef.current = slash;
  const [math, setMath] = useState<{ tex: string; display: boolean; x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const slashKey = useRef<monaco.editor.IContextKey<boolean> | null>(null);
  const vimBarRef = useRef<HTMLDivElement>(null);

  const file = activePath ? workspace()?.get(activePath) : undefined;
  const isText = file?.kind === 'text';
  void treeVersion;

  const slashItems = useMemo(() => (slash ? filterSlash(slash.query) : SLASH_COMMANDS), [slash]);
  const slashItemsRef = useRef(slashItems);
  slashItemsRef.current = slashItems;

  const acceptSlash = useCallback((cmd: SlashCommand) => {
    const s = slashRef.current;
    const e = editorRef.current;
    if (!s || !e) return;
    const pos = e.getPosition();
    editorBridge.setSlashRange({ startLineNumber: s.line, startColumn: s.column, endLineNumber: s.line, endColumn: pos && pos.lineNumber === s.line ? pos.column : s.column + 1 + s.query.length });
    setSlash(null);
    runSlashCommand(cmd);
  }, []);

  // ---- create the editor once ------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = getState().settings;
    const editor = monaco.editor.create(host, {
      model: null,
      theme: document.documentElement.dataset.theme === 'light' ? 'gitlatex-light' : 'gitlatex-dark',
      automaticLayout: true,
      // Monaco measures glyphs on a canvas, so it needs a concrete font stack (not a CSS
      // variable) — and single quotes: double quotes break the editor's generated styles.
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace",
      fontSize: s.editorFontSize,
      fontLigatures: true,
      lineHeight: 1.6,
      wordWrap: s.wordWrap ? 'on' : 'off',
      wrappingIndent: 'same',
      minimap: { enabled: s.minimap, renderCharacters: false },
      glyphMargin: false,
      folding: true,
      showFoldingControls: 'mouseover',
      renderLineHighlight: 'all',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active', indentation: true },
      stickyScroll: { enabled: true, maxLineCount: 3 },
      padding: { top: 10, bottom: 10 },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      tabCompletion: 'on',
      snippetSuggestions: 'inline',
      suggest: { showWords: false, preview: true },
      fixedOverflowWidgets: true,
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true },
      occurrencesHighlight: 'off',
      renderWhitespace: 'none',
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.OnCode },
    });
    editorRef.current = editor;
    editorBridge.set(editor);
    registerProviders({
      workspace,
      diagnostics: () => getState().compile.diagnostics,
      openFile,
      applyQuickFix,
      ensurePackage,
    });

    const spell = installSpellCheck(editor, s.spellCheck);
    const review = installReview(editor);
    const conflictTools = installConflictTools(editor, () => getState().scm?.sides);
    installSnippets(
      editor,
      () => promptText('New snippet', 'Prefix (type it, then press Tab)', '', 'Save'),
      (ok, message) => toast({ kind: ok ? 'success' : 'error', title: message }),
    );

    const slashOpen = editor.createContextKey('tbSlashOpen', false);
    slashKey.current = slashOpen;
    const K = monaco.KeyCode;
    const M = monaco.KeyMod;
    editor.addCommand(K.DownArrow, () => setSlash((s) => s && { ...s, selected: Math.min(s.selected + 1, slashItemsRef.current.length - 1) }), 'tbSlashOpen');
    editor.addCommand(K.UpArrow, () => setSlash((s) => s && { ...s, selected: Math.max(s.selected - 1, 0) }), 'tbSlashOpen');
    const accept = () => {
      const s = slashRef.current;
      const cmd = s && slashItemsRef.current[s.selected];
      if (cmd) acceptSlash(cmd);
      else setSlash(null);
    };
    editor.addCommand(K.Enter, accept, 'tbSlashOpen');
    editor.addCommand(K.Tab, accept, 'tbSlashOpen');
    editor.addCommand(K.Escape, () => setSlash(null), 'tbSlashOpen');

    // App shortcuts inside the editor.
    editor.addCommand(M.CtrlCmd | K.KeyS, () => void compile({ reason: 'manual' }));
    editor.addCommand(M.CtrlCmd | K.Enter, () => void compile({ reason: 'manual' }));
    // SyncTeX, source → PDF: Ctrl+Alt+J, right-click → Show in PDF, or Ctrl/Cmd+click.
    editor.addAction({
      id: 'gitlatex.synctex.showInPdf',
      label: 'Show in PDF',
      keybindings: [M.CtrlCmd | M.Alt | K.KeyJ],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0.5,
      run: () => forwardSearch(),
    });
    const syncClickSub = editor.onMouseDown((e) => {
      const ev = e.event;
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey || !ev.leftButton) return;
      if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !e.target.position) return;
      const model = editor.getModel();
      const pos = e.target.position;
      // Ctrl+click on a \ref, \cite, \input… argument goes to its definition instead.
      if (!model || onLinkArgument(model.getLineContent(pos.lineNumber), pos.column)) return;
      forwardSearch(pos.lineNumber);
    });
    editor.addCommand(M.CtrlCmd | M.Shift | K.KeyP, () => openDialog({ type: 'command-palette' }));
    const wrap = (cmd: string) => () => {
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model) return;
      const text = model.getValueInRange(sel);
      editor.executeEdits('format', [{ range: sel, text: `\\${cmd}{${text}}` }]);
      if (!text) {
        const p = editor.getPosition();
        if (p) editor.setPosition({ lineNumber: p.lineNumber, column: p.column - 1 });
      }
    };
    editor.addCommand(M.CtrlCmd | K.KeyB, wrap('textbf'));
    editor.addCommand(M.CtrlCmd | K.KeyI, wrap('textit'));
    editor.addCommand(M.CtrlCmd | K.KeyU, wrap('underline'));

    /**
     * Where to draw the slash menu for the "/" at line:col, relative to the pane.
     * Opens below the line, or above it when there is more room there; the list
     * height shrinks to whatever space is left. The anchor is clamped to the
     * visible area because the line can be briefly off-screen while Monaco
     * smooth-scrolls the cursor into view — the scroll listener re-places it.
     */
    const placeSlash = (line: number, col: number): Pick<SlashState, 'x' | 'y' | 'flipUp' | 'maxHeight'> => {
      const vis = editor.getScrolledVisiblePosition({ lineNumber: line, column: col });
      const pane = paneRef.current;
      if (!vis || !pane) return { x: 8, y: 8, flipUp: false, maxHeight: SLASH_MENU_HEIGHT - 10 };
      const hostRect = host.getBoundingClientRect();
      const paneRect = pane.getBoundingClientRect();
      const hostTop = hostRect.top - paneRect.top;
      const lineTop = Math.max(hostTop, Math.min(hostTop + vis.top, paneRect.height - vis.height));
      const below = lineTop + vis.height + 4;
      const spaceBelow = paneRect.height - below - 8;
      const spaceAbove = lineTop - 12;
      const flipUp = spaceBelow < SLASH_MENU_HEIGHT && spaceAbove > spaceBelow;
      return {
        x: Math.max(8, Math.min(hostRect.left - paneRect.left + vis.left, paneRect.width - 570)),
        y: flipUp ? paneRect.height - lineTop + 4 : below,
        flipUp,
        maxHeight: Math.max(120, Math.min(SLASH_MENU_HEIGHT, flipUp ? spaceAbove : spaceBelow) - 10),
      };
    };

    // Slash menu: open on "/" typed at line start or after whitespace.
    const contentSub = editor.onDidChangeModelContent((ev) => {
      if (!getState().settings.slashCommands) return;
      const model = editor.getModel();
      const pos = editor.getPosition();
      if (!model || !pos) return;
      const current = slashRef.current;
      if (!current && ev.changes.length === 1 && ev.changes[0].text === '/' && !ev.isUndoing && !ev.isRedoing) {
        const c = ev.changes[0];
        const line = c.range.startLineNumber;
        const col = c.range.startColumn;
        const before = model.getLineContent(line).slice(0, col - 1);
        if (/(^|\s)$/.test(before) && !/(^|[^\\])%/.test(before)) {
          setSlash({ line, column: col, query: '', selected: 0, ...placeSlash(line, col) });
        }
      }
    });
    // Keep the menu glued to its "/" while the editor scrolls (smooth reveal, wheel, layout).
    const scrollSub = editor.onDidScrollChange(() => {
      if (!slashRef.current) return;
      setSlash((s) => s && { ...s, ...placeSlash(s.line, s.column) });
    });
    const cursorSub = editor.onDidChangeCursorPosition((ev) => {
      const s = slashRef.current;
      const model = editor.getModel();
      if (s && model) {
        const p = ev.position;
        const lineText = model.getLineContent(s.line);
        if (p.lineNumber !== s.line || p.column <= s.column || lineText[s.column - 1] !== '/') setSlash(null);
        else {
          const query = lineText.slice(s.column, p.column - 1);
          if (query.length > 24 || /\s\s/.test(query) || /[\\{}$]/.test(query)) setSlash(null);
          else if (query !== s.query) setSlash({ ...s, query, selected: 0 });
        }
      }
      setState({ cursor: { line: ev.position.lineNumber, column: ev.position.column } });
    });
    const blurSub = editor.onDidBlurEditorWidget(() => {
      setSlash(null);
      setMath(null);
    });

    // Live math preview under the cursor.
    let mathTimer: ReturnType<typeof setTimeout> | undefined;
    const mathSub = editor.onDidChangeCursorSelection(() => {
      clearTimeout(mathTimer);
      mathTimer = setTimeout(() => {
        const model = editor.getModel();
        const pos = editor.getPosition();
        if (!getState().settings.mathPreview || !model || !pos || model.getLanguageId() !== 'latex' || slashRef.current) {
          setMath(null);
          return;
        }
        const m = mathAt(model, pos);
        if (!m) {
          setMath(null);
          return;
        }
        const vis = editor.getScrolledVisiblePosition({ lineNumber: m.endLine, column: 1 });
        const hostRect = host.getBoundingClientRect();
        const paneRect = paneRef.current!.getBoundingClientRect();
        if (!vis) return setMath(null);
        setMath({ tex: m.tex, display: m.display, x: hostRect.left - paneRect.left + 56, y: hostRect.top - paneRect.top + vis.top + vis.height + 6 });
      }, 180);
    });

    return () => {
      syncClickSub.dispose();
      spell.dispose();
      review.dispose();
      conflictTools.dispose();
      void setVimMode(editor, null, false, vimHooks);
      contentSub.dispose();
      scrollSub.dispose();
      cursorSub.dispose();
      blurSub.dispose();
      mathSub.dispose();
      clearTimeout(mathTimer);
      slashOpen.reset();
      editorBridge.set(null);
      editor.dispose();
      editorRef.current = null;
    };
  }, [acceptSlash]);

  // Keep the context key in sync with the menu so ↑ ↓ ↵ ⇥ esc go to the menu while it is open.
  useEffect(() => {
    slashKey.current?.set(!!slash);
  }, [slash]);

  // ---- settings → editor options --------------------------------------------------------
  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: settings.editorFontSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      minimap: { enabled: settings.minimap, renderCharacters: false },
    });
  }, [settings.editorFontSize, settings.wordWrap, settings.minimap]);

  // ---- Vim mode and spell checking follow their settings -------------------------------------
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    void setVimMode(editor, vimBarRef.current, settings.vim, vimHooks).catch((err: unknown) =>
      toast({ kind: 'error', title: 'Could not load Vim mode', message: err instanceof Error ? err.message : String(err) }),
    );
  }, [settings.vim]);

  useEffect(() => setSpellCheckEnabled(settings.spellCheck), [settings.spellCheck]);

  // ---- switch model when the active file changes -----------------------------------------
  const prevPath = useRef<string | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (prevPath.current) viewStates.current.set(prevPath.current, editor.saveViewState());
    prevPath.current = activePath;
    setSlash(null);
    setMath(null);
    if (!activePath || !isText) {
      editor.setModel(null);
      return;
    }
    const model = getModel(activePath);
    editor.setModel(model);
    const vs = viewStates.current.get(activePath);
    if (vs) editor.restoreViewState(vs);
    applyMarkers();
    if (!getState().dialog) editor.focus(); // never steal focus from an open dialog
  }, [activePath, isText, epoch]);

  // Forget per-file view state when another project is opened.
  useEffect(() => {
    viewStates.current.clear();
    prevPath.current = null;
  }, [epoch]);

  // ---- reveal requests (diagnostics, outline, SyncTeX) ----------------------------------------
  const flash = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !reveal || reveal.path !== activePath) return;
    const t = setTimeout(() => {
      const line = Math.max(1, Math.min(reveal.line, editor.getModel()?.getLineCount() ?? 1));
      editor.revealLineInCenter(line, monaco.editor.ScrollType.Smooth);
      editor.setPosition({ lineNumber: line, column: reveal.column ?? editor.getModel()?.getLineFirstNonWhitespaceColumn(line) ?? 1 });
      flash.current?.clear();
      flash.current = editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'tb-synctex-line' } }]);
      setTimeout(() => flash.current?.clear(), 1600);
      if (!getState().dialog) editor.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [reveal, activePath]);

  // ---- drag & drop files into the project ------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  };

  const fmt = (id: string) => () => {
    const cmd = SLASH_COMMANDS.find((c) => c.id === id);
    if (!cmd) return;
    editorBridge.setSlashRange(null);
    runSlashCommand(cmd);
  };

  return (
    <div
      ref={paneRef}
      className="relative flex h-full min-h-0 flex-col bg-panel"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      {/* Tabs */}
      <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-panel-2/60">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto" role="tablist">
        {openTabs.map((p) => (
          <div
            key={p}
            role="tab"
            aria-selected={p === activePath}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(p);
              }
            }}
            onClick={() => openFile(p)}
            title={p}
            className={clsx(
              'group flex max-w-52 shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-3 text-[12.5px]',
              p === activePath ? 'bg-panel text-fg shadow-[inset_0_2px_0_var(--c-accent)]' : 'text-muted hover:bg-hover hover:text-fg',
            )}
          >
            <FileIcon path={p} className="size-3.5 shrink-0" />
            <span className="truncate">{basename(p)}</span>
            {p === mainFile && <span className="rounded bg-accent/15 px-1 text-[9px] font-semibold uppercase text-accent">main</span>}
            <button
              aria-label={`Close ${basename(p)}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(p);
              }}
              className="ml-0.5 rounded p-0.5 text-faint opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 aria-[selected=true]:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
      </div>

      {/* Formatting bar (great for beginners) */}
      {settings.formatBar && isText && extname(activePath ?? '') === 'tex' && (
        <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2">
          <IconButton size="sm" label={`Bold (${modKey}+B)`} onClick={fmt('bold')}><Bold className="size-3.5" /></IconButton>
          <IconButton size="sm" label={`Italic (${modKey}+I)`} onClick={fmt('italic')}><Italic className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Section heading" onClick={fmt('section')}><Heading1 className="size-3.5" /></IconButton>
          <span className="mx-1 h-4 w-px bg-line" />
          <IconButton size="sm" label="Bulleted list" onClick={fmt('itemize')}><List className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Numbered list" onClick={fmt('enumerate')}><ListOrdered className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Quote" onClick={fmt('quote')}><Quote className="size-3.5" /></IconButton>
          <span className="mx-1 h-4 w-px bg-line" />
          <IconButton size="sm" label="Equation" onClick={fmt('equation')}><Sigma className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Matrix" onClick={fmt('matrix')}><Braces className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Table" onClick={fmt('table')}><Table2 className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Image" onClick={fmt('image')}><ImageIcon className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Link" onClick={fmt('link')}><Link2 className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Citation" onClick={fmt('cite')}><BookMarked className="size-3.5" /></IconButton>
          <IconButton size="sm" label="Code listing" onClick={fmt('code')}><FileCode2 className="size-3.5" /></IconButton>
          <div className="flex-1" />
          <IconButton size="sm" label={`Show in PDF (${modKey}+Alt+J)`} onClick={() => forwardSearch()}><Crosshair className="size-3.5" /></IconButton>
          <span className="hidden whitespace-nowrap pl-2 text-[11px] text-faint md:inline">
            Type <kbd className="rounded border border-line px-1 font-mono">/</kbd> for blocks
          </span>
        </div>
      )}

      {/* Monaco, with the Vim status bar under it */}
      <div className={clsx('flex min-h-0 flex-1', !isText && 'hidden')}>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div ref={hostRef} className="absolute inset-0" data-testid="editor" />
          </div>
          {settings.vim && <div ref={vimBarRef} className="vim-statusbar" />}
        </div>
      </div>

      {/* Binary / empty states */}
      {!isText && (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          {!activePath || !file ? (
            <EmptyState icon={<FileText className="size-10" />} title="No file open">
              Pick a file in the sidebar, or drop files here to add them to the project.
            </EmptyState>
          ) : isImagePath(activePath) ? (
            <BinaryPreview path={activePath} data={file.data} />
          ) : (
            <EmptyState icon={<FileText className="size-10" />} title={basename(activePath)}>
              Binary file · {formatBytes(file.data?.length ?? 0)}
              <div className="mt-3">
                <Button size="sm" icon={<Download className="size-3.5" />} onClick={downloadActive}>
                  Download
                </Button>
              </div>
            </EmptyState>
          )}
        </div>
      )}

      {slash && <SlashMenu items={slashItems} selected={slash.selected} query={slash.query} x={slash.x} y={slash.y} flipUp={slash.flipUp} maxHeight={slash.maxHeight} onHover={(i) => setSlash((s) => s && { ...s, selected: i })} onSelect={acceptSlash} />}

      {math && !slash && (
        <div className="animate-pop pointer-events-none absolute z-30 max-w-[calc(100%-72px)] overflow-hidden rounded-lg border border-line bg-panel px-4 py-3 shadow-pop" style={{ left: math.x, top: math.y }}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Preview</div>
          <MathPreview tex={math.tex} display={math.display} />
        </div>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-sm font-medium text-accent">
          Drop files to add them to the project
        </div>
      )}
    </div>
  );
}

function BinaryPreview({ path, data }: { path: string; data?: Uint8Array }) {
  const url = useMemo(() => {
    if (!data) return null;
    const type = extname(path) === 'svg' ? 'image/svg+xml' : extname(path) === 'pdf' ? 'application/pdf' : `image/${extname(path).replace('jpg', 'jpeg')}`;
    return URL.createObjectURL(new Blob([data as BlobPart], { type }));
  }, [path, data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!url) return null;
  const inc = `\\includegraphics[width=0.8\\linewidth]{${path}}`;
  return (
    <div className="flex max-h-full max-w-full flex-col items-center gap-3">
      {extname(path) === 'pdf' ? (
        <iframe title={path} src={url} className="h-[70vh] w-[min(900px,90vw)] rounded-lg border border-line bg-white" />
      ) : extname(path) === 'eps' ? (
        <div className="text-sm text-muted">EPS preview is not supported — it still works in LaTeX via the engine.</div>
      ) : (
        <img src={url} alt={path} className="max-h-[65vh] max-w-full rounded-lg border border-line bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain" />
      )}
      <div className="flex items-center gap-2 text-xs text-muted">
        <code className="rounded bg-panel-2 px-2 py-1 font-mono">{inc}</code>
        <Button size="sm" onClick={() => void navigator.clipboard?.writeText(inc)}>Copy</Button>
        <Button size="sm" icon={<Download className="size-3.5" />} onClick={downloadActive}>Download</Button>
        <span>{formatBytes(data?.length ?? 0)}</span>
      </div>
    </div>
  );
}
