/**
 * Review panel: Overleaf-style comment threads on selected text.
 *
 * Select text (or put the cursor on a line) and use "Add Comment" from the
 * context menu, Ctrl/Cmd+Alt+M, or the button in the panel. Each thread is
 * signed with the project's git user.name and stored by the server under
 * .gitlatex/comments/, so it is committed and pushed with the project.
 *
 * Cards sit level with the text they are about and follow the editor as it
 * scrolls. Ranges are tracked with Monaco decorations while you type, and the
 * new positions are saved shortly after, so comments stay attached to their
 * text. When a file changed elsewhere (a pull), threads are re-found by the
 * text they quote.
 */

import { state } from "../core/state.js";
import { fetchJson } from "../core/api.js";
import { setConsole } from "../ui/consolepane.js";
import { showConfirmModal } from "../ui/modals.js";

const OPEN_KEY = "gitlatex-review-open";
const DRAFT = "draft";
const CARD_GAP = 8;
const SYNC_DELAY_MS = 1500;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const SHORTCUT = IS_MAC ? "⌘⌥M" : "Ctrl+Alt+M";

let threads = [];           // threads of `loadedFile`
let loadedFile = null;      // file the threads (and decorations) belong to
let loadToken = 0;
let decoIds = new Map();    // thread id (or DRAFT) -> Monaco decoration id
let savedAnchors = new Map(); // thread id -> anchor as the server has it
let draft = null;           // { range, quote } of a comment being written
let activeId = null;
let showResolved = false;
let me = null;
let syncTimer = null;
let layoutFrame = 0;

// ----- Small helpers -----

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name) {
  const i = el("span", "material-icons", name);
  i.setAttribute("aria-hidden", "true");
  return i;
}

function iconButton(name, act, title) {
  const b = el("button", "icon-btn review-icon-btn");
  b.type = "button";
  b.dataset.reviewAct = act;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.appendChild(icon(name));
  return b;
}

function toMonaco(r) {
  return new state.monacoApi.Range(r.startLine, r.startColumn, r.endLine, r.endColumn);
}

function fromMonaco(r) {
  return {
    startLine: r.startLineNumber, startColumn: r.startColumn,
    endLine: r.endLineNumber, endColumn: r.endColumn,
  };
}

function sameRange(a, b) {
  return !!a && !!b && a.startLine === b.startLine && a.startColumn === b.startColumn &&
    a.endLine === b.endLine && a.endColumn === b.endColumn;
}

function anchorKey(t) {
  return JSON.stringify([t.range, t.quote || ""]);
}

function threadById(id) {
  return threads.find(t => t.id === id) || null;
}

function isVisible(t) {
  return showResolved || !t.resolved;
}

function hasFile() {
  return !!loadedFile && loadedFile === state.currentFile;
}

function isMine(msg) {
  return !!me && msg.author === me.name && (msg.email || "") === (me.email || "");
}

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return "hsl(" + h + ", 50%, 42%)";
}

function when(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
}

async function post(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

// ----- Anchors: finding, tracking and saving ranges -----

function clampRange(model, r) {
  const lines = model.getLineCount();
  const sl = Math.min(Math.max(1, r.startLine || 1), lines);
  const el_ = Math.min(Math.max(sl, r.endLine || sl), lines);
  const sc = Math.min(Math.max(1, r.startColumn || 1), model.getLineMaxColumn(sl));
  let ec = Math.min(Math.max(1, r.endColumn || 1), model.getLineMaxColumn(el_));
  if (el_ === sl && ec < sc) ec = sc;
  return { startLine: sl, startColumn: sc, endLine: el_, endColumn: ec };
}

// The stored range if it still holds the quoted text, otherwise the nearest
// place that does, otherwise the stored range as best it fits.
function reanchor(model, t) {
  const r = clampRange(model, t.range || {});
  const quote = t.quote || "";
  if (!quote || model.getValueInRange(toMonaco(r)) === quote) return r;
  const matches = model.findMatches(quote, false, false, true, null, false);
  if (!matches.length) return r;
  let best = matches[0];
  matches.forEach(function (m) {
    if (Math.abs(m.range.startLineNumber - r.startLine) <
        Math.abs(best.range.startLineNumber - r.startLine)) best = m;
  });
  return fromMonaco(best.range);
}

// Read where the decorations have moved the ranges to after an edit.
function captureRanges() {
  const model = state.editor && state.editor.getModel();
  if (!model) return;
  threads.forEach(function (t) {
    const id = decoIds.get(t.id);
    const r = id && model.getDecorationRange(id);
    if (!r) return;
    t.range = fromMonaco(r);
    // Deleting all of the text collapses the range; keep the old quote then.
    const q = model.getValueInRange(r);
    if (q) t.quote = q;
  });
  if (draft) {
    const id = decoIds.get(DRAFT);
    const r = id && model.getDecorationRange(id);
    if (r) draft.range = fromMonaco(r);
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncAnchors, SYNC_DELAY_MS);
}

function syncAnchors() {
  clearTimeout(syncTimer);
  syncTimer = null;
  const changed = threads.filter(t => savedAnchors.get(t.id) !== anchorKey(t));
  if (!changed.length) return;
  changed.forEach(t => savedAnchors.set(t.id, anchorKey(t)));
  post("/review/anchors", {
    anchors: changed.map(t => ({ id: t.id, range: t.range, quote: t.quote })),
  }).then(function (data) {
    if (data.error) setConsole("Could not save comment positions: " + data.error);
  });
}

function applyDecorations() {
  const editor = state.editor;
  const model = editor && editor.getModel();
  if (!model || !state.monacoApi) return;
  const keys = [];
  const items = [];
  function add(key, range, cls) {
    keys.push(key);
    items.push({
      range: toMonaco(range),
      // Hidden (resolved) threads still get an invisible decoration so their
      // range keeps tracking edits.
      options: cls ? {
        className: cls,
        linesDecorationsClassName: "review-line-marker",
        stickiness: 1, // NeverGrowsWhenTypingAtEdges
      } : { stickiness: 1 },
    });
  }
  threads.forEach(function (t) {
    if (!isVisible(t)) add(t.id, t.range, null);
    else add(t.id, t.range, "review-highlight" +
      (t.resolved ? " resolved" : "") + (t.id === activeId ? " active" : ""));
  });
  if (draft) add(DRAFT, draft.range, "review-highlight active");
  const ids = model.deltaDecorations(Array.from(decoIds.values()), items);
  decoIds = new Map();
  keys.forEach((k, i) => decoIds.set(k, ids[i]));
}

// ----- Loading -----

async function loadMe() {
  const data = await fetchJson("/review/me");
  if (data && data.user) me = data.user;
  renderIdentity();
}

/** Forget the previous project's threads and identity. */
export function resetReview() {
  me = null;
  loadReviewForFile(null);
}

/** Load the threads of the file now in the editor (null clears the panel). */
export async function loadReviewForFile(path) {
  // Save moves made in the file being left, while its ranges are still known.
  if (syncTimer) syncAnchors();
  hideTip();
  const token = ++loadToken;
  threads = [];
  loadedFile = null;
  draft = null;
  activeId = null;
  savedAnchors = new Map();
  applyDecorations();
  render();
  if (!path || !state.currentRepo) return;
  if (!me) loadMe();
  const data = await fetchJson("/review/threads?file=" + encodeURIComponent(path));
  if (token !== loadToken || state.currentFile !== path) return;
  if (data.error) {
    setConsole("Could not load comments: " + data.error);
    return;
  }
  const model = state.editor && state.editor.getModel();
  if (!model) return;
  threads = data.threads || [];
  let moved = false;
  threads.forEach(function (t) {
    savedAnchors.set(t.id, anchorKey(t));
    const r = reanchor(model, t);
    if (!sameRange(r, t.range)) {
      t.range = r;
      t.quote = model.getValueInRange(toMonaco(r)) || t.quote;
      moved = true;
    }
  });
  loadedFile = path;
  applyDecorations();
  render();
  if (moved) scheduleSync();
}

// ----- Panel open / close -----

export function isReviewPanelOpen() {
  const pane = document.getElementById("editor-pane");
  return !!pane && pane.classList.contains("review-open");
}

export function openReviewPanel() {
  setPanelOpen(true);
}

export function closeReviewPanel() {
  setPanelOpen(false);
}

export function toggleReviewPanel() {
  setPanelOpen(!isReviewPanelOpen());
}

function setPanelOpen(open) {
  const pane = document.getElementById("editor-pane");
  const panel = document.getElementById("review-panel");
  const btn = document.getElementById("btn-review");
  if (!pane || !panel) return;
  pane.classList.toggle("review-open", open);
  panel.classList.toggle("hidden", !open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  if (btn) {
    btn.classList.toggle("active", open);
    btn.setAttribute("aria-pressed", open ? "true" : "false");
  }
  try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (_) {}
  if (!open && draft) {
    draft = null;
    applyDecorations();
  }
  render();
}

export function setReviewShowResolved(on) {
  showResolved = !!on;
  if (activeId && !isVisible(threadById(activeId) || {})) activeId = null;
  captureRanges();
  applyDecorations();
  render();
}

// ----- Rendering -----

function renderIdentity() {
  const who = document.getElementById("review-identity");
  if (!who) return;
  who.textContent = "";
  if (!me) return;
  who.classList.toggle("warn", !me.configured);
  if (me.configured) {
    who.append("Commenting as ");
    who.appendChild(el("strong", null, me.name));
  } else {
    who.textContent = "No git user.name set — comments will be signed “Anonymous”. " +
      "Run: git config --global user.name \"Your Name\"";
  }
}

function renderBadge() {
  const badge = document.getElementById("review-badge");
  if (!badge) return;
  const open = threads.filter(t => !t.resolved).length;
  badge.textContent = String(open);
  badge.classList.toggle("hidden", open === 0);
}

function renderMessage(t, m, index) {
  const row = el("div", "review-msg");
  const head = el("div", "review-msg-head");
  const avatar = el("span", "review-avatar", (m.author || "?").trim().charAt(0).toUpperCase() || "?");
  avatar.style.background = avatarColor(m.author || "?");
  avatar.setAttribute("aria-hidden", "true");
  const name = el("span", "review-author", m.author || "Anonymous");
  if (m.email) name.title = m.email;
  const date = el("span", "review-date", when(m.date));
  date.title = new Date(m.date).toLocaleString();
  head.append(avatar, name, date);
  if (index === 0) {
    const actions = el("span", "review-card-tools");
    actions.appendChild(t.resolved
      ? iconButton("undo", "reopen", "Reopen")
      : iconButton("check", "resolve", "Resolve"));
    actions.appendChild(iconButton("delete_outline", "delete", "Delete thread"));
    head.appendChild(actions);
  } else if (isMine(m)) {
    const del = iconButton("close", "delete-msg", "Delete reply");
    del.dataset.msg = m.id;
    del.classList.add("review-msg-delete");
    head.appendChild(del);
  }
  row.append(head, el("div", "review-msg-text", m.text));
  return row;
}

function renderThread(t) {
  const card = el("div", "review-card");
  card.dataset.id = t.id;
  if (t.id === activeId) card.classList.add("active");
  if (t.resolved) card.classList.add("resolved");
  if (t.quote) card.appendChild(el("div", "review-quote", t.quote.replace(/\s+/g, " ").trim()));
  (t.messages || []).forEach((m, i) => card.appendChild(renderMessage(t, m, i)));
  if (t.resolved) {
    card.appendChild(el("div", "review-resolved-note",
      "Resolved" + (t.resolvedBy ? " by " + t.resolvedBy : "") +
      (t.resolvedAt ? " · " + when(t.resolvedAt) : "")));
  } else {
    const reply = el("div", "review-reply");
    const box = el("textarea", "review-input");
    box.rows = 1;
    box.placeholder = "Reply…  (Enter to send)";
    box.dataset.reviewInput = "reply";
    reply.appendChild(box);
    card.appendChild(reply);
  }
  return card;
}

function renderDraft() {
  const card = el("div", "review-card review-draft active");
  card.dataset.id = DRAFT;
  if (draft.quote) card.appendChild(el("div", "review-quote", draft.quote.replace(/\s+/g, " ").trim()));
  const box = el("textarea", "review-input");
  box.rows = 3;
  box.placeholder = "Add your comment here";
  box.dataset.reviewInput = "draft";
  const actions = el("div", "review-draft-actions");
  const cancel = el("button", "btn-toolbar", "Cancel");
  cancel.type = "button";
  cancel.dataset.reviewAct = "draft-cancel";
  const save = el("button", "btn-toolbar primary", "Comment");
  save.type = "button";
  save.dataset.reviewAct = "draft-save";
  actions.append(cancel, save);
  card.append(box, actions);
  return card;
}

function render() {
  renderBadge();
  const cards = document.getElementById("review-cards");
  const empty = document.getElementById("review-empty");
  if (!cards || !isReviewPanelOpen()) return;
  cards.querySelectorAll(".review-card").forEach(n => n.remove());
  const visible = threads.filter(isVisible);
  visible.forEach(t => cards.appendChild(renderThread(t)));
  if (draft) cards.appendChild(renderDraft());
  if (empty) {
    let msg = "";
    if (!hasFile()) msg = "Open a text file to see its comments.";
    else if (!visible.length && !draft) {
      const resolved = threads.length - visible.length;
      msg = "No comments" + (resolved ? " (" + resolved + " resolved)" : "") +
        ". Select some text and click “Add comment”, or press " + SHORTCUT + ".";
    }
    empty.textContent = msg;
    empty.classList.toggle("hidden", !msg);
  }
  layoutCards();
}

// Put each card level with its text, pushing overlapping cards apart. The
// active card gets exactly its spot; the others make room above and below it.
function layoutCards() {
  layoutFrame = 0;
  const editor = state.editor;
  const cards = document.getElementById("review-cards");
  if (!editor || !cards || !isReviewPanelOpen()) return;
  const offset = editor.getDomNode().getBoundingClientRect().top - cards.getBoundingClientRect().top;
  const scroll = editor.getScrollTop();
  const topOf = line => editor.getTopForLineNumber(line) - scroll + offset;

  const items = Array.from(cards.querySelectorAll(".review-card")).map(function (node) {
    const id = node.dataset.id;
    const range = id === DRAFT ? draft && draft.range : (threadById(id) || {}).range;
    return { node, id, want: range ? topOf(range.startLine) : 0, h: node.offsetHeight };
  }).sort((a, b) => a.want - b.want);

  const focus = draft ? DRAFT : activeId;
  const ai = items.findIndex(i => i.id === focus);
  if (ai < 0) {
    let bottom = -Infinity;
    items.forEach(function (i) {
      i.top = Math.max(i.want, bottom + CARD_GAP);
      bottom = i.top + i.h;
    });
  } else {
    items[ai].top = items[ai].want;
    for (let k = ai + 1; k < items.length; k++) {
      items[k].top = Math.max(items[k].want, items[k - 1].top + items[k - 1].h + CARD_GAP);
    }
    for (let k = ai - 1; k >= 0; k--) {
      items[k].top = Math.min(items[k].want, items[k + 1].top - items[k].h - CARD_GAP);
    }
  }
  items.forEach(i => { i.node.style.transform = "translateY(" + Math.round(i.top) + "px)"; });

  // "Add comment" follows the selection, like Overleaf's.
  const addBtn = document.getElementById("review-add");
  if (addBtn) {
    const sel = editor.getSelection();
    const show = hasFile() && !draft && sel && !sel.isEmpty();
    addBtn.classList.toggle("hidden", !show);
    if (show) addBtn.style.transform = "translateY(" + Math.round(topOf(sel.startLineNumber)) + "px)";
  }
}

function scheduleLayout() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(layoutCards);
}

// ----- Actions -----

export function startComment() {
  const editor = state.editor;
  const model = editor && editor.getModel();
  if (!model || !hasFile()) {
    setConsole("Open a text file to add a comment.");
    return;
  }
  const sel = editor.getSelection();
  let range = sel;
  if (!sel || sel.isEmpty()) {
    const line = sel ? sel.startLineNumber : 1;
    range = new state.monacoApi.Range(line, 1, line, model.getLineMaxColumn(line));
  }
  captureRanges();
  draft = { range: fromMonaco(range), quote: model.getValueInRange(range) };
  activeId = null;
  applyDecorations();
  if (isReviewPanelOpen()) render();
  else openReviewPanel();
  const box = document.querySelector('#review-cards [data-review-input="draft"]');
  if (box) box.focus();
}

function activate(id, reveal) {
  if (id === activeId) return;
  activeId = id;
  captureRanges();
  applyDecorations();
  document.querySelectorAll("#review-cards .review-card").forEach(function (c) {
    c.classList.toggle("active", c.dataset.id === id);
  });
  const t = id && threadById(id);
  if (t && reveal && state.editor) {
    state.editor.revealRangeInCenterIfOutsideViewport(toMonaco(t.range));
  }
  scheduleLayout();
}

// Open the panel (if needed) with this thread's card active beside its line.
function showThread(id) {
  if (isReviewPanelOpen()) {
    activate(id, false);
    return;
  }
  activeId = id;
  captureRanges();
  applyDecorations();
  openReviewPanel();
}

function threadAt(pos) {
  return threads.find(t => isVisible(t) && toMonaco(t.range).containsPosition(pos)) || null;
}

function threadOnLine(line) {
  return threads.find(t => isVisible(t) && line >= t.range.startLine && line <= t.range.endLine) || null;
}

// ----- Hover tooltip -----
// Our own content widget rather than a Monaco hoverMessage, so it can be
// clicked (Monaco's hover only offers text selection and a copy button).

let tip = null;          // { node, widget, id }
let tipHideTimer = null;

function ensureTip() {
  if (tip) return tip;
  const node = el("div", "review-tip");
  node.setAttribute("role", "button");
  node.tabIndex = -1;
  node.addEventListener("mouseenter", () => clearTimeout(tipHideTimer));
  node.addEventListener("mouseleave", scheduleHideTip);
  node.addEventListener("mousedown", e => e.preventDefault()); // keep editor focus/selection
  node.addEventListener("click", function () {
    const id = tip && tip.id;
    hideTip();
    if (id && threadById(id)) showThread(id);
  });
  tip = { node, id: null, position: null };
  tip.widget = {
    allowEditorOverflow: true,
    getId: () => "gitlatex.review.tip",
    getDomNode: () => node,
    getPosition: () => tip.position && {
      position: tip.position,
      preference: [
        state.monacoApi.editor.ContentWidgetPositionPreference.ABOVE,
        state.monacoApi.editor.ContentWidgetPositionPreference.BELOW,
      ],
    },
  };
  return tip;
}

function showTip(t, pos) {
  clearTimeout(tipHideTimer);
  const editor = state.editor;
  if (!editor) return;
  const tp = ensureTip();
  if (tp.id === t.id) return; // already showing; don't chase the mouse
  const first = (t.messages || [])[0] || {};
  const replies = (t.messages || []).length - 1;
  tp.node.textContent = "";
  const head = el("div", "review-tip-head");
  head.appendChild(el("span", "review-author", first.author || "Anonymous"));
  if (replies > 0) head.appendChild(el("span", "review-date", replies + (replies === 1 ? " reply" : " replies")));
  if (t.resolved) head.appendChild(el("span", "review-date", "resolved"));
  const text = (first.text || "").replace(/\s+/g, " ");
  tp.node.append(
    head,
    el("div", "review-tip-text", text.length > 120 ? text.slice(0, 120) + "…" : text),
    el("div", "review-tip-hint", "Click to open in review panel"),
  );
  const wasShown = tp.id !== null;
  tp.id = t.id;
  tp.position = { lineNumber: pos.lineNumber, column: pos.column };
  if (wasShown) editor.layoutContentWidget(tp.widget);
  else editor.addContentWidget(tp.widget);
}

function scheduleHideTip() {
  clearTimeout(tipHideTimer);
  if (tip && tip.id) tipHideTimer = setTimeout(hideTip, 300);
}

function hideTip() {
  clearTimeout(tipHideTimer);
  if (!tip || !tip.id || !state.editor) return;
  state.editor.removeContentWidget(tip.widget);
  tip.id = null;
}

// Take the server's copy of a thread but keep the range tracked locally,
// which may be newer than what has been saved.
function replaceThread(updated) {
  const i = threads.findIndex(t => t.id === updated.id);
  if (i < 0) return;
  savedAnchors.set(updated.id, anchorKey(updated));
  updated.range = threads[i].range;
  updated.quote = threads[i].quote;
  threads[i] = updated;
  if (savedAnchors.get(updated.id) !== anchorKey(updated)) scheduleSync();
}

function removeThread(id) {
  threads = threads.filter(t => t.id !== id);
  savedAnchors.delete(id);
  if (activeId === id) activeId = null;
}

function afterChange() {
  captureRanges();
  applyDecorations();
  render();
}

async function saveDraft(text) {
  if (!draft || !text.trim()) return;
  captureRanges();
  const file = loadedFile;
  const data = await post("/review/threads", {
    file, range: draft.range, quote: draft.quote, text,
  });
  if (data.error) {
    setConsole("Could not add comment: " + data.error);
    return;
  }
  if (file !== loadedFile) return;
  draft = null;
  threads.push(data.thread);
  savedAnchors.set(data.thread.id, anchorKey(data.thread));
  activeId = data.thread.id;
  afterChange();
}

async function sendReply(id, text) {
  if (!text.trim()) return;
  const data = await post("/review/threads/" + id + "/reply", { text });
  if (data.error) {
    setConsole("Could not reply: " + data.error);
    return;
  }
  captureRanges();
  replaceThread(data.thread);
  afterChange();
  const box = document.querySelector('#review-cards .review-card[data-id="' + id + '"] [data-review-input]');
  if (box) box.focus();
}

async function runAction(act, id, button) {
  if (act === "draft-cancel") {
    draft = null;
    afterChange();
    return;
  }
  if (act === "draft-save") {
    const box = document.querySelector('#review-cards [data-review-input="draft"]');
    await saveDraft(box ? box.value : "");
    return;
  }
  if (!id) return;
  if (act === "resolve" || act === "reopen") {
    const data = await post("/review/threads/" + id + "/resolve", { resolved: act === "resolve" });
    if (data.error) return setConsole("Could not update comment: " + data.error);
    captureRanges();
    replaceThread(data.thread);
    if (act === "resolve" && !showResolved && activeId === id) activeId = null;
    afterChange();
  } else if (act === "delete") {
    const ok = await showConfirmModal({ message: "Delete this comment thread and all its replies?", confirmLabel: "Delete" });
    if (!ok) return;
    const data = await post("/review/threads/" + id + "/delete");
    if (data.error) return setConsole("Could not delete comment: " + data.error);
    captureRanges();
    removeThread(id);
    afterChange();
  } else if (act === "delete-msg") {
    const data = await post("/review/threads/" + id + "/messages/" + button.dataset.msg + "/delete");
    if (data.error) return setConsole("Could not delete reply: " + data.error);
    captureRanges();
    if (data.thread) replaceThread(data.thread);
    else removeThread(id);
    afterChange();
  }
}

function onCardsClick(e) {
  const card = e.target.closest(".review-card");
  const button = e.target.closest("[data-review-act]");
  if (button) {
    e.preventDefault();
    runAction(button.dataset.reviewAct, card && card.dataset.id !== DRAFT ? card.dataset.id : null, button);
    return;
  }
  if (e.target.closest("#review-add")) {
    startComment();
    return;
  }
  if (card && card.dataset.id !== DRAFT) activate(card.dataset.id, true);
}

function onCardsKeydown(e) {
  const box = e.target.closest("[data-review-input]");
  if (!box) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (box.dataset.reviewInput === "draft") runAction("draft-cancel");
    else box.blur();
    state.editor && state.editor.focus();
    return;
  }
  // Enter sends, Shift+Enter is a new line - as in Overleaf.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (box.dataset.reviewInput === "draft") saveDraft(box.value);
    else {
      const card = box.closest(".review-card");
      if (card) sendReply(card.dataset.id, box.value);
    }
  }
}

// Replies grow with their text instead of scrolling inside a tiny box.
function onCardsInput(e) {
  const box = e.target.closest("[data-review-input]");
  if (!box) return;
  box.style.height = "auto";
  box.style.height = box.scrollHeight + "px";
  scheduleLayout();
}

// ----- Editor hooks -----

export function registerReview(monaco, editor) {
  editor.addAction({
    id: "gitlatex.review.addComment",
    label: "Add Comment",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM],
    contextMenuGroupId: "navigation",
    contextMenuOrder: 3,
    run: startComment,
  });

  editor.onDidChangeModelContent(function (e) {
    // isFlush is a whole-document setValue (opening another file), which
    // wipes the decorations - loadReviewForFile sets them up again.
    if (e.isFlush || !hasFile()) return;
    captureRanges();
    scheduleSync();
    scheduleLayout();
  });
  editor.onDidScrollChange(scheduleLayout);
  editor.onDidLayoutChange(scheduleLayout);
  editor.onDidChangeCursorSelection(function (e) {
    if (hasFile() && !draft && isReviewPanelOpen()) {
      const hit = threadAt(e.selection.getPosition());
      if (hit) activate(hit.id, false);
    }
    scheduleLayout();
  });
  // Hovering commented text (or its margin marker) shows a small tooltip;
  // clicking the tooltip opens the thread in the review panel.
  editor.onMouseMove(function (e) {
    const pos = e.target && e.target.position;
    const T = monaco.editor.MouseTargetType;
    let hit = null;
    if (pos && hasFile() && !draft) {
      if (e.target.type === T.CONTENT_TEXT) hit = threadAt(pos);
      else if (e.target.type === T.GUTTER_LINE_DECORATIONS) hit = threadOnLine(pos.lineNumber);
    }
    if (hit) showTip(hit, pos);
    else scheduleHideTip();
  });
  editor.onMouseLeave(scheduleHideTip);
  editor.onKeyDown(hideTip);

  const cards = document.getElementById("review-cards");
  if (cards) {
    cards.addEventListener("click", onCardsClick);
    cards.addEventListener("keydown", onCardsKeydown);
    cards.addEventListener("input", onCardsInput);
    // The cards are pinned to the text, so scrolling over them scrolls it.
    cards.addEventListener("wheel", function (e) {
      if (e.target.closest("textarea")) return;
      e.preventDefault();
      editor.setScrollTop(editor.getScrollTop() + e.deltaY);
    }, { passive: false });
  }
  const addBtn = document.getElementById("review-add");
  if (addBtn) addBtn.title = "Add comment (" + SHORTCUT + ")";

  let wasOpen = false;
  try { wasOpen = localStorage.getItem(OPEN_KEY) === "1"; } catch (_) {}
  if (wasOpen) openReviewPanel();
}
