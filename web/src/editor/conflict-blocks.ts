/** Merge conflict blocks in a document: parsing and resolving (no Monaco, so it is unit-testable). */

export interface Conflict {
  /** 1-based line numbers of the marker lines. */
  start: number;
  base: number | null;
  mid: number;
  end: number;
  currentLabel: string;
  incomingLabel: string;
}

/** Find the conflict blocks in a document. Unterminated blocks are ignored. */
export function findConflicts(lines: string[]): Conflict[] {
  const out: Conflict[] = [];
  let open: Partial<Conflict> | null = null;
  lines.forEach((text, i) => {
    const line = i + 1;
    if (text.startsWith('<<<<<<<')) open = { start: line, base: null, currentLabel: text.slice(7).trim() };
    else if (open && text.startsWith('|||||||') && open.mid === undefined) open.base = line;
    else if (open && text.startsWith('=======') && open.mid === undefined) open.mid = line;
    else if (open && open.mid !== undefined && text.startsWith('>>>>>>>')) {
      out.push({ ...(open as Conflict), end: line, incomingLabel: text.slice(7).trim() });
      open = null;
    }
  });
  return out;
}

export type Side = 'current' | 'incoming' | 'both';

/** The text a conflict block is replaced with when accepting `side`. */
export function resolvedText(lines: string[], c: Conflict, side: Side): string[] {
  const current = lines.slice(c.start, (c.base ?? c.mid) - 1);
  const incoming = lines.slice(c.mid, c.end - 1);
  return side === 'current' ? current : side === 'incoming' ? incoming : [...current, ...incoming];
}
