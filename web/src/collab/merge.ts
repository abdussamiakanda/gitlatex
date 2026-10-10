/**
 * Text merging for live collaboration.
 *
 * When you rejoin a room, your copy and the room's copy may both have changed
 * since you last left. `mergeText` is a line-based three-way merge (like git's)
 * against the text as it was when you were last in sync: changes from both
 * sides are kept, and where both changed the same lines, the room's version
 * wins. `applyText` turns a new text into the smallest edits on a Y.Text, so
 * concurrent edits by others elsewhere in the file survive.
 */
import { diff3Merge } from 'node-diff3';
import diff from 'fast-diff';
import type * as Y from 'yjs';

/** Lines with their line breaks kept, so joining them gives back the text exactly. */
const lines = (text: string) => (text ? text.split(/(?<=\n)/) : []);

/**
 * Merge `mine` and `theirs` (the room's), both edited from `base`. `clash` is
 * true when some of your lines lost to the room's because both sides changed them.
 */
export function mergeText(base: string, mine: string, theirs: string): { text: string; clash: boolean } {
  if (mine === theirs || theirs === base) return { text: mine, clash: false };
  if (mine === base) return { text: theirs, clash: false };
  const out: string[] = [];
  let clash = false;
  for (const block of diff3Merge(lines(mine), lines(base), lines(theirs), { excludeFalseConflicts: true }) as { ok?: string[]; conflict?: { a: string[]; b: string[] } }[]) {
    if (block.ok) out.push(...block.ok);
    else if (block.conflict) {
      clash = true;
      out.push(...block.conflict.b);
    }
  }
  return { text: out.join(''), clash };
}

/** Make `ytext` read `text` with the fewest inserts and deletes. Call inside a transaction for one update. */
export function applyText(ytext: Y.Text, text: string) {
  const old = ytext.toString();
  if (old === text) return;
  let at = 0;
  for (const [op, chunk] of diff(old, text)) {
    if (op === diff.EQUAL) at += chunk.length;
    else if (op === diff.DELETE) ytext.delete(at, chunk.length);
    else {
      ytext.insert(at, chunk);
      at += chunk.length;
    }
  }
}
