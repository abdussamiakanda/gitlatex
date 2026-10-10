import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyText, mergeText } from '../../src/collab/merge';

const base = 'Title\nIntro line.\nMiddle line.\nLast line.\n';

describe('collab rejoin merge', () => {
  it('keeps your edits when only you changed the file', () => {
    const mine = base.replace('Intro line.', 'Intro, edited offline.');
    expect(mergeText(base, mine, base)).toEqual({ text: mine, clash: false });
  });

  it('takes the room when only others changed it', () => {
    const theirs = base.replace('Last line.', 'Last line, from the room.');
    expect(mergeText(base, base, theirs)).toEqual({ text: theirs, clash: false });
  });

  it('keeps both sides when they changed different lines', () => {
    const mine = base.replace('Intro line.', 'Intro, edited offline.');
    const theirs = base.replace('Last line.', 'Last line, from the room.');
    expect(mergeText(base, mine, theirs)).toEqual({ text: 'Title\nIntro, edited offline.\nMiddle line.\nLast line, from the room.\n', clash: false });
  });

  it('takes the same change once (e.g. after pulling what the room already has)', () => {
    const both = base.replace('Middle line.', 'Middle, changed by both.');
    expect(mergeText(base, both, both)).toEqual({ text: both, clash: false });
    const mine = both.replace('Title', 'Title (mine)');
    expect(mergeText(base, mine, both).text).toBe(mine);
  });

  it('lets the room win where both changed the same lines, and keeps the rest of yours', () => {
    const mine = base.replace('Middle line.', 'Middle, my way.').replace('Title', 'My title');
    const theirs = base.replace('Middle line.', 'Middle, the room’s way.');
    const m = mergeText(base, mine, theirs);
    expect(m.clash).toBe(true);
    expect(m.text).toBe('My title\nIntro line.\nMiddle, the room’s way.\nLast line.\n');
    expect(m.text).not.toContain('<<<<<<<');
  });

  it('copes with a missing final line break and empty files', () => {
    expect(mergeText('a\nx\nb', 'a!\nx\nb', 'a\nx\nb?')).toEqual({ text: 'a!\nx\nb?', clash: false });
    expect(mergeText('', 'new text\n', '')).toEqual({ text: 'new text\n', clash: false });
  });

  it('treats edits to neighbouring lines as overlapping, as git does', () => {
    expect(mergeText('a\nb\n', 'a!\nb\n', 'a\nb?\n')).toEqual({ text: 'a\nb?\n', clash: true });
  });

  it('applies a new text as small edits, so concurrent edits elsewhere survive', () => {
    // Two replicas start from the same text.
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('t').insert(0, base);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // A rewrites the first line through applyText while B edits the last line.
    applyText(a.getText('t'), base.replace('Title', 'New title'));
    b.getText('t').insert(base.indexOf('Last'), 'Very ');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText('t').toString()).toBe('New title\nIntro line.\nMiddle line.\nVery Last line.\n');
    expect(b.getText('t').toString()).toBe(a.getText('t').toString());
  });
});
