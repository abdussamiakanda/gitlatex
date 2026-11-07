/**
 * Child documents in the LyX-style editor: `\input{…}`, `\include{…}` and
 * `\subfile{…}` boxes open the file they name, and a child shows the way back
 * to the document it was opened from (or, opened directly, one that inputs it).
 */
import { dirname, extname } from '../utils/paths';

export type ChildCmd = 'input' | 'include' | 'subfile';
export interface ChildRef {
  cmd: ChildCmd;
  file: string;
}

/** The child command a TeX-code box holds, when that is all it holds. */
export function childCommand(tex: string): ChildRef | null {
  const m = /^\s*\\(input|include|subfile)\s*\{([^{}]+)\}\s*$/.exec(tex);
  return m ? { cmd: m[1] as ChildCmd, file: m[2].trim() } : null;
}

/** `p` taken from `dir`, with `.` and `..` resolved; null when it leaves the project. */
function resolve(dir: string, p: string): string | null {
  const out = dir ? dir.split('/') : [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

/**
 * The files TeX would try for `ref`, in order: relative to the main file
 * (\subfile: to the file it is in first). \include always adds .tex; \input
 * tries name.tex first, then the name as written.
 */
export function childCandidates(ref: ChildRef, from: string, main: string): string[] {
  const dirs = new Set(ref.cmd === 'subfile' ? [dirname(from), dirname(main)] : [dirname(main), dirname(from)]);
  const out: string[] = [];
  for (const dir of dirs) {
    const p = resolve(dir, ref.file);
    if (p == null) continue;
    for (const c of ref.cmd === 'include' ? [`${p}.tex`] : extname(p) === 'tex' ? [p] : [`${p}.tex`, p]) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** The project file `ref` names, or null when none of TeX's candidates exists. */
export function findChild(ref: ChildRef, from: string, main: string, exists: (path: string) => boolean): string | null {
  return childCandidates(ref, from, main).find(exists) ?? null;
}

/** The line (1-based) of the first child command in `text` that names `child`, skipping commented-out ones. */
function lineOfChild(text: string, from: string, child: string, main: string, exists: (path: string) => boolean): number | null {
  for (const m of text.matchAll(/\\(input|include|subfile)\s*\{([^{}]+)\}/g)) {
    const before = text.slice(0, m.index);
    if (/(^|[^\\])%[^\n]*$/.test(before)) continue;
    if (findChild({ cmd: m[1] as ChildCmd, file: m[2].trim() }, from, main, exists) === child) return before.split('\n').length;
  }
  return null;
}

/** How each open child document was reached: the document it was opened from. */
const trail: { parent: string; child: string }[] = [];

/** Opening `child` from `parent` makes `parent` its way back (replacing an older one). */
export function rememberChild(parent: string, child: string) {
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i].child === child) trail.splice(i, 1);
  if (child !== parent) trail.push({ parent, child });
}

/** Going back from `child` to `parent` forgets the way there and everything opened after. */
export function leaveChild(child: string, parent: string) {
  const i = trail.findIndex((t) => t.child === child && t.parent === parent);
  if (i >= 0) trail.length = i;
}

/**
 * The document to go back to from `path`, and the line of its child command
 * there: the one it was opened from, else a .tex file that inputs it (the main
 * file first). Null when nothing inputs it.
 */
export function parentOf(path: string, files: { path: string; text: string }[], main: string): { parent: string; line: number } | null {
  const texts = new Map(files.map((f) => [f.path, f.text]));
  const exists = (p: string) => texts.has(p);
  for (let i = trail.length - 1; i >= 0; i--) {
    const { parent, child } = trail[i];
    if (child === path && texts.has(parent)) return { parent, line: lineOfChild(texts.get(parent)!, parent, path, main, exists) ?? 1 };
  }
  const ordered = files.filter((f) => f.path !== path).sort((a, b) => +(b.path === main) - +(a.path === main));
  for (const f of ordered) {
    const line = lineOfChild(f.text, f.path, path, main, exists);
    if (line != null) return { parent: f.path, line };
  }
  return null;
}
