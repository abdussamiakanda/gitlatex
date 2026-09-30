/**
 * Spell checking: squiggles, quick fixes and the personal dictionary.
 *
 * The server does the LaTeX-aware part (gitlatex/services/spell.py): it blanks
 * out comments, math and command arguments before looking words up, so what
 * comes back is already limited to prose, with exact line/column positions.
 */
import type { monaco as Monaco } from './monaco';
import { monaco } from './monaco';
import { pathOf } from './models';

type Editor = Monaco.editor.IStandaloneCodeEditor;
type Model = Monaco.editor.ITextModel;

const OWNER = 'spell';
const DEBOUNCE_MS = 700;
/** Only prose-bearing files; .bib and code files are noise. */
const CHECKED = /\.(tex|txt|md|rmd)$/i;
const ADD_COMMAND = 'gitlatex.addToDictionary';

export interface SpellStatus {
  available: boolean | null;
  userWords: string[];
  error?: string;
}

let status: SpellStatus = { available: null, userWords: [] };
const listeners = new Set<(s: SpellStatus) => void>();
/** Lowercased word → suggestions, for the quick-fix provider. */
let suggestions = new Map<string, string[]>();
let enabled = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let requestId = 0;
let editorRef: Editor | null = null;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

function setStatus(next: SpellStatus) {
  status = next;
  for (const l of listeners) l(status);
}

export function onSpellStatus(fn: (s: SpellStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

/** Ask the server whether symspellpy is installed (once). */
export async function loadSpellStatus(): Promise<SpellStatus> {
  try {
    const data = (await (await fetch('/spell/status')).json()) as { available?: boolean; userWords?: string[]; error?: string };
    setStatus({ available: !!data.available, userWords: data.userWords ?? [], error: data.error });
  } catch {
    setStatus({ ...status, available: false });
  }
  return status;
}

function clear(model: Model | null) {
  if (model && !model.isDisposed()) monaco.editor.setModelMarkers(model, OWNER, []);
}

export function scheduleSpellCheck(delay = DEBOUNCE_MS) {
  clearTimeout(timer);
  timer = setTimeout(() => void runSpellCheck(), delay);
}

async function runSpellCheck() {
  const model = editorRef?.getModel() ?? null;
  if (!model) return;
  if (!enabled || !CHECKED.test(pathOf(model))) {
    clear(model);
    return;
  }
  if (status.available === null) await loadSpellStatus();
  if (!status.available) return;

  const id = ++requestId;
  let data: { available?: boolean; words?: { word: string; line: number; column: number; endColumn: number; suggestions?: string[] }[] };
  try {
    data = await postJson('/spell/check', { text: model.getValue() });
  } catch {
    return;
  }
  // A newer keystroke already fired, or another file is open now.
  if (id !== requestId || editorRef?.getModel() !== model) return;
  if (data.available === false) {
    setStatus({ ...status, available: false });
    clear(model);
    return;
  }
  suggestions = new Map();
  const markers = (data.words ?? []).map((w) => {
    suggestions.set(w.word.toLowerCase(), w.suggestions ?? []);
    const hint = w.suggestions?.length ? `Did you mean: ${w.suggestions.slice(0, 3).join(', ')}?` : 'Not in dictionary.';
    return {
      startLineNumber: w.line,
      endLineNumber: w.line,
      startColumn: w.column,
      endColumn: w.endColumn,
      message: `"${w.word}" - ${hint}`,
      severity: monaco.MarkerSeverity.Info,
      source: 'spelling',
    };
  });
  monaco.editor.setModelMarkers(model, OWNER, markers);
}

/** Teach the server a word, then re-check so its squiggles disappear. */
export async function addWordToDictionary(word: string) {
  if (!word) return;
  try {
    const data = await postJson<{ userWords?: string[] }>('/spell/dictionary', { word, action: 'add' });
    if (data.userWords) setStatus({ ...status, userWords: data.userWords });
  } catch {
    return;
  }
  scheduleSpellCheck(0);
}

export async function removeWordFromDictionary(word: string) {
  try {
    const data = await postJson<{ userWords?: string[] }>('/spell/dictionary', { word, action: 'remove' });
    if (data.userWords) setStatus({ ...status, userWords: data.userWords });
  } catch {
    return;
  }
  scheduleSpellCheck(0);
}

export function setSpellCheckEnabled(on: boolean) {
  enabled = on;
  if (on) scheduleSpellCheck(0);
  else clear(editorRef?.getModel() ?? null);
}

let providersRegistered = false;

/** Quick fixes on a spelling marker: each suggestion, plus "add to dictionary". */
function registerProviders() {
  if (providersRegistered) return;
  providersRegistered = true;
  // A code action's command goes through the command service, which
  // editor.addAction does not populate, so register it explicitly.
  monaco.editor.registerCommand(ADD_COMMAND, (_accessor, word: string) => void addWordToDictionary(word));
  const provider: Monaco.languages.CodeActionProvider = {
    provideCodeActions(model, _range, context) {
      const actions: Monaco.languages.CodeAction[] = [];
      const seen = new Set<string>();
      for (const marker of context.markers) {
        if (marker.source !== 'spelling') continue;
        const range = new monaco.Range(marker.startLineNumber, marker.startColumn, marker.endLineNumber, marker.endColumn);
        const word = model.getValueInRange(range);
        if (!word || seen.has(word)) continue;
        seen.add(word);
        (suggestions.get(word.toLowerCase()) ?? []).forEach((s, i) =>
          actions.push({
            title: `Replace with "${s}"`,
            kind: 'quickfix',
            diagnostics: [marker],
            isPreferred: i === 0,
            edit: { edits: [{ resource: model.uri, textEdit: { range, text: s }, versionId: model.getVersionId() }] },
          }),
        );
        actions.push({
          title: `Add "${word}" to dictionary`,
          kind: 'quickfix',
          diagnostics: [marker],
          command: { id: ADD_COMMAND, title: 'Add to dictionary', arguments: [word] },
        });
      }
      return { actions, dispose() {} };
    },
  };
  for (const lang of ['latex', 'plaintext', 'markdown']) monaco.languages.registerCodeActionProvider(lang, provider);
}

/** Check the file in the editor as it changes, and whenever another file is opened. */
export function installSpellCheck(editor: Editor, on: boolean): Monaco.IDisposable {
  editorRef = editor;
  enabled = on;
  registerProviders();
  const subs = [
    editor.onDidChangeModel(() => scheduleSpellCheck(0)),
    editor.onDidChangeModelContent(() => scheduleSpellCheck()),
  ];
  scheduleSpellCheck(0);
  return {
    dispose() {
      for (const s of subs) s.dispose();
      clearTimeout(timer);
      if (editorRef === editor) editorRef = null;
    },
  };
}
