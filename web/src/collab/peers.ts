/**
 * Who is in a room: each person's presence state, and the filter that keeps
 * one entry per browser (see livePeers). Kept apart from the editor binding so
 * it has no Monaco dependency.
 */
import type { Awareness } from 'y-protocols/awareness';

export interface PeerState {
  /** `sid` identifies the browser, so one person refreshing does not show up twice. */
  user?: { name: string; color: string; sid?: string };
  cursor?: { path: string; anchor: unknown; head: unknown } | null;
}

/** This browser, the same across reloads and tabs. */
export const BROWSER_ID = (() => {
  const key = 'gitlatex.collab.browser';
  try {
    let id = localStorage.getItem(key);
    if (!id) localStorage.setItem(key, (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

/**
 * The other people in the room, one entry per browser. A page that was reloaded
 * or closed without saying goodbye leaves its old presence behind on the relay
 * until the connection times out; those leftovers are dropped here: any entry
 * from this browser other than ourselves, and, per other browser, all but the
 * most recently active one.
 */
export function livePeers(awareness: Awareness, selfId: number): Map<number, PeerState> {
  const best = new Map<string, { id: number; state: PeerState; at: number }>();
  awareness.getStates().forEach((raw, id) => {
    if (id === selfId) return;
    const state = raw as PeerState;
    if (!state.user) return;
    const sid = state.user.sid;
    if (sid && sid === BROWSER_ID) return;
    const key = sid ?? `client:${id}`;
    const at = awareness.meta.get(id)?.lastUpdated ?? 0;
    const prev = best.get(key);
    if (!prev || at > prev.at || (at === prev.at && id > prev.id)) best.set(key, { id, state, at });
  });
  return new Map([...best.values()].map((p) => [p.id, p.state]));
}
