/**
 * Review comments: Overleaf-style threads on selected text.
 *
 * Select text (or put the cursor on a line) and use "Add Comment" from the
 * context menu, Ctrl/Cmd+Alt+M, or the button in the panel. Each thread is
 * signed with the project's git user.name and stored by the server under
 * .gitlatex/comments/ (gitlatex/services/comments.py), so it is committed and
 * pushed with the project.
 *
 * Cards sit level with the text they are about and follow the editor as it
 * scrolls. Ranges are tracked with Monaco decorations while you type, and the
 * new positions are saved shortly after, so comments stay attached to their
 * text. When a file changed elsewhere (a pull), threads are found again by the
 * text they quote.
 *
 * Ported from the classic editor (public/js/editor/review.js). The panel's
 * skeleton is React (components/ReviewPanel.tsx); the cards inside it are
 * drawn here, because they have to follow the editor frame by frame.
 */
import type { monaco as Monaco } from './monaco';
import { monaco } from './monaco';
import { pathOf } from './models';
import { getState, setState, toast, openDialog, useStore } from '../state/store';
import { isMac } from '../utils/misc';

type Editor = Monaco.editor.IStandaloneCodeEditor;
type Model = Monaco.editor.ITextModel;

interface Range {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface Message {
  id: string;
  author: string;
  email?: string;
  date: string;
  text: string;
}

interface Thread {
  id: string;
  file: string;
  range: Range;
  quote?: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  messages: Message[];
}

interface Me {
  name: string;
  email?: string;
  configured: boolean;
}

const DRAFT = 'draft';
const CARD_GAP = 8;
const SYNC_DELAY_MS = 1500;
export const REVIEW_SHORTCUT = isMac ? '⌘⌥M' : 'Ctrl+Alt+M';

let editor: Editor | null = null;
let threads: Thread[] = []; // threads of `loadedFile`
let loadedFile: string | null = null; // file the threads (and decorations) belong to
let loadedModel: Model | null = null;
let loadToken = 0;
let decoIds = new Map<string, string>(); // thread id (or DRAFT) → decoration id
let savedAnchors = new Map<string, string>(); // thread id → anchor as the server has it
let draft: { range: Range; quote: string } | null = null;
let activeId: string | null = null;
let showResolved = false;
let me: Me | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let layoutFrame = 0;

// ---- small helpers --------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string | null, text?: string | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Lucide icon paths (the rest of the UI uses lucide-react).
const ICONS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function iconButton(icon: string, act: string, title: string) {
  const b = el('button', 'review-icon-btn');
  b.type = 'button';
  b.dataset.reviewAct = act;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return b;
}

const toMonaco = (r: Range) => new monaco.Range(r.startLine, r.startColumn, r.endLine, r.endColumn);
const fromMonaco = (r: Monaco.IRange): Range => ({ startLine: r.startLineNumber, startColumn: r.startColumn, endLine: r.endLineNumber, endColumn: r.endColumn });
const sameRange = (a?: Range, b?: Range) =>
  !!a && !!b && a.startLine === b.startLine && a.startColumn === b.startColumn && a.endLine === b.endLine && a.endColumn === b.endColumn;
const anchorKey = (t: Thread) => JSON.stringify([t.range, t.quote ?? '']);
const threadById = (id: string | null) => threads.find((t) => t.id === id) ?? null;
const isVisible = (t: Thread) => showResolved || !t.resolved;
const currentPath = () => {
  const model = editor?.getModel();
  return model ? pathOf(model) : null;
};
const hasFile = () => !!loadedFile && loadedFile === currentPath();
const isMine = (m: Message) => !!me && m.author === me.name && (m.email ?? '') === (me.email ?? '');
export const isReviewPanelOpen = () => getState().sidebar === 'review';

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 50%, 42%)`;
}

function when(iso?: string) {
  const d = new Date(iso ?? '');
  if (isNaN(d.getTime())) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

async function request<T>(url: string, body?: unknown): Promise<T & { error?: string }> {
  try {
    const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.json()) as T & { error?: string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) } as T & { error?: string };
  }
}

const fail = (title: string, message: string) => toast({ kind: 'error', title, message });

// ---- anchors: finding, tracking and saving ranges -------------------------------------------

function clampRange(model: Model, r: Partial<Range>): Range {
  const lines = model.getLineCount();
  const sl = Math.min(Math.max(1, r.startLine || 1), lines);
  const endLine = Math.min(Math.max(sl, r.endLine || sl), lines);
  const sc = Math.min(Math.max(1, r.startColumn || 1), model.getLineMaxColumn(sl));
  let ec = Math.min(Math.max(1, r.endColumn || 1), model.getLineMaxColumn(endLine));
  if (endLine === sl && ec < sc) ec = sc;
  return { startLine: sl, startColumn: sc, endLine, endColumn: ec };
}

/** The stored range if it still holds the quoted text, else the nearest place that does, else the stored range as best it fits. */
function reanchor(model: Model, t: Thread): Range {
  const r = clampRange(model, t.range ?? {});
  const quote = t.quote ?? '';
  if (!quote || model.getValueInRange(toMonaco(r)) === quote) return r;
  const matches = model.findMatches(quote, false, false, true, null, false);
  if (!matches.length) return r;
  let best = matches[0];
  for (const m of matches) {
    if (Math.abs(m.range.startLineNumber - r.startLine) < Math.abs(best.range.startLineNumber - r.startLine)) best = m;
  }
  return fromMonaco(best.range);
}

/** Read where the decorations have moved the ranges to after an edit. */
function captureRanges() {
  const model = loadedModel;
  if (!model || model.isDisposed()) return;
  for (const t of threads) {
    const id = decoIds.get(t.id);
    const r = id ? model.getDecorationRange(id) : null;
    if (!r) continue;
    t.range = fromMonaco(r);
    // Deleting all of the text collapses the range; keep the old quote then.
    const q = model.getValueInRange(r);
    if (q) t.quote = q;
  }
  if (draft) {
    const id = decoIds.get(DRAFT);
    const r = id ? model.getDecorationRange(id) : null;
    if (r) draft.range = fromMonaco(r);
  }
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(syncAnchors, SYNC_DELAY_MS);
}

function syncAnchors() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  const changed = threads.filter((t) => savedAnchors.get(t.id) !== anchorKey(t));
  if (!changed.length) return;
  for (const t of changed) savedAnchors.set(t.id, anchorKey(t));
  void request('/review/anchors', { anchors: changed.map((t) => ({ id: t.id, range: t.range, quote: t.quote })) }).then((data) => {
    if (data.error) fail('Could not save comment positions', data.error);
  });
}

function applyDecorations() {
  const model = loadedModel;
  if (!model || model.isDisposed()) return;
  const keys: string[] = [];
  const items: Monaco.editor.IModelDeltaDecoration[] = [];
  const add = (key: string, range: Range, cls: string | null) => {
    keys.push(key);
    items.push({
      range: toMonaco(range),
      // Hidden (resolved) threads still get an invisible decoration so their range keeps tracking edits.
      options: cls
        ? { className: cls, linesDecorationsClassName: 'review-line-marker', stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
        : { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    });
  };
  for (const t of threads) {
    if (!isVisible(t)) add(t.id, t.range, null);
    else add(t.id, t.range, 'review-highlight' + (t.resolved ? ' resolved' : '') + (t.id === activeId ? ' active' : ''));
  }
  if (draft) add(DRAFT, draft.range, 'review-highlight active');
  const ids = model.deltaDecorations([...decoIds.values()], items);
  decoIds = new Map(keys.map((k, i) => [k, ids[i]]));
}

/** Take this file's decorations off its model (another file is being opened). */
function clearDecorations() {
  if (loadedModel && !loadedModel.isDisposed()) loadedModel.deltaDecorations([...decoIds.values()], []);
  decoIds = new Map();
}

// ---- loading --------------------------------------------------------------------------------

async function loadMe() {
  const data = await request<{ user?: Me }>('/review/me');
  if (data.user) me = data.user;
  renderIdentity();
}

/** Forget the previous project's threads and identity. */
export function resetReview() {
  me = null;
  void loadReviewForFile(null);
}

/** Load the threads of the file now in the editor (null clears the panel). */
async function loadReviewForFile(path: string | null) {
  // Save moves made in the file being left, while its ranges are still known.
  if (syncTimer) syncAnchors();
  hideTip();
  clearDecorations();
  const token = ++loadToken;
  threads = [];
  loadedFile = null;
  loadedModel = null;
  draft = null;
  activeId = null;
  savedAnchors = new Map();
  render();
  if (!path || !getState().project) return;
  if (!me) void loadMe();
  const data = await request<{ threads?: Thread[] }>('/review/threads?file=' + encodeURIComponent(path));
  if (token !== loadToken || currentPath() !== path) return;
  if (data.error) {
    fail('Could not load comments', data.error);
    return;
  }
  const model = editor?.getModel();
  if (!model) return;
  threads = data.threads ?? [];
  let moved = false;
  for (const t of threads) {
    savedAnchors.set(t.id, anchorKey(t));
    const r = reanchor(model, t);
    if (!sameRange(r, t.range)) {
      t.range = r;
      t.quote = model.getValueInRange(toMonaco(r)) || t.quote;
      moved = true;
    }
  }
  loadedFile = path;
  loadedModel = model;
  applyDecorations();
  render();
  if (moved) scheduleSync();
}

// ---- panel open / close ---------------------------------------------------------------------

/** Show or hide the Review view in the sidebar. */
export function setReviewPanelOpen(open: boolean) {
  const { sidebar } = getState();
  if (open) setState({ sidebar: 'review' });
  else if (sidebar === 'review') setState({ sidebar: 'files' });
}

/** The sidebar switched to or away from Review: a comment being written is dropped when it closes. */
function onPanelToggled(open: boolean) {
  if (!open && draft) {
    draft = null;
    applyDecorations();
  }
  // Opening: the panel's DOM appears on React's next render, and ReviewPanel calls render() when it mounts.
  if (!open) render();
}

export const toggleReviewPanel = () => setReviewPanelOpen(!isReviewPanelOpen());

export function setReviewShowResolved(on: boolean) {
  showResolved = on;
  if (activeId && !isVisible(threadById(activeId) ?? ({} as Thread))) activeId = null;
  captureRanges();
  applyDecorations();
  render();
}

// ---- rendering --------------------------------------------------------------------------------

function renderIdentity() {
  const who = document.getElementById('review-identity');
  if (!who) return;
  who.textContent = '';
  if (!me) return;
  who.classList.toggle('warn', !me.configured);
  if (me.configured) {
    who.append('Commenting as ');
    who.appendChild(el('strong', null, me.name));
  } else {
    who.textContent = 'No git user.name set — comments will be signed “Anonymous”. Run: git config --global user.name "Your Name"';
  }
}

function publishCount() {
  const open = threads.filter((t) => !t.resolved).length;
  if (getState().reviewCount !== open) setState({ reviewCount: open });
}

function renderMessage(t: Thread, m: Message, index: number) {
  const row = el('div', 'review-msg');
  const head = el('div', 'review-msg-head');
  const avatar = el('span', 'review-avatar', (m.author || '?').trim().charAt(0).toUpperCase() || '?');
  avatar.style.background = avatarColor(m.author || '?');
  avatar.setAttribute('aria-hidden', 'true');
  const name = el('span', 'review-author', m.author || 'Anonymous');
  if (m.email) name.title = m.email;
  const date = el('span', 'review-date', when(m.date));
  date.title = new Date(m.date).toLocaleString();
  head.append(avatar, name, date);
  if (index === 0) {
    const tools = el('span', 'review-card-tools');
    tools.appendChild(t.resolved ? iconButton('undo', 'reopen', 'Reopen') : iconButton('check', 'resolve', 'Resolve'));
    tools.appendChild(iconButton('trash', 'delete', 'Delete thread'));
    head.appendChild(tools);
  } else if (isMine(m)) {
    const del = iconButton('x', 'delete-msg', 'Delete reply');
    del.dataset.msg = m.id;
    del.classList.add('review-msg-delete');
    head.appendChild(del);
  }
  row.append(head, el('div', 'review-msg-text', m.text));
  return row;
}

function renderThread(t: Thread) {
  const card = el('div', 'review-card');
  card.dataset.id = t.id;
  if (t.id === activeId) card.classList.add('active');
  if (t.resolved) card.classList.add('resolved');
  if (t.quote) card.appendChild(el('div', 'review-quote', t.quote.replace(/\s+/g, ' ').trim()));
  (t.messages ?? []).forEach((m, i) => card.appendChild(renderMessage(t, m, i)));
  if (t.resolved) {
    card.appendChild(el('div', 'review-resolved-note', 'Resolved' + (t.resolvedBy ? ` by ${t.resolvedBy}` : '') + (t.resolvedAt ? ` · ${when(t.resolvedAt)}` : '')));
  } else {
    const reply = el('div', 'review-reply');
    const box = el('textarea', 'review-input');
    box.rows = 1;
    box.placeholder = 'Reply…  (Enter to send)';
    box.dataset.reviewInput = 'reply';
    reply.appendChild(box);
    card.appendChild(reply);
  }
  return card;
}

function renderDraft() {
  const card = el('div', 'review-card review-draft active');
  card.dataset.id = DRAFT;
  if (draft?.quote) card.appendChild(el('div', 'review-quote', draft.quote.replace(/\s+/g, ' ').trim()));
  const box = el('textarea', 'review-input');
  box.rows = 3;
  box.placeholder = 'Add your comment here';
  box.dataset.reviewInput = 'draft';
  const actions = el('div', 'review-draft-actions');
  const cancel = el('button', 'review-btn', 'Cancel');
  cancel.type = 'button';
  cancel.dataset.reviewAct = 'draft-cancel';
  const save = el('button', 'review-btn primary', 'Comment');
  save.type = 'button';
  save.dataset.reviewAct = 'draft-save';
  actions.append(cancel, save);
  card.append(box, actions);
  return card;
}

/** Redraw the cards (the panel calls this when it mounts). */
export function render() {
  publishCount();
  const cards = document.getElementById('review-cards');
  const empty = document.getElementById('review-empty');
  if (!cards || !isReviewPanelOpen()) return;
  renderIdentity();
  cards.querySelectorAll('.review-card').forEach((n) => n.remove());
  const visible = threads.filter(isVisible);
  for (const t of visible) cards.appendChild(renderThread(t));
  if (draft) cards.appendChild(renderDraft());
  if (empty) {
    let msg = '';
    if (!hasFile()) msg = 'Open a text file to see its comments.';
    else if (!visible.length && !draft) {
      const resolved = threads.length - visible.length;
      msg = `No comments${resolved ? ` (${resolved} resolved)` : ''}. Select some text and click “Add comment”, or press ${REVIEW_SHORTCUT}.`;
    }
    empty.textContent = msg;
    empty.classList.toggle('hidden', !msg);
  }
  layoutCards();
}

/**
 * Put each card level with its text, pushing overlapping cards apart. The
 * active card gets exactly its spot; the others make room above and below it.
 */
function layoutCards() {
  layoutFrame = 0;
  const cards = document.getElementById('review-cards');
  if (!editor || !cards || !isReviewPanelOpen()) return;
  const ed = editor;
  const offset = ed.getDomNode()!.getBoundingClientRect().top - cards.getBoundingClientRect().top;
  const scroll = ed.getScrollTop();
  const topOf = (line: number) => ed.getTopForLineNumber(line) - scroll + offset;

  const items = [...cards.querySelectorAll<HTMLElement>('.review-card')]
    .map((node) => {
      const id = node.dataset.id!;
      const range = id === DRAFT ? draft?.range : threadById(id)?.range;
      return { node, id, want: range ? topOf(range.startLine) : 0, h: node.offsetHeight, top: 0 };
    })
    .sort((a, b) => a.want - b.want);

  const focus = draft ? DRAFT : activeId;
  const ai = items.findIndex((i) => i.id === focus);
  if (ai < 0) {
    let bottom = -Infinity;
    for (const i of items) {
      i.top = Math.max(i.want, bottom + CARD_GAP);
      bottom = i.top + i.h;
    }
  } else {
    items[ai].top = items[ai].want;
    for (let k = ai + 1; k < items.length; k++) items[k].top = Math.max(items[k].want, items[k - 1].top + items[k - 1].h + CARD_GAP);
    for (let k = ai - 1; k >= 0; k--) items[k].top = Math.min(items[k].want, items[k + 1].top - items[k].h - CARD_GAP);
  }
  for (const i of items) i.node.style.transform = `translateY(${Math.round(i.top)}px)`;

  // "Add comment" follows the selection, like Overleaf's.
  const addBtn = document.getElementById('review-add');
  if (addBtn) {
    const sel = ed.getSelection();
    const show = hasFile() && !draft && !!sel && !sel.isEmpty();
    addBtn.classList.toggle('hidden', !show);
    if (show) addBtn.style.transform = `translateY(${Math.round(topOf(sel.startLineNumber))}px)`;
  }
}

function scheduleLayout() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(layoutCards);
}

// ---- actions ----------------------------------------------------------------------------------

function focusInput(selector: string) {
  // After React has put the panel on screen.
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(selector)?.focus());
}

export function startComment() {
  const model = editor?.getModel();
  if (!editor || !model || !hasFile()) {
    toast({ kind: 'info', title: 'Open a text file to add a comment' });
    return;
  }
  const sel = editor.getSelection();
  let range: Monaco.IRange | null = sel;
  if (!sel || sel.isEmpty()) {
    const line = sel ? sel.startLineNumber : 1;
    range = new monaco.Range(line, 1, line, model.getLineMaxColumn(line));
  }
  captureRanges();
  draft = { range: fromMonaco(range!), quote: model.getValueInRange(range!) };
  activeId = null;
  applyDecorations();
  if (isReviewPanelOpen()) render();
  else setReviewPanelOpen(true);
  focusInput('#review-cards [data-review-input="draft"]');
}

function activate(id: string | null, reveal: boolean) {
  if (id === activeId) return;
  activeId = id;
  captureRanges();
  applyDecorations();
  document.querySelectorAll<HTMLElement>('#review-cards .review-card').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
  const t = threadById(id);
  if (t && reveal) editor?.revealRangeInCenterIfOutsideViewport(toMonaco(t.range));
  scheduleLayout();
}

/** Open the panel (if needed) with this thread's card active beside its line. */
function showThread(id: string) {
  if (isReviewPanelOpen()) {
    activate(id, false);
    return;
  }
  activeId = id;
  captureRanges();
  applyDecorations();
  setReviewPanelOpen(true);
}

const threadAt = (pos: Monaco.IPosition) => threads.find((t) => isVisible(t) && toMonaco(t.range).containsPosition(pos)) ?? null;
const threadOnLine = (line: number) => threads.find((t) => isVisible(t) && line >= t.range.startLine && line <= t.range.endLine) ?? null;

// ---- hover tooltip ----------------------------------------------------------------------------
// Our own content widget rather than a Monaco hover, so it can be clicked.

interface Tip {
  node: HTMLElement;
  widget: Monaco.editor.IContentWidget;
  id: string | null;
  position: Monaco.IPosition | null;
}

let tip: Tip | null = null;
let tipHideTimer: ReturnType<typeof setTimeout> | undefined;

function ensureTip() {
  if (tip) return tip;
  const node = el('div', 'review-tip');
  node.setAttribute('role', 'button');
  node.tabIndex = -1;
  node.addEventListener('mouseenter', () => clearTimeout(tipHideTimer));
  node.addEventListener('mouseleave', scheduleHideTip);
  node.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor focus/selection
  node.addEventListener('click', () => {
    const id = tip?.id;
    hideTip();
    if (id && threadById(id)) showThread(id);
  });
  const t: Tip = {
    node,
    id: null,
    position: null,
    widget: {
      allowEditorOverflow: true,
      getId: () => 'gitlatex.review.tip',
      getDomNode: () => node,
      getPosition: () =>
        t.position && {
          position: t.position,
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW],
        },
    },
  };
  tip = t;
  return t;
}

function showTip(t: Thread, pos: Monaco.IPosition) {
  clearTimeout(tipHideTimer);
  if (!editor) return;
  const tp = ensureTip();
  if (tp.id === t.id) return; // already showing; don't chase the mouse
  const first = t.messages?.[0] ?? ({} as Message);
  const replies = (t.messages?.length ?? 1) - 1;
  tp.node.textContent = '';
  const head = el('div', 'review-tip-head');
  head.appendChild(el('span', 'review-author', first.author || 'Anonymous'));
  if (replies > 0) head.appendChild(el('span', 'review-date', `${replies} ${replies === 1 ? 'reply' : 'replies'}`));
  if (t.resolved) head.appendChild(el('span', 'review-date', 'resolved'));
  const text = (first.text || '').replace(/\s+/g, ' ');
  tp.node.append(head, el('div', 'review-tip-text', text.length > 120 ? text.slice(0, 120) + '…' : text), el('div', 'review-tip-hint', 'Click to open in the review panel'));
  const wasShown = tp.id !== null;
  tp.id = t.id;
  tp.position = { lineNumber: pos.lineNumber, column: pos.column };
  if (wasShown) editor.layoutContentWidget(tp.widget);
  else editor.addContentWidget(tp.widget);
}

function scheduleHideTip() {
  clearTimeout(tipHideTimer);
  if (tip?.id) tipHideTimer = setTimeout(hideTip, 300);
}

function hideTip() {
  clearTimeout(tipHideTimer);
  if (!tip?.id || !editor) return;
  editor.removeContentWidget(tip.widget);
  tip.id = null;
}

/** Take the server's copy of a thread, but keep the locally tracked range, which may be newer. */
function replaceThread(updated: Thread) {
  const i = threads.findIndex((t) => t.id === updated.id);
  if (i < 0) return;
  savedAnchors.set(updated.id, anchorKey(updated));
  updated.range = threads[i].range;
  updated.quote = threads[i].quote;
  threads[i] = updated;
  if (savedAnchors.get(updated.id) !== anchorKey(updated)) scheduleSync();
}

function removeThread(id: string) {
  threads = threads.filter((t) => t.id !== id);
  savedAnchors.delete(id);
  if (activeId === id) activeId = null;
}

function afterChange() {
  captureRanges();
  applyDecorations();
  render();
}

async function saveDraft(text: string) {
  if (!draft || !text.trim()) return;
  captureRanges();
  const file = loadedFile;
  const data = await request<{ thread: Thread }>('/review/threads', { file, range: draft.range, quote: draft.quote, text });
  if (data.error) return fail('Could not add the comment', data.error);
  if (file !== loadedFile) return;
  draft = null;
  threads.push(data.thread);
  savedAnchors.set(data.thread.id, anchorKey(data.thread));
  activeId = data.thread.id;
  afterChange();
}

async function sendReply(id: string, text: string) {
  if (!text.trim()) return;
  const data = await request<{ thread: Thread }>(`/review/threads/${id}/reply`, { text });
  if (data.error) return fail('Could not reply', data.error);
  captureRanges();
  replaceThread(data.thread);
  afterChange();
  focusInput(`#review-cards .review-card[data-id="${id}"] [data-review-input]`);
}

function confirmDelete(): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog({
      type: 'confirm',
      title: 'Delete comment thread?',
      message: 'This thread and all its replies will be deleted.',
      confirm: 'Delete',
      danger: true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

async function runAction(act: string, id: string | null, button?: HTMLElement) {
  if (act === 'draft-cancel') {
    draft = null;
    afterChange();
    return;
  }
  if (act === 'draft-save') {
    const box = document.querySelector<HTMLTextAreaElement>('#review-cards [data-review-input="draft"]');
    await saveDraft(box?.value ?? '');
    return;
  }
  if (!id) return;
  if (act === 'resolve' || act === 'reopen') {
    const data = await request<{ thread: Thread }>(`/review/threads/${id}/resolve`, { resolved: act === 'resolve' });
    if (data.error) return fail('Could not update the comment', data.error);
    captureRanges();
    replaceThread(data.thread);
    if (act === 'resolve' && !showResolved && activeId === id) activeId = null;
    afterChange();
  } else if (act === 'delete') {
    if (!(await confirmDelete())) return;
    const data = await request(`/review/threads/${id}/delete`, {});
    if (data.error) return fail('Could not delete the comment', data.error);
    captureRanges();
    removeThread(id);
    afterChange();
  } else if (act === 'delete-msg') {
    const data = await request<{ thread?: Thread }>(`/review/threads/${id}/messages/${button?.dataset.msg}/delete`, {});
    if (data.error) return fail('Could not delete the reply', data.error);
    captureRanges();
    if (data.thread) replaceThread(data.thread);
    else removeThread(id);
    afterChange();
  }
}

// ---- panel events (bound by ReviewPanel) ------------------------------------------------------

export function onCardsClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const card = target.closest<HTMLElement>('.review-card');
  const button = target.closest<HTMLElement>('[data-review-act]');
  if (button) {
    e.preventDefault();
    void runAction(button.dataset.reviewAct!, card && card.dataset.id !== DRAFT ? card.dataset.id! : null, button);
    return;
  }
  if (target.closest('#review-add')) {
    startComment();
    return;
  }
  if (card && card.dataset.id !== DRAFT) activate(card.dataset.id!, true);
}

export function onCardsKeydown(e: KeyboardEvent) {
  const box = (e.target as HTMLElement).closest<HTMLTextAreaElement>('[data-review-input]');
  if (!box) return;
  e.stopPropagation(); // keep app shortcuts (Ctrl+Enter compiles) out of the comment box
  if (e.key === 'Escape') {
    e.preventDefault();
    if (box.dataset.reviewInput === 'draft') void runAction('draft-cancel', null);
    else box.blur();
    editor?.focus();
    return;
  }
  // Enter sends, Shift+Enter is a new line, as in Overleaf.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (box.dataset.reviewInput === 'draft') void saveDraft(box.value);
    else {
      const card = box.closest<HTMLElement>('.review-card');
      if (card?.dataset.id) void sendReply(card.dataset.id, box.value);
    }
  }
}

/** Replies grow with their text instead of scrolling inside a tiny box. */
export function onCardsInput(e: Event) {
  const box = (e.target as HTMLElement).closest<HTMLTextAreaElement>('[data-review-input]');
  if (!box) return;
  box.style.height = 'auto';
  box.style.height = box.scrollHeight + 'px';
  scheduleLayout();
}

/** The cards are pinned to the text, so scrolling over them scrolls it. */
export function onCardsWheel(e: WheelEvent) {
  if ((e.target as HTMLElement).closest('textarea') || !editor) return;
  e.preventDefault();
  editor.setScrollTop(editor.getScrollTop() + e.deltaY);
}

// ---- editor hooks ----------------------------------------------------------------------------

export function installReview(ed: Editor): Monaco.IDisposable {
  editor = ed;
  const action = ed.addAction({
    id: 'gitlatex.review.addComment',
    label: 'Add Comment',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 3,
    run: startComment,
  });
  const subs = [
    action,
    // One model per file: when another file is opened, move the comments over.
    ed.onDidChangeModel(() => {
      const model = ed.getModel();
      void loadReviewForFile(model ? pathOf(model) : null);
    }),
    ed.onDidChangeModelContent(() => {
      if (!hasFile()) return;
      captureRanges();
      scheduleSync();
      scheduleLayout();
    }),
    ed.onDidScrollChange(scheduleLayout),
    ed.onDidLayoutChange(scheduleLayout),
    ed.onDidChangeCursorSelection((e) => {
      if (hasFile() && !draft && isReviewPanelOpen()) {
        const hit = threadAt(e.selection.getPosition());
        if (hit) activate(hit.id, false);
      }
      scheduleLayout();
    }),
    // Hovering commented text (or its margin marker) shows a tooltip; clicking it opens the thread.
    ed.onMouseMove((e) => {
      const pos = e.target.position;
      const T = monaco.editor.MouseTargetType;
      let hit: Thread | null = null;
      if (pos && hasFile() && !draft) {
        if (e.target.type === T.CONTENT_TEXT) hit = threadAt(pos);
        else if (e.target.type === T.GUTTER_LINE_DECORATIONS) hit = threadOnLine(pos.lineNumber);
      }
      if (hit && pos) showTip(hit, pos);
      else scheduleHideTip();
    }),
    ed.onMouseLeave(scheduleHideTip),
    ed.onKeyDown(hideTip),
  ];
  const unsubscribe = useStore.subscribe((s, prev) => {
    if ((s.sidebar === 'review') !== (prev.sidebar === 'review')) onPanelToggled(s.sidebar === 'review');
  });
  const model = ed.getModel();
  if (model) void loadReviewForFile(pathOf(model));
  return {
    dispose() {
      if (syncTimer) syncAnchors();
      for (const s of subs) s.dispose();
      unsubscribe();
      if (editor === ed) editor = null;
    },
  };
}

/** Called when the panel is resized or its DOM appears. */
export const relayoutReview = scheduleLayout;
