/**
 * Two-way binding between a Monaco model and a Y.Text, plus the decorations
 * that show other collaborators' cursors and selections in that model.
 *
 * Local edits go into the Y.Text as Yjs operations; remote operations come
 * back as one batch of Monaco edits, so the local cursor stays where it was.
 */
import * as Y from 'yjs';
import { applyText } from './merge';
import type { Awareness } from 'y-protocols/awareness';
import { monaco } from '../editor/monaco';

/** Transaction origin of edits made in this tab. */
export const LOCAL = Symbol('gitlatex-local');

/** What each collaborator publishes through awareness. */
export interface PeerState {
  user?: { name: string; color: string };
  cursor?: { path: string; anchor: unknown; head: unknown } | null;
}

export class TextBinding {
  private applyingRemote = false;
  private readonly subs: monaco.IDisposable[] = [];
  private decorationIds: string[] = [];

  constructor(
    readonly path: string,
    readonly ytext: Y.Text,
    readonly model: monaco.editor.ITextModel,
    private readonly awareness: Awareness,
  ) {
    // The room is the source of truth: show what it has.
    this.replaceModel(ytext.toString());
    // Monaco normalises line endings; if that changed anything, hand the normalised text back.
    if (model.getValue() !== ytext.toString()) this.replaceY(model.getValue());

    ytext.observe(this.onYChange);
    this.subs.push(model.onDidChangeContent(this.onModelChange));
    awareness.on('change', this.renderPeers);
    this.renderPeers();
  }

  dispose() {
    this.ytext.unobserve(this.onYChange);
    this.awareness.off('change', this.renderPeers);
    for (const s of this.subs) s.dispose();
    if (!this.model.isDisposed()) this.decorationIds = this.model.deltaDecorations(this.decorationIds, []);
  }

  // ---- Y → Monaco --------------------------------------------------------------

  private onYChange = (event: Y.YTextEvent, tr: Y.Transaction) => {
    if (tr.origin === LOCAL || this.model.isDisposed()) return;
    // Ranges are computed against the model as it is now, so every edit is
    // applied in one batch. Adjacent insert/delete ops merge into one replace.
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    let index = 0;
    let pending: { start: number; end: number; text: string } | null = null;
    const flush = () => {
      if (!pending) return;
      const start = this.model.getPositionAt(pending.start);
      const end = this.model.getPositionAt(pending.end);
      edits.push({ range: monaco.Range.fromPositions(start, end), text: pending.text, forceMoveMarkers: true });
      pending = null;
    };
    for (const op of event.delta) {
      if (op.retain !== undefined) {
        flush();
        index += op.retain;
      } else if (op.delete !== undefined) {
        pending ??= { start: index, end: index, text: '' };
        pending.end += op.delete;
        index += op.delete;
      } else if (typeof op.insert === 'string') {
        pending ??= { start: index, end: index, text: '' };
        pending.text += op.insert;
      }
    }
    flush();
    if (!edits.length) return;
    this.applyingRemote = true;
    try {
      this.model.applyEdits(edits);
    } finally {
      this.applyingRemote = false;
    }
    this.renderPeers();
  };

  // ---- Monaco → Y --------------------------------------------------------------

  private onModelChange = (e: monaco.editor.IModelContentChangedEvent) => {
    if (this.applyingRemote) return;
    const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
    this.ytext.doc!.transact(() => {
      for (const c of changes) {
        if (c.rangeLength) this.ytext.delete(c.rangeOffset, c.rangeLength);
        if (c.text) this.ytext.insert(c.rangeOffset, c.text);
      }
    }, LOCAL);
  };

  private replaceModel(text: string) {
    if (this.model.getValue() === text) return;
    this.applyingRemote = true;
    try {
      this.model.applyEdits([{ range: this.model.getFullModelRange(), text }]);
    } finally {
      this.applyingRemote = false;
    }
  }

  private replaceY(text: string) {
    replaceText(this.ytext, text);
  }

  // ---- local selection → awareness -------------------------------------------------

  /** Publish the selection of the editor showing this model. */
  publishSelection(selection: monaco.Selection) {
    const anchor = this.model.getOffsetAt(selection.getStartPosition());
    const head = this.model.getOffsetAt(selection.getEndPosition());
    const [a, h] = selection.getDirection() === monaco.SelectionDirection.RTL ? [head, anchor] : [anchor, head];
    this.awareness.setLocalStateField('cursor', {
      path: this.path,
      anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.ytext, a)),
      head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.ytext, h)),
    });
  }

  // ---- remote cursors → decorations ------------------------------------------------

  private renderPeers = () => {
    if (this.model.isDisposed()) return;
    const doc = this.ytext.doc!;
    const next: monaco.editor.IModelDeltaDecoration[] = [];
    this.awareness.getStates().forEach((raw, clientId) => {
      const state = raw as PeerState;
      if (clientId === doc.clientID || !state.cursor || state.cursor.path !== this.path) return;
      const anchor = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.anchor), doc);
      const head = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.head), doc);
      if (!anchor || !head || anchor.type !== this.ytext || head.type !== this.ytext) return;
      const a = this.model.getPositionAt(anchor.index);
      const h = this.model.getPositionAt(head.index);
      if (anchor.index !== head.index) {
        next.push({
          range: monaco.Range.fromPositions(anchor.index < head.index ? a : h, anchor.index < head.index ? h : a),
          options: { className: `collab-sel collab-sel-${clientId}`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
        });
      }
      next.push({
        range: monaco.Range.fromPositions(h, h),
        options: {
          beforeContentClassName: `collab-caret collab-caret-${clientId}`,
          hoverMessage: { value: state.user?.name ?? 'Collaborator' },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    });
    this.decorationIds = this.model.deltaDecorations(this.decorationIds, next);
  };
}

/** Turn `ytext` into `text` with one delete and one insert around the common prefix/suffix. */
export function replaceText(ytext: Y.Text, text: string, origin: unknown = LOCAL) {
  if (ytext.toString() === text) return;
  // The smallest edits, so others' concurrent changes elsewhere in the file survive.
  ytext.doc!.transact(() => applyText(ytext, text), origin);
}
