/**
 * Merge conflicts in the editor, as in VS Code: each conflict block is
 * coloured (current = yours, incoming = theirs) and gets "Accept Current |
 * Accept Incoming | Accept Both" above its <<<<<<< line. Accepting is an
 * ordinary edit, so Ctrl+Z undoes it. diff3-style blocks (with a ||||||| base
 * section) are understood too.
 */
import type { monaco as Monaco } from './monaco';
import { monaco } from './monaco';
import './conflicts.css';
import { findConflicts, resolvedText, type Side } from './conflict-blocks';

type Editor = Monaco.editor.IStandaloneCodeEditor;
type Model = Monaco.editor.ITextModel;

function accept(model: Model, start: number, side: Side) {
  const lines = model.getLinesContent();
  const c = findConflicts(lines).find((x) => x.start === start);
  if (!c) return;
  const text = resolvedText(lines, c, side);
  const last = c.end < model.getLineCount();
  // Replace whole lines, including the line break after >>>>>>> when there is one.
  const range = last ? new monaco.Range(c.start, 1, c.end + 1, 1) : new monaco.Range(c.start, 1, c.end, model.getLineMaxColumn(c.end));
  const replacement = text.length ? text.join(model.getEOL()) + (last ? model.getEOL() : '') : '';
  model.pushStackElement();
  model.pushEditOperations([], [{ range, text: replacement }], () => null);
  model.pushStackElement();
}

let registered = false;
/** Whose version "current" and "incoming" are right now (they swap in a rebase). */
let sideNames: () => { current: string; incoming: string } | undefined = () => undefined;
const named = (base: string, who?: string) => (who ? `${base} (${who})` : base);

function registerProviders() {
  if (registered) return;
  registered = true;
  const command = 'gitlatex.conflict.accept';
  monaco.editor.registerCommand(command, (_accessor, uri: string, start: number, side: Side) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (model) accept(model, start, side);
  });
  monaco.languages.registerCodeLensProvider('*', {
    provideCodeLenses(model) {
      const sides = sideNames();
      const lenses: Monaco.languages.CodeLens[] = [];
      for (const c of findConflicts(model.getLinesContent())) {
        const range = new monaco.Range(c.start, 1, c.start, 1);
        const uri = model.uri.toString();
        lenses.push(
          { range, command: { id: command, title: named('Accept Current Change', sides?.current), arguments: [uri, c.start, 'current'] } },
          { range, command: { id: command, title: named('Accept Incoming Change', sides?.incoming), arguments: [uri, c.start, 'incoming'] } },
          { range, command: { id: command, title: 'Accept Both Changes', arguments: [uri, c.start, 'both'] } },
        );
      }
      return { lenses, dispose() {} };
    },
  });
}

function decorationsFor(model: Model): Monaco.editor.IModelDeltaDecoration[] {
  const out: Monaco.editor.IModelDeltaDecoration[] = [];
  const block = (from: number, to: number, className: string, ruler?: string) => {
    if (to < from) return;
    out.push({
      range: new monaco.Range(from, 1, to, 1),
      options: {
        isWholeLine: true,
        className,
        overviewRuler: ruler ? { color: ruler, position: monaco.editor.OverviewRulerLane.Full } : undefined,
      },
    });
  };
  for (const c of findConflicts(model.getLinesContent())) {
    block(c.start, c.start, 'conflict-current-header');
    block(c.start + 1, (c.base ?? c.mid) - 1, 'conflict-current', 'rgba(64, 200, 174, 0.6)');
    if (c.base) block(c.base, c.mid - 1, 'conflict-base');
    block(c.mid, c.mid, 'conflict-separator');
    block(c.mid + 1, c.end - 1, 'conflict-incoming', 'rgba(64, 166, 255, 0.6)');
    block(c.end, c.end, 'conflict-incoming-header');
  }
  return out;
}

/** Colour conflict blocks in whatever file the editor shows, and offer the accept actions. */
export function installConflictTools(editor: Editor, sides?: () => { current: string; incoming: string } | undefined): Monaco.IDisposable {
  if (sides) sideNames = sides;
  registerProviders();
  const decorations = editor.createDecorationsCollection();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    const model = editor.getModel();
    decorations.set(model ? decorationsFor(model) : []);
  };
  const subs = [
    editor.onDidChangeModel(update),
    editor.onDidChangeModelContent(() => {
      clearTimeout(timer);
      timer = setTimeout(update, 150);
    }),
  ];
  update();
  return {
    dispose() {
      clearTimeout(timer);
      for (const s of subs) s.dispose();
      decorations.clear();
    },
  };
}
