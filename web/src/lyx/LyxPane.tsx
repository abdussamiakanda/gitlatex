/**
 * The LyX-style editor for one .tex file (Settings → Editor → Editor style,
 * or the Source | LyX switch above the editor).
 *
 * The file's Monaco model stays the source of truth, as with the source
 * editor: every edit here is written into it as one small text replacement,
 * so autosave, compiling, Git and live collaboration see ordinary edits.
 * Changes that arrive from elsewhere (the source editor, a pull, a
 * collaborator) are read back in, keeping the cursor's place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { CellSelection } from 'prosemirror-tables';
import { Slice, type Node as PMNode } from 'prosemirror-model';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-gapcursor/style/gapcursor.css';
import './lyx.css';
import { monaco } from '../editor/monaco';
import { getModel } from '../editor/models';
import { editorBridge } from '../editor/bridge';
import { compile, forwardSearch, openFile, workspace } from '../state/actions';
import { basename } from '../utils/paths';
import { childCandidates, childCommand, findChild, leaveChild, parentOf, rememberChild, type ChildRef } from './children';
import { getState, openDialog, promptText, useStore } from '../state/store';
import { Spinner } from '../components/ui';
import { readTex, type TexDocument } from './tex-reader';
import { writeTex } from './tex-writer';
import { plugins } from './setup';
import { loadMathLive, MathView } from './math-view';
import { findLabel, insertHyperlink, insertLabel, insertUrl, renameLabel, suggestLabel, toggleNumbering } from './commands';
import { GraphicsView } from './graphics-view';
import { InlineEditorView } from './inline-editor-view';
import { imageResolver } from './images';
import { epsPreview } from '../storage/server';
import type { HostAction } from './keys';
import { schema } from './schema';
import { layout as layoutNamed, type Theorems } from './layouts';
import { LyxToolbar } from './LyxToolbar';
import { LyxMoreMenu } from './LyxMoreMenu';
import { CommandBuffer } from './CommandBuffer';
import { FindBar } from './FindBar';
import { LyxOutline } from './LyxOutline';
import { DocumentSettings } from './DocumentSettings';
import { findPlugin } from './find';
import { bookmarksPlugin, clearBookmarks, gotoBookmark, saveBookmark } from './bookmarks';
import { download, plainText } from './export';
import { parseCommand, runCommand, type LfunContext, type Panel } from './lfuns';

/** Which of LyX's panes are open (localStorage). */
const PANELS = 'gitlatex.lyx.panels';

/** Replace only what differs between the model's text and `text`, as one undoable edit. */
function applyText(model: monaco.editor.ITextModel, text: string) {
  const old = model.getValue();
  if (old === text) return;
  let a = 0;
  while (a < old.length && a < text.length && old[a] === text[a]) a++;
  let b = 0;
  while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
  const from = model.getPositionAt(a);
  const to = model.getPositionAt(old.length - b);
  model.pushEditOperations([], [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: text.slice(a, text.length - b) }], () => null);
}

/**
 * Make the editor's selection the one the browser shows. ProseMirror learns of
 * a click through the `selectionchange` event, which is sometimes dropped
 * right after the view was rebuilt; a key pressed then would act on the old
 * cursor position (typing at the start of the document).
 */
function syncSelection(view: EditorView) {
  const sel = view.dom.ownerDocument.getSelection();
  if (!sel?.anchorNode || !sel.focusNode || !view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return;
  try {
    const anchor = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const head = view.posAtDOM(sel.focusNode, sel.focusOffset);
    const current = view.state.selection;
    if (current.anchor === anchor && current.head === head) return;
    // A selected formula or inset is not a text position: leave those to ProseMirror.
    // Selected table cells give way to a caret placed by a click elsewhere.
    const caretAfterCells = current instanceof CellSelection && anchor === head;
    if (current instanceof TextSelection || current.empty || caretAfterCells) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
  } catch {
    // The browser's selection is somewhere ProseMirror does not map (inside a formula).
  }
}

const lineOf = (text: string, offset: number) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

export function LyxPane({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const fontSize = useStore((s) => s.settings.editorFontSize);
  const reveal = useStore((s) => s.reveal);
  const api = useRef<{ goToLine(line: number): void; flush(): void; blockSource(): string } | null>(null);
  // LyX's panes and bars: the outline and code preview stay open between files.
  const [panels, setPanels] = useState<Record<Panel, boolean>>(() => {
    try {
      return { outline: false, source: false, ...(JSON.parse(localStorage.getItem(PANELS) ?? '{}') as Partial<Record<Panel, boolean>>) };
    } catch {
      return { outline: false, source: false };
    }
  });
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const [finding, setFinding] = useState(false);
  const [commanding, setCommanding] = useState(false);
  const [docSettings, setDocSettings] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<LfunContext | null>(null);
  /** Run a LyX function's command line (menus, the command buffer, keys). */
  const runLine = (line: string): boolean => {
    const ctx = ctxRef.current;
    if (!ctx) return false;
    // Back to the text first; a pane or dialog the command opens takes the focus from there.
    ctx.view.focus();
    const parsed = parseCommand(line);
    const ok = runCommand(line, ctx);
    if (!ok) showStatus(parsed ? `${line.trim()}: nothing to do here` : `Unknown command: ${line.trim()}`);
    return ok;
  };
  const runRef = useRef(runLine);
  runRef.current = runLine;
  // The toolbar and status bar follow the editor: its view, re-rendered on every transaction.
  const [view, setView] = useState<EditorView | null>(null);
  const [, setTick] = useState(0);
  const [theorems, setTheorems] = useState<Theorems>({});
  const [status, setStatusText] = useState('');
  const statusTimer = useRef(0);
  const layoutBox = useRef<HTMLSelectElement>(null);
  const actRef = useRef<((action: HostAction) => void) | null>(null);
  const showStatus = (message: string) => {
    clearTimeout(statusTimer.current);
    setStatusText(message);
    // Prompts for the next key of a sequence stay; other messages fade.
    if (message && !message.endsWith('…') && !message.includes('…  (')) statusTimer.current = window.setTimeout(() => setStatusText(''), 6000);
  };
  const compileNow = () => {
    api.current?.flush();
    void compile({ reason: 'manual' });
  };

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    loadMathLive().then(
      (ML) => {
        const model = getModel(path);
        if (!alive || !host.current || !model) return;
        let read: TexDocument = readTex(model.getValue());
        // The text last written, and where each top-level block starts in it.
        let written = model.getValue();
        let positions = new Map<PMNode, number>();
        let writing = false;
        let frame = 0;

        const flush = () => {
          cancelAnimationFrame(frame);
          frame = 0;
          positions = new Map();
          const text = writeTex(read, view.state.doc, positions);
          written = text;
          // The code preview shows what was just written.
          if (panelsRef.current.source) setTick((t) => t + 1);
          if (text === model.getValue()) return;
          writing = true;
          try {
            applyText(model, text);
          } finally {
            writing = false;
          }
        };
        const schedule = () => {
          if (!frame) frame = requestAnimationFrame(flush);
        };

        const ask = async (title: string, label: string, value: string, confirm: string) => {
          const answer = await promptText(title, label, value, confirm);
          view.focus();
          return answer?.trim() || null;
        };
        const act = async (action: HostAction) => {
          const run = (cmd: (s: EditorState, d: EditorView['dispatch']) => boolean) => cmd(view.state, view.dispatch);
          switch (action) {
            case 'label': {
              const name = await ask('Insert label', 'Label', suggestLabel(view.state, read.theorems), 'Insert');
              if (name) run(insertLabel(name, () => read.theorems));
              break;
            }
            case 'url': {
              const url = await ask('Insert URL', 'Address', 'https://', 'Insert');
              if (url) run(insertUrl(url));
              break;
            }
            case 'href': {
              const url = await ask('Insert hyperlink', 'Address (the selected text links to it)', 'https://', 'Insert');
              if (url) run(insertHyperlink(url));
              break;
            }
            // The app's pickers, which insert through the bridge (setTexInserter below).
            case 'ref':
              openDialog({ type: 'wizard', wizard: 'ref' });
              break;
            case 'cite':
              openDialog({ type: 'wizard', wizard: 'cite', source: 'project' });
              break;
            case 'zotero':
              openDialog({ type: 'wizard', wizard: 'cite', source: 'zotero' });
              break;
            case 'graphics':
            case 'figure':
              openDialog({ type: 'wizard', wizard: 'image' });
              break;
            case 'table':
              openDialog({ type: 'wizard', wizard: 'table' });
              break;
          }
        };
        const keyHost = {
          status: showStatus,
          focusLayoutBox: () => layoutBox.current?.focus(),
          compile: () => {
            flush();
            void compile({ reason: 'manual' });
          },
          act: (action: HostAction) => void act(action),
          lfun: (line: string) => runRef.current(line),
          typing: () => {
            const s = getState().settings;
            return { dollarMath: s.lyxDollarMath !== false, smartQuotes: s.lyxSmartQuotes !== false, spaceRules: s.lyxSpaceRules !== false };
          },
        };
        actRef.current = keyHost.act;
        const fileName = path.split('/').pop()!.replace(/\.tex$/i, '');
        /** Open the file a child command names, offering to create it when it does not exist yet. */
        const openChildRef = (ref: ChildRef) => {
          flush();
          const ws = workspace();
          const main = getState().project?.mainFile ?? path;
          if (!ws) return;
          const go = (child: string) => {
            rememberChild(path, child);
            openFile(child);
          };
          const found = findChild(ref, path, main, (p) => !!ws.get(p));
          if (found) return go(found);
          const target = childCandidates(ref, path, main)[0];
          if (!target) return showStatus(`${ref.file} is outside the project`);
          openDialog({
            type: 'confirm',
            title: 'Create child document?',
            message: `${target} does not exist yet. Create it as an empty file and open it?`,
            confirm: 'Create',
            onConfirm: () => {
              ws.writeFile(target, '');
              go(target);
            },
          });
        };
        ctxRef.current = {
          get view() {
            return view;
          },
          theorems: () => read.theorems,
          act: keyHost.act,
          compile: keyHost.compile,
          showInPdf: () => (flush(), forwardSearch()),
          toggle: (panel) =>
            setPanels((p) => {
              const next = { ...p, [panel]: !p[panel] };
              localStorage.setItem(PANELS, JSON.stringify(next));
              return next;
            }),
          isOpen: (panel) => panelsRef.current[panel],
          find: () => {
            const input = root.current?.querySelector<HTMLInputElement>('[aria-label="Find"]');
            if (input) {
              input.focus();
              input.select();
            } else setFinding(true);
          },
          commandBuffer: () => setCommanding(true),
          documentSettings: () => {
            flush();
            setDocSettings(true);
          },
          exportAs: (kind) => {
            flush();
            if (kind === 'latex') download(`${fileName}.tex`, model.getValue(), 'application/x-tex');
            else download(`${fileName}.txt`, plainText(view.state.doc, read.theorems));
            showStatus(`Exported ${fileName}.${kind === 'latex' ? 'tex' : 'txt'}`);
          },
          bookmarkSave: (n) => {
            view.dispatch(saveBookmark(view.state, n));
            showStatus(`Bookmark ${n} saved (Alt+${n} comes back here)`);
          },
          bookmarkGoto: (n) => {
            const tr = gotoBookmark(view.state, n);
            if (tr) view.dispatch(tr);
            else showStatus(`Bookmark ${n} is not set: Ctrl+Shift+${n} saves one at the cursor`);
            return !!tr;
          },
          bookmarksClear: () => {
            view.dispatch(clearBookmarks(view.state));
            showStatus('Bookmarks cleared');
          },
          openChild: (dry) => {
            // The child command at the cursor's block, else the next one below it.
            const doc = view.state.doc;
            let ref: ChildRef | null = null;
            for (let i = view.state.selection.$head.index(0); i < doc.childCount && !ref; i++) {
              const block = doc.child(i);
              if (block.type === schema.nodes.ert_block) ref = childCommand(block.textContent);
            }
            if (!ref) {
              if (!dry) showStatus('No \\input, \\include or \\subfile at or below the cursor');
              return false;
            }
            if (!dry) openChildRef(ref);
            return true;
          },
          backToParent: (dry) => {
            const p = parentOf(path, workspace()?.textFiles('.tex') ?? [], getState().project?.mainFile ?? path);
            if (!p) {
              if (!dry) showStatus('No other file inputs this one');
              return false;
            }
            if (!dry) {
              flush();
              leaveChild(path, p.parent);
              openFile(p.parent, p.line);
            }
            return true;
          },
          focusLayoutBox: keyHost.focusLayoutBox,
        };
        const mathHost = {
          status: showStatus,
          toggleNumbering(pos: number) {
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
            toggleNumbering(view.state, view.dispatch);
          },
        };
        const state = (doc: PMNode, selection?: (doc: PMNode) => Selection) =>
          EditorState.create({
            doc,
            selection: selection?.(doc),
            plugins: plugins(() => read.theorems, keyHost, [findPlugin(), bookmarksPlugin(`${getState().project?.id ?? ''}:${path}`)]),
          });

        const resolveImage = imageResolver(workspace, path, () => read.prefix, epsPreview);
        const view = new EditorView(host.current, {
          state: state(read.doc),
          attributes: { class: 'lyx-doc', spellcheck: 'true' },
          nodeViews: {
            math_inline: (node, v, getPos) => new MathView(node, v, getPos, ML, mathHost),
            math_display: (node, v, getPos) => new MathView(node, v, getPos, ML, mathHost),
            graphics: (node) => new GraphicsView(node, resolveImage),
            footnote: (node, v, getPos) => new InlineEditorView(node, v, getPos),
            ert_inline: (node, v, getPos) => new InlineEditorView(node, v, getPos),
          },
          // Double-click an inset to change it, as in LyX.
          handleDoubleClickOn(v, _pos, node, nodePos) {
            const set = (attrs: Record<string, unknown>) => v.dispatch(v.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, ...attrs }));
            if (node.type === schema.nodes.label) {
              void ask('Rename label', 'Label (references to it follow)', node.attrs.name, 'Rename').then((name) => name && renameLabel(node.attrs.name, name)(v.state, v.dispatch));
              return true;
            }
            if (node.type === schema.nodes.ref) {
              const at = findLabel(v.state.doc, String(node.attrs.key).split(',')[0].trim());
              if (at < 0) showStatus(`No label "${node.attrs.key}" in this file`);
              else v.dispatch(v.state.tr.setSelection(Selection.near(v.state.doc.resolve(at))).scrollIntoView());
              return true;
            }
            if (node.type === schema.nodes.cite) {
              void ask('Citation', 'Keys, separated by commas', node.attrs.keys, 'Save').then((keys) => keys && set({ keys }));
              return true;
            }
            if (node.type === schema.nodes.url) {
              void ask('URL', 'Address', node.attrs.url, 'Save').then((url) => url && set({ url }));
              return true;
            }
            const child = node.type === schema.nodes.ert_block ? childCommand(node.textContent) : null;
            if (child) {
              openChildRef(child);
              return true;
            }
            if (node.type === schema.nodes.graphics) {
              void ask('Graphics', `Options for ${node.attrs.path} (e.g. width=0.8\\linewidth)`, node.attrs.options ?? '', 'Save').then((options) => options != null && set({ options: options || null }));
              return true;
            }
            return false;
          },
          // Before each key and after each click, make sure the editor has the
          // caret the browser shows (see syncSelection). A selected node (a
          // formula, a footnote being edited) is left alone.
          handleKeyDown(v) {
            syncSelection(v);
            return false;
          },
          handleDOMEvents: {
            mouseup(v) {
              setTimeout(() => !v.isDestroyed && syncSelection(v), 0);
              return false;
            },
          },
          dispatchTransaction(tr) {
            view.updateState(view.state.apply(tr));
            if (tr.docChanged) schedule();
            setTick((t) => t + 1);
          },
        });
        writeTex(read, read.doc, positions);

        // Someone else changed the file: read it again, keeping the cursor's block and offset.
        const sub = model.onDidChangeContent(() => {
          if (writing || model.getValue() === written) return;
          cancelAnimationFrame(frame);
          frame = 0;
          const { $head } = view.state.selection;
          const index = $head.index(0);
          const offset = $head.depth ? $head.parentOffset : 0;
          read = readTex(model.getValue());
          setTheorems(read.theorems);
          written = model.getValue();
          positions = new Map();
          writeTex(read, read.doc, positions);
          view.updateState(
            state(read.doc, (doc) => {
              const i = Math.min(index, doc.childCount - 1);
              let pos = 0;
              for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
              return Selection.near(doc.resolve(Math.min(pos + 1 + offset, pos + doc.child(i).nodeSize - 1)));
            }),
          );
        });

        // Wizards (citation, reference, table, image…) and slash commands insert here.
        editorBridge.setTexInserter((tex, select) => {
          const piece = readTex(`\\begin{document}\n${tex}\n\\end{document}\n`).doc.content;
          const first = piece.firstChild;
          // One plain paragraph goes into the text at the cursor; anything else as blocks.
          const inline = piece.childCount === 1 && first?.type === schema.nodes.paragraph && first.attrs.layout === 'Standard' && !first.attrs.align;
          const tr = view.state.tr;
          // Selected table cells are not replaced: the insert goes into the cell the selection ends in.
          if (tr.selection instanceof CellSelection) tr.setSelection(TextSelection.create(tr.doc, tr.selection.$headCell.pos + 1));
          const $from = tr.selection.$from;
          let tableDepth = -1;
          for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === schema.nodes.table) tableDepth = d;
          let from = $from.pos;
          let to: number;
          if (!inline && tableDepth > 0) {
            // Blocks (a figure, another table) go after the table, not into a cell.
            from = $from.after(tableDepth);
            tr.insert(from, piece);
            to = from + piece.size;
          } else {
            tr.replaceSelection(inline ? new Slice(piece, 1, 1) : new Slice(piece, 0, 0));
            from = tr.mapping.map(from, -1);
            to = tr.selection.to;
          }
          if (select) {
            // Select the text to type over (a heading's "Title"…).
            let found = -1;
            tr.doc.nodesBetween(from, to, (n, pos) => {
              if (found < 0 && n.isText && n.text!.includes(select)) found = pos + n.text!.indexOf(select);
            });
            if (found >= 0) tr.setSelection(TextSelection.create(tr.doc, found, found + select.length));
          }
          view.dispatch(tr.scrollIntoView());
          view.focus();
          return true;
        });

        // Show in PDF and compiling find the line the cursor is on.
        editorBridge.setCursorLine(() => {
          const { $head } = view.state.selection;
          const block = view.state.doc.maybeChild($head.index(0));
          const start = block && positions.get(block);
          if (start == null) return null;
          return lineOf(written, start);
        });

        api.current = {
          flush,
          /** The LaTeX of the block the cursor is in (a whole list or theorem for one of its paragraphs), as last written. */
          blockSource() {
            const block = view.state.doc.maybeChild(view.state.selection.$head.index(0));
            const start = block && positions.get(block);
            if (start == null) return '';
            let end = written.length - read.suffix.length;
            for (const p of positions.values()) if (p > start && p < end) end = p;
            return written.slice(start, end).trim();
          },
          goToLine(line: number) {
            // The last block starting at or before that line.
            let offset = 0;
            for (let l = 1; l < line && offset >= 0; l++) offset = written.indexOf('\n', offset) + 1;
            let target = 0;
            let best = -1;
            view.state.doc.forEach((child, pos) => {
              const at = positions.get(child);
              if (at != null && at <= offset && at >= best) {
                best = at;
                target = pos;
              }
            });
            view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target + 1))).scrollIntoView());
            view.focus();
          },
        };

        setReady(true);
        setView(view);
        setTheorems(read.theorems);
        if (!getState().dialog) view.focus();
        cleanup = () => {
          if (frame) flush();
          sub.dispose();
          editorBridge.setCursorLine(null);
          editorBridge.setTexInserter(null);
          actRef.current = null;
          ctxRef.current = null;
          api.current = null;
          setView(null);
          view.destroy();
        };
      },
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      alive = false;
      clearTimeout(statusTimer.current);
      cleanup();
    };
    // showStatus only sets state; the editor is rebuilt for a new file only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Jump to a line (a problem in the log, the outline, double-click in the PDF).
  useEffect(() => {
    if (ready && reveal && reveal.path === path) api.current?.goToLine(reveal.line);
  }, [reveal, path, ready]);

  if (error) return <div className="p-6 text-sm text-danger">The LyX-style editor could not start: {error}</div>;
  // Where the cursor is, for the status bar: the paragraph's layout and depth.
  const $head = view?.state.selection.$head;
  const here = $head?.parent.type.name === 'paragraph' ? $head.parent : null;
  const where = here
    ? `${layoutNamed(here.attrs.layout, theorems).name}${here.attrs.depth ? ` · depth ${here.attrs.depth}` : ''}`
    : $head
      ? { ert_block: 'TeX code', ert_inline: 'TeX code', footnote: 'Footnote', table_cell: 'Table cell', note: 'Note' }[$head.parent.type.name] ?? ''
      : '';
  const ctx = view ? ctxRef.current : null;
  // A child document (input by another file): the way back. Looked up when the file opens.
  const parent = useMemo(
    () => (ready ? parentOf(path, workspace()?.textFiles('.tex') ?? [], getState().project?.mainFile ?? path) : null),
    [ready, path],
  );
  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col">
      <LyxToolbar
        view={view}
        theorems={theorems}
        layoutBox={layoutBox}
        onCompile={compileNow}
        onShowInPdf={() => (api.current?.flush(), forwardSearch())}
        onAct={(action) => actRef.current?.(action)}
        more={<LyxMoreMenu ctx={ctx} onRun={runLine} />}
      />
      {finding && view && <FindBar view={view} status={showStatus} onClose={() => setFinding(false)} />}
      <div className="flex min-h-0 flex-1">
        {panels.outline && view && <LyxOutline view={view} theorems={theorems} onRun={runLine} onClose={() => runLine('dialog-toggle toc')} />}
        <div className="flex min-w-0 flex-1 flex-col">
          {parent && (
            <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-panel-2/60 px-3 text-[11.5px] text-muted">
              <button
                type="button"
                className="shrink-0 text-accent hover:underline"
                title={`Back to ${parent.parent}, line ${parent.line}`}
                onClick={() => runLine('buffer-parent')}
                data-testid="lyx-back-to-parent"
              >
                ← Back to {basename(parent.parent)}
              </button>
              <span className="min-w-0 truncate">Child document of {parent.parent}</span>
            </div>
          )}
          <div className="lyx-root relative min-h-0 flex-1 overflow-auto" style={{ fontSize: `${fontSize + 2}px` }}>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-6 text-accent" />
              </div>
            )}
            <div ref={host} className="lyx-host" data-testid="lyx-editor" />
          </div>
          {panels.source && view && (
            // LyX's code preview: the LaTeX written for the paragraph at the cursor.
            <section className="flex h-44 shrink-0 flex-col border-t border-line bg-panel-2/50" aria-label="Code preview">
              <div className="flex h-7 shrink-0 items-center border-b border-line px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <span className="flex-1">LaTeX of this paragraph</span>
                <button type="button" onClick={() => runLine('dialog-toggle view-source')} className="rounded px-1.5 text-faint normal-case hover:bg-hover hover:text-fg" aria-label="Close the code preview">
                  ✕
                </button>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-5 text-fg" data-testid="lyx-source">
                {api.current?.blockSource()}
              </pre>
            </section>
          )}
        </div>
      </div>
      {commanding && ctx && <CommandBuffer ctx={ctx} onRun={runLine} onClose={() => setCommanding(false)} />}
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel-2/60 px-3 text-[11.5px] text-muted" role="status" aria-live="polite">
        <span className="min-w-0 flex-1 truncate" data-testid="lyx-status">{status}</span>
        <span className="shrink-0 text-faint">{where}</span>
      </div>
      {docSettings && (
        <DocumentSettings
          text={getModel(path)?.getValue() ?? ''}
          onSave={(text) => {
            const model = getModel(path);
            if (model) applyText(model, text);
            showStatus('Document settings saved');
          }}
          onClose={() => {
            setDocSettings(false);
            view?.focus();
          }}
        />
      )}
    </div>
  );
}
