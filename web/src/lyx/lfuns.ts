/**
 * The LyX-style editor's functions, named as LyX names them (its "LFUNs":
 * `layout Section`, `font-emph`, `bookmark-save 1`…). The ☰ menu, the
 * command buffer (Alt+X) and the keyboard all run them from here, so a
 * function's name, label and shortcut are written once.
 */
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { redo, undo } from 'prosemirror-history';
import { chainCommands } from 'prosemirror-commands';
import { schema } from './schema';
import { LAYOUT_GROUPS, type Theorems } from './layouts';
import {
  changeDepth, defaultFont, insertFootnote, insertInline, insertMath, insertNote, insertTexCode, insertText, moveParagraph, moveSection, setAlign, setLayout, shiftSection,
  toggleNumbering, toggleStyle,
} from './commands';
import {
  addColumn, addRow, alignColumns, mergeInRow, removeColumns, removeRows, removeTable, splitMerged, toggleAllLines, toggleColumnLine, toggleRowLine,
} from './table';
import type { HostAction } from './keys';

export type Panel = 'outline' | 'source';

/** What the functions act on: the editor, and the pane around it. */
export interface LfunContext {
  view: EditorView;
  theorems(): Theorems;
  act(action: HostAction): void;
  compile(): void;
  showInPdf(): void;
  toggle(panel: Panel): void;
  isOpen(panel: Panel): boolean;
  find(): void;
  commandBuffer(): void;
  documentSettings(): void;
  exportAs(kind: 'text' | 'latex'): void;
  bookmarkSave(n: number): void;
  bookmarkGoto(n: number): boolean;
  bookmarksClear(): void;
  /** Open the child document at the cursor, else the next one below it; with `dry`, only say whether there is one. */
  openChild(dry: boolean): boolean;
  /** Go back to the document this child was opened from (or that inputs it). */
  backToParent(dry: boolean): boolean;
  focusLayoutBox(): void;
}

export interface Lfun {
  name: string;
  label: string;
  /** What its argument is, for the command buffer (`layout <layout>`). */
  arg?: string;
  /** The values the argument can take, for completion. */
  args?(ctx: LfunContext): string[];
  /** Its shortcut, as shown in menus. */
  keys?: string;
  /** Run it; with `dry`, only say whether it can run here. */
  run(ctx: LfunContext, arg: string, dry: boolean): boolean;
  /** Whether it is on now (a style at the cursor, an open pane), for menu check marks. */
  on?(ctx: LfunContext, arg: string): boolean;
}

const pm =
  (cmd: Command) =>
  (ctx: LfunContext, _arg: string, dry: boolean) =>
    cmd(ctx.view.state, dry ? undefined : ctx.view.dispatch, ctx.view);
const always =
  (fn: (ctx: LfunContext, arg: string) => void) =>
  (ctx: LfunContext, arg: string, dry: boolean) => {
    if (!dry) fn(ctx, arg);
    return true;
  };
const act = (a: HostAction) => always((ctx) => ctx.act(a));
const hasMark = (name: keyof typeof schema.marks) => (ctx: LfunContext) => {
  const { state } = ctx.view;
  return schema.marks[name].isInSet(state.storedMarks ?? state.selection.$head.marks()) != null;
};

const TABULAR: Record<string, Command> = {
  'append-row': addRow(1),
  'insert-row': addRow(-1),
  'delete-row': removeRows,
  'append-column': addColumn(1),
  'insert-column': addColumn(-1),
  'delete-column': removeColumns,
  'toggle-line-top': toggleRowLine('top'),
  'toggle-line-bottom': toggleRowLine('bottom'),
  'toggle-line-left': toggleColumnLine('left'),
  'toggle-line-right': toggleColumnLine('right'),
  'set-all-lines': toggleAllLines,
  multicolumn: mergeInRow,
  'split-cell': splitMerged,
  'align-left': alignColumns('l'),
  'align-center': alignColumns('c'),
  'align-right': alignColumns('r'),
  'delete-table': removeTable,
};

const ALIGN: Record<string, Command> = {
  left: chainCommands(alignColumns('l'), setAlign('flushleft')),
  center: chainCommands(alignColumns('c'), setAlign('center')),
  right: chainCommands(alignColumns('r'), setAlign('flushright')),
  default: chainCommands(alignColumns('l'), setAlign(null)),
};

const layoutNames = (ctx: LfunContext) => [...new Set([...LAYOUT_GROUPS.flatMap(([, names]) => names), ...Object.values(ctx.theorems())])];

export const LFUNS: Lfun[] = [
  // Edit
  { name: 'undo', label: 'Undo', keys: 'Ctrl+Z', run: pm(undo) },
  { name: 'redo', label: 'Redo', keys: 'Ctrl+Y', run: pm(redo) },
  { name: 'dialog-show findreplace', label: 'Find & Replace…', keys: 'Ctrl+F', run: always((ctx) => ctx.find()) },
  { name: 'font-emph', label: 'Emphasize', keys: 'Ctrl+E', run: pm(toggleStyle(schema.marks.emph)), on: hasMark('emph') },
  { name: 'font-bold', label: 'Bold', keys: 'Ctrl+B', run: pm(toggleStyle(schema.marks.bold)), on: hasMark('bold') },
  { name: 'font-noun', label: 'Noun (small caps)', keys: 'Alt+C C', run: pm(toggleStyle(schema.marks.noun)), on: hasMark('noun') },
  { name: 'font-typewriter', label: 'Typewriter', keys: 'Ctrl+Shift+P', run: pm(toggleStyle(schema.marks.typewriter)), on: hasMark('typewriter') },
  { name: 'font-sans', label: 'Sans serif', keys: 'Alt+C S', run: pm(toggleStyle(schema.marks.sans)), on: hasMark('sans') },
  { name: 'font-underline', label: 'Underline', keys: 'Ctrl+U', run: pm(toggleStyle(schema.marks.underline)), on: hasMark('underline') },
  { name: 'font-default', label: 'Default font', keys: 'Alt+C Space', run: pm(defaultFont) },
  {
    name: 'layout',
    label: 'Paragraph layout',
    arg: '<layout>',
    keys: 'Alt+P …',
    args: layoutNames,
    run: (ctx, arg, dry) => {
      if (!arg) return always((c) => c.focusLayoutBox())(ctx, arg, dry);
      const name = layoutNames(ctx).find((n) => n.toLowerCase() === arg.toLowerCase()) ?? arg;
      return pm(setLayout(name))(ctx, arg, dry);
    },
  },
  { name: 'depth-increment', label: 'Increase depth (nest)', keys: 'Alt+Shift+→', run: pm(changeDepth(1)) },
  { name: 'depth-decrement', label: 'Decrease depth', keys: 'Alt+Shift+←', run: pm(changeDepth(-1)) },
  { name: 'paragraph-move-up', label: 'Move paragraph up', keys: 'Alt+↑', run: pm(moveParagraph(-1)) },
  { name: 'paragraph-move-down', label: 'Move paragraph down', keys: 'Alt+↓', run: pm(moveParagraph(1)) },
  { name: 'outline-up', label: 'Move section up', keys: 'Alt+P ↑', run: (ctx, a, d) => pm(moveSection(-1, () => ctx.theorems()))(ctx, a, d) },
  { name: 'outline-down', label: 'Move section down', keys: 'Alt+P ↓', run: (ctx, a, d) => pm(moveSection(1, () => ctx.theorems()))(ctx, a, d) },
  { name: 'outline-out', label: 'Promote section', keys: 'Alt+P ←', run: (ctx, a, d) => pm(shiftSection(-1, () => ctx.theorems()))(ctx, a, d) },
  { name: 'outline-in', label: 'Demote section', keys: 'Alt+P →', run: (ctx, a, d) => pm(shiftSection(1, () => ctx.theorems()))(ctx, a, d) },
  {
    name: 'tabular-feature',
    label: 'Table',
    arg: '<feature>',
    args: () => Object.keys(TABULAR),
    run: (ctx, arg, dry) => (TABULAR[arg] ? pm(TABULAR[arg])(ctx, arg, dry) : false),
  },
  {
    name: 'paragraph-align',
    label: 'Alignment',
    arg: 'left|center|right|default',
    keys: 'Alt+A …',
    args: () => Object.keys(ALIGN),
    run: (ctx, arg, dry) => (ALIGN[arg] ? pm(ALIGN[arg])(ctx, arg, dry) : false),
  },

  // Insert
  { name: 'math-mode', label: 'Inline formula', keys: 'Ctrl+M', run: pm(insertMath(false)) },
  { name: 'math-display', label: 'Display formula', keys: 'Ctrl+Shift+M', run: pm(insertMath('\\[')) },
  { name: 'math-numbered', label: 'Numbered formula', keys: 'Ctrl+Alt+N', run: pm(insertMath('equation')) },
  { name: 'math-number-toggle', label: 'Number / unnumber formula', keys: 'Alt+M N', run: pm(toggleNumbering) },
  { name: 'ert-insert', label: 'TeX code', keys: 'Ctrl+L', run: pm(insertTexCode) },
  { name: 'footnote-insert', label: 'Footnote', keys: 'Alt+I F', run: pm(insertFootnote('footnote')) },
  { name: 'marginalnote-insert', label: 'Margin note', keys: 'Alt+I M', run: pm(insertFootnote('marginpar')) },
  { name: 'note-insert', label: 'LyX note (not printed)', keys: 'Alt+I N', run: pm(insertNote) },
  { name: 'label-insert', label: 'Label…', keys: 'Alt+I L', run: act('label') },
  { name: 'reference-insert', label: 'Cross-reference…', keys: 'Alt+I R', run: act('ref') },
  { name: 'citation-insert', label: 'Citation…', keys: 'Alt+I C', run: act('cite') },
  { name: 'zotero-insert', label: 'Citation from Zotero…', keys: 'Alt+I Z', run: act('zotero') },
  { name: 'url-insert', label: 'URL…', keys: 'Alt+I U', run: act('url') },
  { name: 'href-insert', label: 'Hyperlink…', keys: 'Alt+I H', run: act('href') },
  { name: 'graphics-insert', label: 'Graphics / figure…', keys: 'Alt+I G', run: act('figure') },
  { name: 'tabular-insert', label: 'Table…', keys: 'Alt+I T', run: act('table') },
  { name: 'newline-insert', label: 'Line break', keys: 'Ctrl+Enter', run: pm(insertInline(() => schema.nodes.hard_break.create())) },
  { name: 'space-insert protected', label: 'Protected space', keys: 'Ctrl+Space', run: pm(insertText(' ')) },
  { name: 'specialchar-insert dots', label: 'Ellipsis …', keys: 'Alt+.', run: pm(insertText('…')) },

  // View
  { name: 'buffer-view', label: 'Compile and view', keys: 'Ctrl+S', run: always((ctx) => ctx.compile()) },
  { name: 'forward-search', label: 'Show in PDF', run: always((ctx) => ctx.showInPdf()) },
  { name: 'dialog-toggle toc', label: 'Outline pane', run: always((ctx) => ctx.toggle('outline')), on: (ctx) => ctx.isOpen('outline') },
  { name: 'dialog-toggle view-source', label: 'Code preview pane', run: always((ctx) => ctx.toggle('source')), on: (ctx) => ctx.isOpen('source') },
  { name: 'command-execute', label: 'Command buffer', keys: 'Alt+X', run: always((ctx) => ctx.commandBuffer()) },

  // Navigate
  { name: 'bookmark-save', label: 'Save bookmark', arg: '1–5', keys: 'Ctrl+Shift+1…5', args: () => ['1', '2', '3', '4', '5'], run: bookmark('save') },
  { name: 'bookmark-goto', label: 'Go to bookmark', arg: '1–5', keys: 'Alt+1…5', args: () => ['1', '2', '3', '4', '5'], run: bookmark('goto') },
  { name: 'bookmark-clear', label: 'Clear bookmarks', run: always((ctx) => ctx.bookmarksClear()) },
  { name: 'child-open', label: 'Open child document', run: (ctx, _arg, dry) => ctx.openChild(dry) },
  { name: 'buffer-parent', label: 'Back to parent document', run: (ctx, _arg, dry) => ctx.backToParent(dry) },

  // Document
  { name: 'dialog-show document', label: 'Settings…', run: always((ctx) => ctx.documentSettings()) },
  { name: 'buffer-export', label: 'Export', arg: 'text|latex', args: () => ['text', 'latex'], run: (ctx, arg, dry) => (arg === 'text' || arg === 'latex' ? always((c) => c.exportAs(arg))(ctx, arg, dry) : false) },
];

function bookmark(op: 'save' | 'goto') {
  return (ctx: LfunContext, arg: string, dry: boolean) => {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > 5) return false;
    if (dry) return true;
    if (op === 'save') ctx.bookmarkSave(n);
    else return ctx.bookmarkGoto(n);
    return true;
  };
}

/** The function a command line names, and its argument: `layout Section` → layout, "Section". */
export function parseCommand(line: string): { lfun: Lfun; arg: string } | null {
  const text = line.trim();
  // The longest name that the line starts with (`dialog-show document` before `dialog-show`).
  const lfun = [...LFUNS].sort((a, b) => b.name.length - a.name.length).find((l) => text === l.name || text.startsWith(`${l.name} `));
  return lfun ? { lfun, arg: text.slice(lfun.name.length).trim() } : null;
}

/** Completions for what has been typed in the command buffer. */
export function completions(line: string, ctx: LfunContext): string[] {
  const parsed = parseCommand(line);
  // Past the name (`layout `, `layout Sec`): its argument's values.
  if (parsed?.lfun.args && line.trimStart().length > parsed.lfun.name.length) {
    const typed = parsed.arg.toLowerCase();
    return parsed.lfun
      .args(ctx)
      .filter((a) => a.toLowerCase().startsWith(typed))
      .map((a) => `${parsed.lfun.name} ${a}`);
  }
  const typed = line.trim().toLowerCase();
  const starts = LFUNS.filter((l) => l.name.startsWith(typed));
  const contains = LFUNS.filter((l) => !l.name.startsWith(typed) && (l.name.includes(typed) || l.label.toLowerCase().includes(typed)));
  return [...starts, ...contains].map((l) => l.name);
}

/** Run a command line (`layout Section`); false when it names nothing or cannot run here. */
export function runCommand(line: string, ctx: LfunContext): boolean {
  const parsed = parseCommand(line);
  if (!parsed) return false;
  const ok = parsed.lfun.run(ctx, parsed.arg, false);
  return ok;
}

export const lfunNamed = (name: string) => LFUNS.find((l) => l.name === name);
