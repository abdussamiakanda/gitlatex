/**
 * Monaco text models for project files. A model is created lazily when a file
 * is opened and kept in sync with the Workspace in both directions.
 */
import { monaco } from './monaco';
import type { Workspace } from '../state/workspace';
import { languageFor } from '../utils/paths';

const models = new Map<string, monaco.editor.ITextModel>();
let workspace: Workspace | null = null;
let suppress = false;

export const uriFor = (path: string) => monaco.Uri.from({ scheme: 'tbfile', path: '/' + path });
export const pathOf = (model: monaco.editor.ITextModel) => model.uri.path.slice(1);

export function bindWorkspace(ws: Workspace | null) {
  disposeAll();
  workspace = ws;
}

export function getModel(path: string): monaco.editor.ITextModel | null {
  const existing = models.get(path);
  if (existing && !existing.isDisposed()) return existing;
  const text = workspace?.getText(path);
  if (text === undefined || !workspace) return null;
  const model = monaco.editor.createModel(text, languageFor(path), uriFor(path));
  model.updateOptions({ tabSize: 2, insertSpaces: true });
  model.onDidChangeContent(() => {
    if (!suppress) workspace?.setText(path, model.getValue());
  });
  models.set(path, model);
  return model;
}

/** Push an external change (pull, restore, quick fix) into an open model, keeping undo history. */
export function syncModel(path: string) {
  const model = models.get(path);
  const text = workspace?.getText(path);
  if (!model || model.isDisposed() || text === undefined || model.getValue() === text) return;
  suppress = true;
  try {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  } finally {
    suppress = false;
  }
}

export function syncAllModels() {
  for (const path of [...models.keys()]) {
    if (workspace?.getText(path) === undefined) disposeModel(path);
    else syncModel(path);
  }
}

export function disposeModel(path: string) {
  models.get(path)?.dispose();
  models.delete(path);
}

export function disposeAll() {
  for (const m of models.values()) m.dispose();
  models.clear();
}

export function openModels() {
  return [...models.entries()];
}
