/**
 * User snippets: the user's own prefixes that expand into LaTeX.
 *
 * Stored by the server in ~/.gitlatex/snippets.json, so every project and
 * every browser sees the same set. A snippet expands when it is picked from
 * the suggestion list, or when its exact prefix is typed and Tab is pressed.
 * Bodies use Monaco snippet syntax: $1, ${1:default}, ${1|a,b|}, $0.
 */
import type { monaco as Monaco } from './monaco';
import { monaco } from './monaco';

type Editor = Monaco.editor.IStandaloneCodeEditor;

export type SnippetScope = 'latex' | 'bib' | 'all';

export interface Snippet {
  prefix: string;
  body: string;
  description: string;
  /** Stored as the classic editor names them: "latex" (.tex), "bib" (.bib) or "all". */
  scope: SnippetScope;
}

let snippets: Snippet[] = [];
let loadPromise: Promise<Snippet[]> | null = null;
const listeners = new Set<(s: Snippet[]) => void>();

function publish(next: Snippet[]) {
  snippets = next;
  for (const l of listeners) l(snippets);
}

export function onSnippets(fn: (s: Snippet[]) => void): () => void {
  listeners.add(fn);
  fn(snippets);
  return () => listeners.delete(fn);
}

export function loadSnippets(force = false): Promise<Snippet[]> {
  if (loadPromise && !force) return loadPromise;
  loadPromise = fetch('/snippets')
    .then((r) => r.json() as Promise<{ snippets?: Snippet[] }>)
    .then((data) => {
      publish(Array.isArray(data.snippets) ? data.snippets : []);
      return snippets;
    })
    .catch(() => {
      loadPromise = null;
      return snippets;
    });
  return loadPromise;
}

/** Replace the saved list. Throws with the server's message when it is rejected. */
export async function saveSnippets(list: Snippet[]): Promise<Snippet[]> {
  const res = await fetch('/snippets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snippets: list }) });
  const data = (await res.json().catch(() => ({}))) as { snippets?: Snippet[]; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  publish(data.snippets ?? []);
  loadPromise = Promise.resolve(snippets);
  return snippets;
}

/** Snippet scope → the editor's language id. */
const scopeMatches = (s: Snippet, languageId: string) => s.scope === 'all' || (s.scope === 'bib' ? languageId === 'bibtex' : s.scope === languageId);

/** The text a prefix could have been typed as: back to whitespace or a bracket. */
const tokenBefore = (textBefore: string) => /[^\s{}()[\],]*$/.exec(textBefore)![0];

/** Longest snippet whose prefix ends exactly at the cursor. */
function snippetAtCursor(model: Monaco.editor.ITextModel, position: Monaco.Position): Snippet | null {
  const textBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const token = tokenBefore(textBefore);
  let best: Snippet | null = null;
  for (const s of snippets) {
    if (!scopeMatches(s, model.getLanguageId()) || !token.endsWith(s.prefix)) continue;
    // "eq" should not fire inside "seq"; a prefix that starts with a symbol (\, @, ;) may follow anything.
    const charBefore = textBefore.charAt(textBefore.length - s.prefix.length - 1);
    if (/\w/.test(s.prefix[0]) && /\w/.test(charBefore)) continue;
    if (!best || s.prefix.length > best.prefix.length) best = s;
  }
  return best;
}

/** Plain text → snippet body, escaping the characters Monaco would interpret. */
export const textToSnippetBody = (text: string) => text.replace(/[\\$}]/g, '\\$&');

/**
 * Accept our own export or a VS Code snippets file ({name: {prefix, body}}),
 * and merge it into the saved list (imported snippets win). Returns how many were imported.
 */
export async function importSnippets(json: string): Promise<number> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  type Raw = { prefix?: unknown; body?: unknown; description?: unknown; scope?: unknown };
  let incoming: Raw[] | null = Array.isArray(data) ? data : Array.isArray((data as { snippets?: unknown })?.snippets) ? (data as { snippets: Raw[] }).snippets : null;
  if (!incoming && data && typeof data === 'object') {
    incoming = [];
    for (const [name, raw] of Object.entries(data as Record<string, Raw>)) {
      const prefixes = Array.isArray(raw?.prefix) ? raw.prefix : [raw?.prefix];
      for (const prefix of prefixes.filter(Boolean)) incoming.push({ prefix, body: raw.body, description: raw.description ?? name, scope: 'latex' });
    }
  }
  await loadSnippets();
  const merged = snippets.slice();
  let count = 0;
  for (const s of incoming ?? []) {
    if (!s?.prefix || !s.body) continue;
    const item: Snippet = {
      prefix: String(s.prefix).trim(),
      body: Array.isArray(s.body) ? s.body.join('\n') : String(s.body),
      description: typeof s.description === 'string' ? s.description : '',
      scope: s.scope === 'bib' || s.scope === 'all' ? s.scope : 'latex',
    };
    const at = merged.findIndex((m) => m.prefix === item.prefix && m.scope === item.scope);
    if (at === -1) merged.push(item);
    else merged[at] = item;
    count++;
  }
  if (!count) throw new Error('No snippets found in that file.');
  await saveSnippets(merged);
  return count;
}

export function exportSnippetsJson(): string {
  return JSON.stringify({ snippets }, null, 2) + '\n';
}

let providersRegistered = false;

function registerProviders() {
  if (providersRegistered) return;
  providersRegistered = true;
  for (const languageId of ['latex', 'bibtex']) {
    monaco.languages.registerCompletionItemProvider(languageId, {
      provideCompletionItems(model, position) {
        const token = tokenBefore(model.getLineContent(position.lineNumber).slice(0, position.column - 1));
        if (!token) return { suggestions: [] };
        const range = new monaco.Range(position.lineNumber, position.column - token.length, position.lineNumber, position.column);
        return {
          suggestions: snippets
            .filter((s) => scopeMatches(s, languageId))
            .map((s) => ({
              label: { label: s.prefix, description: s.description || 'user snippet' },
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: s.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              filterText: s.prefix,
              // Ahead of the built-in commands when both match.
              sortText: '!' + s.prefix,
              detail: 'User snippet',
              documentation: { value: '```latex\n' + s.body + '\n```' },
              range,
            })),
        };
      },
    });
  }
}

/**
 * Snippet completions, Tab-expansion of an exact prefix, and "Save Selection
 * as Snippet…" in the editor's context menu. `askPrefix` shows a prompt.
 */
export function installSnippets(editor: Editor, askPrefix: () => Promise<string | null>, notify: (ok: boolean, message: string) => void) {
  void loadSnippets();
  registerProviders();

  // Tab after an exact prefix expands it, but only when no suggestion list or
  // snippet placeholders already own Tab; otherwise Tab behaves as before.
  editor.addCommand(
    monaco.KeyCode.Tab,
    () => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      const snippet = model && selection && selection.isEmpty() ? snippetAtCursor(model, selection.getPosition()) : null;
      if (!snippet) {
        editor.trigger('keyboard', 'tab', null);
        return;
      }
      const controller = editor.getContribution('snippetController2') as unknown as {
        insert(body: string, opts: { overwriteBefore: number; overwriteAfter: number }): void;
      };
      controller.insert(snippet.body, { overwriteBefore: snippet.prefix.length, overwriteAfter: 0 });
    },
    'editorTextFocus && !editorReadonly && !suggestWidgetVisible && !inSnippetMode && !editorHasSelection && !editorTabMovesFocus && !tbSlashOpen',
  );

  editor.addAction({
    id: 'gitlatex.snippets.saveSelection',
    label: 'Save Selection as Snippet…',
    contextMenuGroupId: '1_modification',
    contextMenuOrder: 4,
    precondition: 'editorHasSelection',
    run: async (ed) => {
      const model = ed.getModel();
      const sel = ed.getSelection();
      if (!model || !sel) return;
      const text = model.getValueInRange(sel);
      if (!text.trim()) return;
      const prefix = (await askPrefix())?.trim();
      ed.focus();
      if (!prefix) return;
      if (/\s/.test(prefix)) return notify(false, 'A snippet prefix must be one word, with no spaces.');
      await loadSnippets();
      const scope: SnippetScope = model.getLanguageId() === 'bibtex' ? 'bib' : 'latex';
      const next = snippets.filter((s) => !(s.prefix === prefix && s.scope === scope));
      next.push({ prefix, body: textToSnippetBody(text) + '$0', description: '', scope });
      try {
        await saveSnippets(next);
        notify(true, `Saved snippet "${prefix}". Type it and press Tab to insert it.`);
      } catch (err) {
        notify(false, `Could not save the snippet: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
