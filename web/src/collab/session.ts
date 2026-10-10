/**
 * Live collaboration (optional, per project).
 *
 * When a project has it switched on, its text files are mirrored into a Yjs
 * document held by a GitLaTeX relay (a Cloudflare Worker, in the separate
 * repository github.com/abdussamiakanda/gitlatex-collab).
 * Everyone in the same room edits the same text; each person's GitLaTeX still
 * writes the files to their own disk, so commits, pushes and compiles stay
 * local.
 *
 * Open files are bound to the shared text through their Monaco models
 * (TextBinding); files without a model are synced through the Workspace.
 * While a session is live, the room is the source of truth: on joining,
 * files that differ locally are replaced by the room's version, and files
 * only one side has are added to the other.
 */
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { monaco } from '../editor/monaco';
import { disposeModel, openModels, watchModels } from '../editor/models';
import { BUILD_OUTPUT, KEEP, type Workspace } from '../state/workspace';
import { setState, toast } from '../state/store';
import { basename } from '../utils/paths';
import { LOCAL, TextBinding, replaceText } from './binding';
import { BROWSER_ID, livePeers, type PeerState } from './peers';
import { removeAwarenessStates } from 'y-protocols/awareness';
import { baseKey, loadBase, saveBase, type Base } from './base';
import { applyText, mergeText } from './merge';
import { splitHost, type CollabConfig, type CollabUser } from './config';

export type CollabStatus = 'connecting' | 'connected' | 'offline';

export interface CollabPeer {
  id: number;
  name: string;
  color: string;
  /** The file they are looking at. */
  path: string | null;
}

export interface CollabState {
  status: CollabStatus;
  room: string;
  host: string;
  /** You, as others see you. */
  me: { name: string; color: string };
  /** Everyone else in the room right now. */
  peers: CollabPeer[];
}

/** Text files that are shared: not build output, not folder placeholders. */
function isShared(path: string) {
  return basename(path) !== KEEP && !BUILD_OUTPUT.test(path) && !path.startsWith('.git/');
}

const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

class Session {
  readonly doc = new Y.Doc();
  readonly files = this.doc.getMap<Y.Text>('files');
  readonly provider: YProvider;
  private readonly bindings = new Map<string, TextBinding>();
  private readonly cleanup: (() => void)[] = [];
  private ready = false;
  private destroyed = false;
  private readonly baseKey: string;
  /** The room's text as of the last time this browser was in sync with it. */
  private readonly base: Promise<Base | null>;
  /** Set while remote changes are written into the Workspace, so they are not echoed back. */
  private applyingRemote = false;
  private failures = 0;
  private warned = false;
  private state: CollabState;

  constructor(
    readonly ws: Workspace,
    readonly config: CollabConfig,
    user: CollabUser,
  ) {
    const { host, secure } = splitHost(config.host);
    const me = { name: cleanName(user.name) || 'Anonymous', color: SAFE_COLOR.test(user.color) ? user.color : '#4f8cff' };
    this.state = { status: 'connecting', room: config.room, host, me, peers: [] };
    this.baseKey = baseKey(host, config.room);
    this.base = loadBase(this.baseKey);
    this.provider = new YProvider(host, config.room, this.doc, {
      party: 'collab',
      params: { token: config.token },
      protocol: secure ? 'wss' : 'ws',
    });
    const awareness = this.provider.awareness;
    awareness.setLocalStateField('user', { ...me, sid: BROWSER_ID });

    // Say goodbye when the page goes away (reload, close, navigate). The provider only
    // listens for "unload", which browsers often skip; without this the old presence
    // lingers on the relay and you show up twice after a reload.
    const onPageHide = () => removeAwarenessStates(awareness, [this.doc.clientID], 'page hidden');
    const onPageShow = (e: PageTransitionEvent) => {
      // Back from the back/forward cache: be present again.
      if (e.persisted) {
        awareness.setLocalStateField('user', { ...this.state.me, sid: BROWSER_ID });
        publishCursor();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    this.cleanup.push(() => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    });

    const onStatus = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      if (status === 'connected') {
        this.failures = 0;
        this.warned = false;
      }
      this.patch({ status: status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline' });
    };
    const onError = () => {
      this.failures++;
      if (this.failures >= 3 && !this.warned) {
        this.warned = true;
        toast({
          kind: 'warning',
          title: 'Cannot reach the collaboration server',
          message: `If the room's token changed or the room was deleted, ask its owner for a new invite. Still retrying room “${config.room}”; your edits are kept locally.`,
          timeout: 0,
        });
      }
    };
    const onSync = (synced: boolean) => {
      if (!synced) return;
      if (this.ready) this.saveBaseSoon();
      else
        void this.base.then((base) => {
          if (!this.destroyed && !this.ready) this.join(base);
        });
    };
    // Keep the base current while in sync (local and remote edits alike).
    const onUpdate = () => {
      if (this.ready) this.saveBaseSoon();
    };
    this.doc.on('update', onUpdate);
    this.provider.on('status', onStatus);
    this.provider.on('connection-error', onError);
    this.provider.on('sync', onSync);
    awareness.on('change', this.onAwareness);
    this.cleanup.push(() => {
      this.provider.off('status', onStatus);
      this.provider.off('connection-error', onError);
      this.provider.off('sync', onSync);
      this.doc.off('update', onUpdate);
      awareness.off('change', this.onAwareness);
    });
    this.publish();
  }

  destroy() {
    // Stopping (or closing the project) records where we left off, so a later rejoin merges.
    this.saveBaseNow();
    this.destroyed = true;
    for (const c of this.cleanup.splice(0)) c();
    for (const b of this.bindings.values()) b.dispose();
    this.bindings.clear();
    this.provider.awareness.setLocalState(null);
    this.provider.destroy();
    this.doc.destroy();
    peerStyles.textContent = '';
  }

  // ---- joining ---------------------------------------------------------------

  /**
   * First sync with the room. With no history for this room in this browser
   * (a first join), the room wins: files that differ take the room's text, and
   * files only one side has are added to the other. When you have been in the
   * room before, each file is merged three ways against the text as it was when
   * you were last in sync, so work done while not live is kept, and so are
   * other people's edits made meanwhile. Where both changed the same lines,
   * the room's version is kept.
   */
  private join(base: Base | null) {
    const ws = this.ws;
    const writes = new Map<string, string>();
    const deleteHere = new Set<string>();
    const merged: string[] = [];
    const clashes: string[] = [];
    let fromRoom = 0;
    let added = 0;

    this.doc.transact(() => {
      const here = new Set<string>();
      for (const { path, text: mine } of ws.textFiles()) {
        if (!isShared(path)) continue;
        here.add(path);
        const ytext = this.files.get(path);
        const was = base?.[path];
        if (!ytext) {
          // Shared before, gone from the room, untouched here since: someone deleted it.
          if (was !== undefined && mine === was) deleteHere.add(path);
          else this.files.set(path, new Y.Text(mine));
          continue;
        }
        const theirs = ytext.toString();
        if (theirs === mine) continue;
        if (was === undefined) {
          writes.set(path, theirs);
          fromRoom++;
          continue;
        }
        const m = mergeText(was, mine, theirs);
        if (m.text !== theirs) applyText(ytext, m.text);
        if (m.text !== mine) writes.set(path, m.text);
        if (m.clash) clashes.push(path);
        if (m.text === theirs) fromRoom++;
        else if (m.text !== mine) merged.push(path);
      }
      const gone: string[] = [];
      this.files.forEach((ytext, path) => {
        if (here.has(path)) return;
        const local = ws.get(path);
        if (local && local.kind !== 'text') return;
        const theirs = ytext.toString();
        // Shared before, deleted here since, unchanged in the room: the deletion stands.
        if (base?.[path] !== undefined && base[path] === theirs) gone.push(path);
        else {
          writes.set(path, theirs);
          added++;
        }
      });
      for (const path of gone) this.files.delete(path);
    }, LOCAL);

    for (const [path, text] of writes) this.applyRemote(path, text);
    if (deleteHere.size) this.applyRemoteDeletes(deleteHere);
    for (const [path, model] of openModels()) this.bind(path, model);

    this.cleanup.push(watchModels((path, model) => (model ? this.bind(path, model) : this.unbind(path))));
    this.cleanup.push(ws.subscribe(this.onLocalChange));
    this.files.observeDeep(this.onRemoteChange);
    this.cleanup.push(() => this.files.unobserveDeep(this.onRemoteChange));
    this.ready = true;
    this.saveBaseSoon();

    const room = this.config.room;
    if (clashes.length) {
      toast({
        kind: 'warning',
        title: `Joined “${room}”`,
        message: `You and others changed the same lines while you were away in ${clashes.join(', ')}. There the room’s version was kept; the rest of your changes were merged in.`,
        timeout: 0,
      });
    } else if (merged.length || fromRoom || added || deleteHere.size) {
      const parts = [
        merged.length && `${merged.length} merged with your changes`,
        fromRoom && `${fromRoom} updated from the room`,
        added && `${added} added`,
        deleteHere.size && `${deleteHere.size} removed`,
      ].filter(Boolean).join(', ');
      toast({ kind: 'info', title: `Joined “${room}”`, message: `Files from the live session: ${parts}.` });
    } else toast({ kind: 'success', title: `Joined “${room}”` });
  }

  // ---- remembering where we left off ---------------------------------------------

  private saveTimer = 0;

  /** Remember the room's text (debounced), but only while in sync with it. */
  private saveBaseSoon() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveBaseNow(), 1500);
  }

  private saveBaseNow() {
    window.clearTimeout(this.saveTimer);
    // Offline edits are not in the room yet; recording them as the base would make
    // a later rejoin treat them as unchanged and take the room's older text.
    if (!this.ready || !this.provider.synced || this.state.status !== 'connected') return;
    const snapshot: Base = {};
    this.files.forEach((ytext, path) => (snapshot[path] = ytext.toString()));
    void saveBase(this.baseKey, snapshot);
  }

  // ---- open editors ------------------------------------------------------------

  private bind(path: string, model: monaco.editor.ITextModel) {
    this.unbind(path);
    const ytext = this.files.get(path);
    if (!ytext || !isShared(path)) return;
    this.bindings.set(path, new TextBinding(path, ytext, model, this.provider.awareness));
    publishCursor();
  }

  /** Bind `path` if it has an open model but no binding yet (a file that just appeared). */
  private bindIfOpen(path: string) {
    if (this.bindings.has(path)) return;
    const model = openModels().find(([p]) => p === path)?.[1];
    if (model) this.bind(path, model);
  }

  private unbind(path: string) {
    this.bindings.get(path)?.dispose();
    this.bindings.delete(path);
  }

  bindingFor(model: monaco.editor.ITextModel | null) {
    if (!model) return undefined;
    for (const b of this.bindings.values()) if (b.model === model) return b;
    return undefined;
  }

  // ---- local → room ------------------------------------------------------------

  private onLocalChange = (kind: 'tree' | 'content' | 'meta', path?: string) => {
    if (this.applyingRemote || kind === 'meta') return;
    this.doc.transact(() => {
      if (kind === 'content' && path) {
        this.pushPath(path);
        return;
      }
      // Structural change or a re-read from disk (pull, discard, branch switch): reconcile everything.
      const ws = this.ws;
      for (const p of ws.paths()) this.pushPath(p);
      for (const p of [...this.files.keys()]) if (!ws.get(p)) this.files.delete(p);
    }, LOCAL);
  };

  private pushPath(path: string) {
    if (!isShared(path)) return;
    const text = this.ws.getText(path);
    if (text === undefined) return;
    const ytext = this.files.get(path);
    if (!ytext) {
      this.files.set(path, new Y.Text(text));
      this.bindIfOpen(path);
    } else if (!this.bindings.has(path)) replaceText(ytext, text);
  }

  // ---- room → local ------------------------------------------------------------

  private onRemoteChange = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin === LOCAL) return;
    const changed = new Set<string>();
    const deleted = new Set<string>();
    for (const event of events) {
      if (event.target === this.files) {
        event.changes.keys.forEach((change, path) => {
          if (change.action === 'delete') deleted.add(path);
          else {
            // A different Y.Text under the same path (two people added it at once): rebind.
            const model = this.bindings.get(path)?.model;
            if (model && this.bindings.get(path)?.ytext !== this.files.get(path)) this.bind(path, model);
            changed.add(path);
          }
        });
      } else {
        const path = event.path[0];
        if (typeof path === 'string' && !this.bindings.has(path)) changed.add(path);
      }
    }
    for (const path of changed) {
      const ytext = this.files.get(path);
      if (ytext && !deleted.has(path) && !this.bindings.has(path)) {
        this.applyRemote(path, ytext.toString());
        this.bindIfOpen(path);
      }
    }
    if (deleted.size) this.applyRemoteDeletes(deleted);
  };

  /** Write the room's text for `path` into the Workspace (and so to disk). */
  private applyRemote(path: string, text: string) {
    const local = this.ws.get(path);
    if (local && local.kind !== 'text') return;
    if (local?.text === text) return;
    this.applyingRemote = true;
    try {
      if (local) this.ws.setText(path, text);
      else this.ws.writeFile(path, text);
    } catch (err) {
      console.warn(`collab: could not write ${path}`, err);
    } finally {
      this.applyingRemote = false;
    }
  }

  private applyRemoteDeletes(paths: Set<string>) {
    const removed = new Set<string>();
    this.applyingRemote = true;
    try {
      for (const p of paths) {
        if (this.files.has(p) || !this.ws.get(p)) continue;
        this.unbind(p);
        for (const r of this.ws.delete(p)) removed.add(r);
      }
    } finally {
      this.applyingRemote = false;
    }
    if (!removed.size) return;
    for (const p of removed) disposeModel(p);
    setState((s) => {
      const openTabs = s.openTabs.filter((p) => !removed.has(p));
      return { openTabs, activePath: s.activePath && removed.has(s.activePath) ? (openTabs[0] ?? null) : s.activePath };
    });
  }

  // ---- presence ----------------------------------------------------------------

  private onAwareness = () => {
    const peers: CollabPeer[] = [];
    const css: string[] = [];
    livePeers(this.provider.awareness, this.doc.clientID).forEach((s, id) => {
      if (!s.user) return;
      const color = SAFE_COLOR.test(s.user.color) ? s.user.color : '#4f8cff';
      const name = cleanName(s.user.name) || 'Collaborator';
      peers.push({ id, name, color, path: s.cursor?.path ?? null });
      css.push(
        `.collab-sel-${id}{background-color:${color}40}`,
        `.collab-caret-${id}{border-left-color:${color}}`,
        `.collab-caret-${id}::after{content:${JSON.stringify(name)};background:${color}}`,
      );
    });
    peerStyles.textContent = css.join('\n');
    this.patch({ peers });
  };

  setUser(user: CollabUser) {
    const me = { name: cleanName(user.name) || 'Anonymous', color: SAFE_COLOR.test(user.color) ? user.color : '#4f8cff' };
    this.provider.awareness.setLocalStateField('user', { ...me, sid: BROWSER_ID });
    this.patch({ me });
  }

  private patch(p: Partial<CollabState>) {
    this.state = { ...this.state, ...p };
    this.publish();
  }

  publish() {
    if (current === this) setState({ collab: this.state });
  }
}

/** Names go into a CSS string: keep them short and free of control characters. */
function cleanName(name: unknown) {
  return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f\\]/g, '').trim().slice(0, 32) : '';
}

const peerStyles = (() => {
  const el = document.createElement('style');
  el.id = 'gitlatex-collab-peers';
  document.head.appendChild(el);
  return el;
})();

// ---------------------------------------------------------------------------

let current: Session | null = null;
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

function publishCursor() {
  if (!current) return;
  const binding = current.bindingFor(editor?.getModel() ?? null);
  const selection = editor?.getSelection();
  if (binding && selection) binding.publishSelection(selection);
  else current.provider.awareness.setLocalStateField('cursor', null);
}

/** Connect the open project to a room. Replaces any running session. */
export function startCollab(ws: Workspace, config: CollabConfig, user: CollabUser) {
  stopCollab();
  current = new Session(ws, config, user);
  current.publish();
}

/**
 * Where another person in the room is: their file, and the line and column of
 * their cursor in it (null when they have no file open). Works whether or not
 * that file is open here, since it is read from the shared text.
 */
export function locatePeer(id: number): { path: string; line?: number; column?: number } | null {
  if (!current) return null;
  const state = current.provider.awareness.getStates().get(id) as PeerState | undefined;
  const cursor = state?.cursor;
  if (!cursor?.path) return null;
  const ytext = current.files.get(cursor.path);
  const abs = ytext ? Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.head), current.doc) : null;
  if (!ytext || !abs || abs.type !== ytext) return { path: cursor.path };
  const before = ytext.toString().slice(0, abs.index);
  const line = before.split('\n').length;
  return { path: cursor.path, line, column: abs.index - before.lastIndexOf('\n') };
}

/** Change how you appear (name or colour) without reconnecting. */
export function setCollabUser(user: CollabUser) {
  current?.setUser(user);
}

export function stopCollab() {
  if (!current) return;
  const s = current;
  current = null;
  s.destroy();
  setState({ collab: null });
}

/** Follow the editor's selection so others see where you are. Call once with the editor. */
export function attachCollabEditor(e: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  editor = e;
  const subs = [e.onDidChangeCursorSelection(publishCursor), e.onDidChangeModel(publishCursor)];
  return {
    dispose() {
      for (const s of subs) s.dispose();
      if (editor === e) editor = null;
    },
  };
}
