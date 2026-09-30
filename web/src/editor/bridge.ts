/**
 * A tiny bridge so non-React code (actions, wizards, quick fixes) can reach
 * the live Monaco editor instance.
 */
import type { monaco } from './monaco';

type Editor = monaco.editor.IStandaloneCodeEditor;

let editor: Editor | null = null;
/** Range of the "/query" text that opened the slash menu (replaced on insert). */
let pendingSlashRange: monaco.IRange | null = null;

export const editorBridge = {
  set(e: Editor | null) {
    editor = e;
  },
  get(): Editor | null {
    return editor;
  },
  setSlashRange(r: monaco.IRange | null) {
    pendingSlashRange = r;
  },
  takeSlashRange(): monaco.IRange | null {
    const r = pendingSlashRange;
    pendingSlashRange = null;
    return r;
  },
  /** Insert a Monaco snippet at the cursor (or replacing `range`). */
  insertSnippet(snippet: string, range?: monaco.IRange | null) {
    if (!editor) return false;
    editor.focus();
    if (range) editor.setSelection(range);
    const controller = editor.getContribution('snippetController2') as unknown as { insert(s: string): void } | null;
    if (controller) controller.insert(snippet);
    else editor.trigger('texbrowser', 'type', { text: snippet.replace(/\$\{\d+:?([^}]*)\}|\$\d/g, '$1') });
    return true;
  },
  insertText(text: string) {
    if (!editor) return false;
    const sel = editor.getSelection();
    if (!sel) return false;
    editor.executeEdits('texbrowser', [{ range: sel, text, forceMoveMarkers: true }]);
    editor.focus();
    return true;
  },
};
