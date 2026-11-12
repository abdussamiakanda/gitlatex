/**
 * Conceal TeX: $…$, \(…\), $$…$$ and \[…\] show rendered in the source editor and are
 * edited in a MathLive box, like web/../live-math-demo. The model always keeps the
 * plain TeX; environments (equation, align…) stay as source.
 *
 *   Ctrl/Cmd+M or Alt+4      new formula $…$ (add Shift for display math $$…$$)
 *   click, or ←/→ into it    edit a formula (↑/↓ step into a display block)
 *   Esc, Enter, → past end   back to the text (Backspace in an empty one removes it)
 *
 * Inline: the source shrinks to nothing, injected spaces keep room, and a content
 * widget draws the formula there. Display block (alone on its lines): the lines are
 * hidden and a view zone shows it.
 */
import katex from 'katex';
import type { monaco as Monaco } from './monaco';
import { monaco } from './monaco';
import { findMath } from './math-spans';
import { loadMathLive } from './mathlive';
import './conceal.css';

type Editor = Monaco.editor.IStandaloneCodeEditor;
type Model = Monaco.editor.ITextModel;
type MathField = HTMLElement & {
  value: string;
  mode: string;
  defaultMode: string;
  mathVirtualKeyboardPolicy: string;
  executeCommand(c: unknown): boolean;
};

interface Formula {
  start: number;
  end: number;
  latex: string;
  block: boolean;
  open: string;
  close: string;
  lead: string;
  trail: string;
  labels: string;
  startLine: number;
  endLine: number;
}

// shortcut: renders at most this many formulas per file; render only the visible ones if big files feel slow
const MAX_FORMULAS = 500;
/** Our own owner for hidden lines, so code folding keeps its own. */
const HIDDEN_OWNER = {};
const NBSP = ' ';

/** The formulas Conceal TeX handles, with what is needed to write them back. */
function formulas(model: Model): Formula[] {
  const text = model.getValue();
  const out: Formula[] = [];
  for (const s of findMath(text)) {
    const src = text.slice(s.start, s.end);
    const env = src.match(/^\\begin\{([^}]*)\}/);
    const open = env ? env[0] : src.startsWith('$$') ? '$$' : src[0] === '$' ? '$' : src.slice(0, 2);
    const close = env ? `\\end{${env[1]}}` : open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : open;
    const inner = src.slice(open.length, src.length - close.length);
    const labels = (inner.match(/\\label\{[^}]*\}/g) ?? []).join(''); // findMath drops them from tex; written back on save
    const blank = !inner.trim();
    const lead = blank ? (inner.includes('\n') ? '\n' : '') : inner.match(/^\s*/)![0];
    const trail = blank ? lead : inner.match(/\s*$/)![0];
    const a = model.getPositionAt(s.start), b = model.getPositionAt(s.end);
    const before = model.getLineContent(a.lineNumber).slice(0, a.column - 1);
    const after = model.getLineContent(b.lineNumber).slice(b.column - 1);
    const block = s.display && !before.trim() && !after.trim();
    if (!block && a.lineNumber !== b.lineNumber) continue; // inline ones must sit on one line
    out.push({ start: s.start, end: s.end, latex: s.tex, block, open, close, lead, trail, labels, startLine: a.lineNumber, endLine: b.lineNumber });
  }
  return out.slice(0, MAX_FORMULAS);
}

let enabled = false;
let refresh: (() => void) | null = null;

export function setConcealEnabled(on: boolean) {
  enabled = on;
  if (on) void loadMathLive();
  refresh?.();
}

export function installConceal(editor: Editor, on: boolean): Monaco.IDisposable {
  enabled = on;
  if (on) void loadMathLive();
  const hidden = editor.createDecorationsCollection();
  const statics = new Map<string, { widget: Monaco.editor.IContentWidget; pos: Monaco.IPosition }>();
  const zones = new Map<string, string>(); // key → view zone id
  const clickTarget = new Map<string, Formula>(); // widget / zone id → its formula
  let list: Formula[] = [];
  const cache = new Map<string, { html: string; width: number; height: number }>();

  // The formula being edited in a MathLive box
  let edit: {
    model: Model;
    f: Formula;
    mf: MathField;
    node: HTMLElement;
    range: Monaco.editor.IEditorDecorationsCollection;
    widget?: Monaco.editor.IContentWidget;
    zoneHeight: number;
  } | null = null;

  // Measured with the widgets' own CSS; on the body, since Monaco re-renders its own children
  const measureHost = document.createElement('div');
  measureHost.className = 'monaco-editor tex-conceal-measure';
  const measure = document.createElement('div');
  measureHost.appendChild(measure);
  document.body.appendChild(measureHost);

  const fontSize = () => editor.getOption(monaco.editor.EditorOption.fontInfo).fontSize;
  const charWidth = () => editor.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
  const lineHeight = () => editor.getOption(monaco.editor.EditorOption.lineHeight);

  function render(latex: string, display: boolean) {
    const key = `${display ? 'D' : 'I'}${latex}`;
    let r = cache.get(key);
    if (!r) {
      let html = '';
      try {
        html = latex ? katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' }) : '';
      } catch {
        html = '';
      }
      measure.className = display ? 'tex-conceal tex-conceal-block' : 'tex-conceal';
      measure.style.fontSize = `${fontSize()}px`;
      measure.innerHTML = html;
      const k = measure.querySelector('.katex') as HTMLElement | null;
      r = { html, width: Math.max(k ? k.offsetWidth : 0, charWidth()), height: measure.offsetHeight };
      cache.set(key, r);
    }
    return r;
  }

  const editStart = () => {
    const r = edit?.range.getRange(0);
    return r && edit!.model === editor.getModel() ? edit!.model.getOffsetAt(r.getStartPosition()) : -1;
  };

  /** Where a block's zone goes: after the last of the blocks right below it (Monaco hides a zone whose next line is hidden). */
  function zoneLine(f: Formula) {
    let line = f.endLine;
    for (let n; (n = list.find((x) => x.block && x.startLine === line + 1)); line = n.endLine);
    return line;
  }

  /** Draws every formula: rendered, or as the open box. */
  function apply() {
    const model = editor.getModel();
    const active = enabled && !!model && model.getLanguageId() === 'latex';
    const decos: Monaco.editor.IModelDeltaDecoration[] = [];
    const wantStatic = new Map<string, { f: Formula; html: string; pos: Monaco.IPosition }>();
    const wantZones = new Map<string, { f: Formula; html: string; height: number } | null>(); // null: the edit box
    const counts = new Map<string, number>();
    const editAt = editStart();
    clickTarget.clear();

    for (const f of active ? list : []) {
      const editing = f.start === editAt;
      const n = (counts.get(f.latex) ?? 0) + 1;
      counts.set(f.latex, n);
      if (f.block) {
        if (editing) wantZones.set('edit', null);
        else {
          const r = render(f.latex, true);
          wantZones.set(`${zoneLine(f)}:${f.labels}:${f.latex}`, { f, html: r.html, height: r.height });
        }
        continue;
      }
      const a = model!.getPositionAt(f.start), b = model!.getPositionAt(f.end);
      const width = editing ? edit!.node.offsetWidth : render(f.latex, false).width;
      decos.push({
        range: monaco.Range.fromPositions(a, b),
        options: {
          inlineClassName: 'tex-conceal-src',
          inlineClassNameAffectsLetterSpacing: true,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          before: { content: NBSP.repeat(Math.max(1, Math.ceil(width / charWidth()))), cursorStops: monaco.editor.InjectedTextCursorStops.None },
        },
      });
      if (!editing) wantStatic.set(`${f.latex}#${n}`, { f, html: render(f.latex, false).html, pos: a });
    }
    hidden.set(decos);

    // Rendered inline formulas: reuse a widget when only its place moved
    for (const [key, s] of statics) if (!wantStatic.has(key)) (editor.removeContentWidget(s.widget), statics.delete(key));
    for (const [key, w] of wantStatic) {
      let s = statics.get(key);
      if (!s) {
        const node = document.createElement('div');
        node.className = 'tex-conceal';
        node.style.height = node.style.lineHeight = `${lineHeight()}px`;
        node.style.fontSize = `${fontSize()}px`;
        node.innerHTML = w.html;
        const id = `tex-conceal-${key}`;
        const entry = { pos: w.pos, widget: null as unknown as Monaco.editor.IContentWidget };
        entry.widget = {
          getId: () => id,
          getDomNode: () => node,
          getPosition: () => ({
            position: entry.pos,
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
            positionAffinity: monaco.editor.PositionAffinity.LeftOfInjectedText,
          }),
        };
        statics.set(key, (s = entry));
        editor.addContentWidget(entry.widget);
      } else if (s.pos.lineNumber !== w.pos.lineNumber || s.pos.column !== w.pos.column) {
        s.pos = w.pos;
        editor.layoutContentWidget(s.widget);
      }
      clickTarget.set(s.widget.getId(), w.f);
    }
    if (edit?.widget) editor.layoutContentWidget(edit.widget);

    // Display blocks: hidden lines with a view zone above them
    editor.changeViewZones((acc) => {
      for (const [key, id] of zones) if (!wantZones.has(key)) (acc.removeZone(id), zones.delete(key));
      for (const [key, z] of wantZones) {
        const f = z ? z.f : list.find((x) => x.start === editAt)!;
        let id = zones.get(key);
        if (!id) {
          let node: HTMLElement, height: number;
          if (z) {
            node = document.createElement('div');
            node.className = 'tex-conceal tex-conceal-block';
            node.style.fontSize = `${fontSize()}px`;
            node.innerHTML = z.html;
            if (z.f.labels) {
              const tags = document.createElement('div');
              tags.className = 'tex-conceal-labels';
              for (const [, name] of z.f.labels.matchAll(/\\label\{([^}]*)\}/g)) tags.appendChild(document.createElement('span')).textContent = name;
              node.appendChild(tags);
            }
            height = z.height + 8;
          } else {
            node = document.createElement('div'); // room only: the box is a content widget over it (a view zone cannot take focus)
            height = edit!.zoneHeight;
          }
          id = acc.addZone({ afterLineNumber: zoneLine(f), ordinal: f.start, heightInPx: height, domNode: node }); // ordinal: adjacent blocks' zones stay in document order
          zones.set(key, id);
        }
        clickTarget.set(id, f);
      }
    });
    (editor as unknown as { setHiddenAreas(r: Monaco.IRange[], owner: unknown): void }).setHiddenAreas(
      active ? list.filter((f) => f.block).map((f) => new monaco.Range(f.startLine, 1, f.endLine, 1)) : [],
      HIDDEN_OWNER,
    );
  }

  function reparse() {
    const model = editor.getModel();
    list = enabled && model && model.getLanguageId() === 'latex' ? formulas(model) : [];
    apply();
  }

  // ── The MathLive box ──
  async function openBox(f: Formula, atEnd: boolean) {
    const model = editor.getModel();
    if (!model) return;
    if (edit) leave(null);
    const ML = await loadMathLive();
    if (edit || editor.getModel() !== model) return;
    const mf = new ML.MathfieldElement() as unknown as MathField;
    mf.className = f.block ? 'display' : 'inline';
    if (!f.block) mf.defaultMode = 'inline-math'; // inline formulas at text size (∫ with limits beside it)
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.value = f.latex;
    const node = document.createElement('div');
    node.className = `tex-conceal-edit${f.block ? ' tex-conceal-block' : ''}`;
    node.style.fontSize = `${fontSize()}px`;
    node.appendChild(mf);
    const range = editor.createDecorationsCollection([
      {
        range: monaco.Range.fromPositions(model.getPositionAt(f.start), model.getPositionAt(f.end)),
        options: { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
      },
    ]);
    edit = { model, f, mf, node, range, zoneHeight: 4 * lineHeight() };
    const P = monaco.editor.ContentWidgetPositionPreference;
    if (f.block) node.style.width = `${editor.getLayoutInfo().contentWidth - 24}px`;
    edit.widget = {
      getId: () => 'tex-conceal-edit',
      getDomNode: () => node,
      getPosition: () => {
        const r = range.getRange(0);
        if (!r) return null;
        if (!f.block) return { position: r.getStartPosition(), preference: [P.EXACT], positionAffinity: monaco.editor.PositionAffinity.LeftOfInjectedText };
        // a block's lines are hidden and its room sits under the line above it
        // blocks right above this one are hidden too: anchor above them all and step down past their renderings
        let line = r.startLineNumber, skip = 0;
        for (let p; (p = list.find((x) => x.block && x !== f && x.endLine === line - 1)); line = p.startLine) skip += render(p.latex, true).height + 8;
        node.style.marginTop = `${skip}px`;
        if (line > 1) return { position: { lineNumber: line - 1, column: lastRowStart(model, line - 1) }, preference: [P.BELOW] };
        if (r.endLineNumber < model.getLineCount()) return { position: { lineNumber: r.endLineNumber + 1, column: 1 }, preference: [P.ABOVE] };
        return { position: r.getStartPosition(), preference: [P.EXACT] };
      },
    };
    editor.addContentWidget(edit.widget);
    wire(mf);
    apply();
    requestAnimationFrame(() => {
      mf.focus();
      mf.executeCommand(atEnd ? 'moveToMathfieldEnd' : 'moveToMathfieldStart');
      resize();
    });
  }

  /** First column of a line's last visual row: with word wrap, BELOW column 1 sits under the first row, and the line's end column pushes a wide box off the left. */
  function lastRowStart(model: Model, line: number) {
    const max = model.getLineMaxColumn(line);
    const top = editor.getTopForPosition(line, max);
    let lo = 1, hi = max;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (editor.getTopForPosition(line, mid) < top) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The box grew or shrank: give it room. */
  function resize() {
    if (!edit) return;
    if (edit.f.block) {
      const h = edit.node.offsetHeight + 8;
      if (h === edit.zoneHeight) return;
      edit.zoneHeight = h;
      const id = zones.get('edit');
      if (id) {
        editor.changeViewZones((acc) => {
          acc.removeZone(id);
          zones.set('edit', acc.addZone({ afterLineNumber: zoneLine(edit!.f), ordinal: edit!.f.start, heightInPx: h, domNode: document.createElement('div') }));
        });
      }
      if (edit.widget) editor.layoutContentWidget(edit.widget);
    } else apply();
  }

  /** Writes the box back into the text. where: put the cursor before or after the formula (null: leave it). */
  function leave(where: 'before' | 'after' | null) {
    const e = edit;
    if (!e) return;
    edit = null;
    const r = e.range.getRange(0);
    e.range.clear();
    if (e.widget) editor.removeContentWidget(e.widget);
    const value = e.mf.value;
    if (r) {
      let text: string | null = null;
      if (!value.trim()) text = '';
      else if (value !== e.f.latex) {
        // align/gather are shown wrapped in aligned/gathered (see findMath): unwrap before writing back
        const body = e.f.open.startsWith('\\begin') ? value.replace(/^\s*\\begin\{(aligned|gathered)\}([\s\S]*)\\end\{\1\}\s*$/, '$2') : value;
        text = e.f.open + e.f.lead + body + (e.f.labels ? (e.f.lead || ' ') + e.f.labels : '') + e.f.trail + e.f.close;
      }
      const start = e.model.getOffsetAt(r.getStartPosition());
      if (text !== null) e.model.pushEditOperations([], [{ range: r, text }], () => null);
      const end = text !== null ? start + text.length : e.model.getOffsetAt(r.getEndPosition());
      if (where && editor.getModel() === e.model) {
        let pos = e.model.getPositionAt(where === 'after' ? end : start);
        if (e.f.block && text !== '') {
          // the block's own lines are hidden: go to the line after (or before) it
          const last = e.model.getLineCount();
          if (where === 'after') pos = pos.lineNumber < last ? new monaco.Position(pos.lineNumber + 1, 1) : pos;
          else if (pos.lineNumber > 1) pos = new monaco.Position(pos.lineNumber - 1, e.model.getLineMaxColumn(pos.lineNumber - 1));
        }
        editor.focus();
        editor.setPosition(pos);
      }
    }
    reparse();
  }

  // Keys inside the box (from the demo's liveMath.js)
  function wire(mf: MathField) {
    mf.addEventListener(
      'keydown',
      (e) => {
        const typingCommand = mf.mode === 'latex'; // in the middle of typing \alpha
        const finish = (how?: string) => mf.executeCommand(['complete', how || 'accept']);
        if (typingCommand && (e.key === ' ' || e.key === 'Tab' || e.key === 'Enter')) {
          // Tab or Enter: the highlighted suggestion; Space: exactly what was typed
          e.preventDefault();
          e.stopPropagation();
          finish(e.key === ' ' ? 'accept' : 'accept-all');
        } else if (e.key === 'Escape' || (e.key === '$' && !edit?.f.block) || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          if (typingCommand) finish();
          leave('after');
        }
      },
      true,
    );
    mf.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep Monaco's own shortcuts (undo, Ctrl+M…) out of the box
      if (e.key === 'Backspace' && !mf.value) {
        e.preventDefault();
        leave('before');
      }
    });
    mf.addEventListener('input', () => requestAnimationFrame(resize));
    mf.addEventListener('move-out', (e) => {
      e.preventDefault();
      const d = (e as CustomEvent<{ direction?: string }>).detail?.direction;
      leave(d === 'forward' || d === 'downward' ? 'after' : 'before');
    });
    // Clicked away: write it back (once the mouse is up: a click on the box itself refocuses it)
    const check = () => {
      if (edit?.mf !== mf || document.activeElement === mf) return;
      if (mouseDown) window.addEventListener('mouseup', () => setTimeout(() => setTimeout(check)), { once: true });
      else leave(null);
    };
    mf.addEventListener('blur', () => setTimeout(check));
  }

  /** Ctrl/Cmd+M: a new formula at the caret; the selected text, if any, becomes its contents. */
  function insert(display: boolean) {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel) return;
    const selected = model.getValueInRange(sel);
    const before = model.getLineContent(sel.startLineNumber).slice(0, sel.startColumn - 1);
    const after = model.getLineContent(sel.endLineNumber).slice(sel.endColumn - 1);
    const pre = display && before.trim() ? '\n' : '';
    const text = display ? `${pre}$$\n${selected}\n$$${after.trim() ? '\n' : ''}` : `$${selected || (enabled ? ' ' : '')}$`;
    const start = model.getOffsetAt(sel.getStartPosition()) + pre.length;
    editor.executeEdits('tex-conceal', [{ range: sel, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    if (!enabled || model.getLanguageId() !== 'latex') {
      // no box: the caret goes between the delimiters
      editor.setPosition(model.getPositionAt(start + (display ? 3 : 1) + selected.length));
      return;
    }
    reparse();
    const f = list.find((x) => x.start === start);
    if (f) void openBox(f, true);
  }

  /** Renames a rendered block's i-th \label in a small input over it (a view zone cannot take focus, so it sits on the body). */
  function editLabel(f: Formula, i: number, tag: HTMLElement) {
    const model = editor.getModel();
    if (!model) return;
    const r = tag.getBoundingClientRect();
    const input = document.createElement('input');
    input.className = 'tex-conceal-label-edit';
    input.value = tag.textContent ?? '';
    const ed = getComputedStyle(editor.getDomNode()!); // the input sits outside .monaco-editor, so its theme variables do not reach it
    Object.assign(input.style, { left: `${r.left - 4}px`, top: `${r.top - 2}px`, minWidth: `${r.width + 12}px`, fontSize: getComputedStyle(tag).fontSize, color: ed.color, background: ed.backgroundColor });
    tag.style.visibility = 'hidden';
    document.body.appendChild(input);
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      scroll.dispose();
      input.remove();
      tag.style.visibility = '';
      const name = input.value.trim();
      if (save && name !== tag.textContent && editor.getModel() === model) {
        const m = [...model.getValue().slice(f.start, f.end).matchAll(/\\label\{[^}]*\}/g)][i];
        if (m) {
          const a = f.start + m.index!;
          const range = monaco.Range.fromPositions(model.getPositionAt(a), model.getPositionAt(a + m[0].length));
          model.pushEditOperations([], [{ range, text: name ? `\\label{${name}}` : '' }], () => null);
        }
      }
      editor.focus();
    };
    const scroll = editor.onDidScrollChange(() => finish(true)); // the input does not follow the editor
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') (e.preventDefault(), finish(e.key === 'Enter'));
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
    input.select();
  }

  let mouseDown = false;
  const onDown = () => (mouseDown = true), onUp = () => (mouseDown = false);
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mouseup', onUp, true);
  let lastPos: Monaco.Position | null = editor.getPosition();
  const M = monaco.KeyMod, K = monaco.KeyCode;
  const subs = [
    editor.onDidChangeModel(() => {
      if (edit) leave(null);
      reparse();
    }),
    editor.onDidChangeModelContent(() => {
      if (edit) return;
      reparse();
      // typing just made an empty display block around the caret (e.g. \begin{equation} auto-closed): its lines are now hidden, so type in the box
      setTimeout(() => {
        const l = editor.getPosition()?.lineNumber;
        const f = !edit && editor.hasTextFocus() && l ? list.find((x) => x.block && !x.latex && x.startLine <= l && l <= x.endLine) : undefined; // only a new, empty one: never grab a half-typed pairing
        if (f) void openBox(f, true);
      });
    }),
    editor.onDidChangeConfiguration((e) => {
      if (e.hasChanged(monaco.editor.EditorOption.fontInfo)) {
        cache.clear();
        for (const s of statics.values()) editor.removeContentWidget(s.widget);
        statics.clear();
        editor.changeViewZones((acc) => {
          for (const [key, id] of zones) if (key !== 'edit') (acc.removeZone(id), zones.delete(key));
        });
        apply();
      }
    }),
    // ←/→ into a formula opens it, as do ↑/↓ across a display block
    editor.onDidChangeCursorPosition((e) => {
      const prev = lastPos;
      lastPos = e.position;
      const model = editor.getModel();
      if (!enabled || edit || !model || !prev || e.source !== 'keyboard' || e.reason !== monaco.editor.CursorChangeReason.Explicit) return;
      if (!editor.getSelection()?.isEmpty()) return;
      const o = model.getOffsetAt(e.position), p = model.getOffsetAt(prev);
      const inside = list.find((f) => !f.block && f.start < o && o < f.end);
      if (inside) return void openBox(inside, p >= inside.end);
      const l = e.position.lineNumber;
      // ←/→ off a line's edge lands on a display block's hidden lines: open it instead
      const onHidden = list.find((f) => f.block && f.startLine <= l && l <= f.endLine);
      if (onHidden) {
        editor.setPosition(prev);
        return void openBox(onHidden, p >= onHidden.end);
      }
      const crossed = list.find((f) => f.block && ((prev.lineNumber < f.startLine && l > f.endLine) || (prev.lineNumber > f.endLine && l < f.startLine)));
      if (crossed && Math.abs(l - prev.lineNumber) <= crossed.endLine - crossed.startLine + 2) {
        editor.setPosition(prev);
        void openBox(crossed, l < prev.lineNumber);
      }
    }),
    editor.onMouseDown((e) => {
      const t = e.target;
      const id =
        t.type === monaco.editor.MouseTargetType.CONTENT_WIDGET ? t.detail : t.type === monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE ? t.detail.viewZoneId : null;
      const f = id != null ? clickTarget.get(id) : undefined;
      if (!f || !enabled) return;
      e.event.preventDefault();
      // Monaco's text layer covers view zones, so a label never gets the click itself: hit-test by position
      const { posx: x, posy: y } = e.event;
      const tags = [...(editor.getDomNode()?.querySelectorAll<HTMLElement>('.tex-conceal-labels span') ?? [])];
      const tag = tags.find((el) => {
        const r = el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
      if (tag) {
        const i = [...tag.parentElement!.children].indexOf(tag);
        return void window.addEventListener('mouseup', () => setTimeout(() => editLabel(f, i, tag)), { once: true });
      }
      // after the mouse-up: Monaco focuses itself on it, which would close the box
      const box = edit && f.start === editStart() ? edit.mf : null;
      window.addEventListener('mouseup', () => setTimeout(() => (box ? box.focus() : void openBox(f, true))), { once: true });
    }),
  ];
  const actions = [
    editor.addAction({
      id: 'texConceal.inline',
      label: 'Insert inline formula',
      keybindings: [M.CtrlCmd | K.KeyM, M.WinCtrl | K.KeyM, M.Alt | K.Digit4],
      run: () => insert(false),
    }),
    editor.addAction({
      id: 'texConceal.display',
      label: 'Insert display formula',
      keybindings: [M.CtrlCmd | M.Shift | K.KeyM, M.WinCtrl | M.Shift | K.KeyM, M.Alt | M.Shift | K.Digit4],
      run: () => insert(true),
    }),
  ];
  refresh = () => {
    if (!enabled && edit) leave(null);
    // hiding/showing blocks above changes heights: keep the cursor's line where it is on screen
    const line = editor.getPosition()?.lineNumber ?? 1;
    const offset = editor.getTopForLineNumber(line) - editor.getScrollTop();
    reparse();
    editor.setScrollTop(editor.getTopForLineNumber(line) - offset);
  };
  reparse();

  return {
    dispose() {
      for (const s of [...subs, ...actions]) s.dispose();
      if (edit) leave(null);
      enabled = false;
      reparse(); // removes everything it added
      measureHost.remove();
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
      refresh = null;
    },
  };
}
