import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { BROWSER_ID, livePeers } from '../../src/collab/peers';

/** An awareness with other clients' states as the relay would have delivered them. */
function room(states: [number, Record<string, unknown>, number][]) {
  const aw = new Awareness(new Y.Doc());
  for (const [id, state, at] of states) {
    aw.states.set(id, state);
    aw.meta.set(id, { clock: 1, lastUpdated: at });
  }
  return aw;
}

describe('who is in the room', () => {
  it('drops leftovers of this browser (a reloaded page) and keeps one entry per other browser', () => {
    const aw = room([
      [101, { user: { name: 'Me, before reloading', color: '#000000', sid: BROWSER_ID } }, 1000],
      [102, { user: { name: 'Bob', color: '#000000', sid: 'bob-laptop' } }, 1000],
      [103, { user: { name: 'Bob', color: '#000000', sid: 'bob-laptop' } }, 2000],
      [104, { user: { name: 'Carol', color: '#000000', sid: 'carol' } }, 1500],
    ]);
    expect([...livePeers(aw, aw.clientID).keys()].sort()).toEqual([103, 104]);
  });

  it('never lists yourself, and keeps clients that predate browser ids', () => {
    const aw = room([[201, { user: { name: 'Old client', color: '#000000' } }, 1000], [202, { cursor: null }, 1000]]);
    aw.setLocalStateField('user', { name: 'Me', color: '#000000', sid: BROWSER_ID });
    expect([...livePeers(aw, aw.clientID).keys()]).toEqual([201]);
  });

  it('remembers this browser across reloads', async () => {
    expect(localStorage.getItem('gitlatex.collab.browser')).toBe(BROWSER_ID);
  });
});
