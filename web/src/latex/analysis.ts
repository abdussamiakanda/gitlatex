/**
 * Project-wide static analysis used by the editor: document outline, labels,
 * user-defined macros/environments, and preamble editing helpers.
 */
import { stripComments } from '../engine/scan';

export interface OutlineItem {
  level: number;
  kind: string;
  title: string;
  file: string;
  line: number;
  label?: string;
}

const SECTION_LEVELS: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6, frametitle: 3,
};

/** Replace comments with spaces so offsets/line numbers stay intact. */
function blankComments(src: string): string {
  return src.replace(/(^|[^\\])(%.*)$/gm, (_m, a: string, c: string) => a + ' '.repeat(c.length));
}

function lineAt(src: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** Read a balanced {...} argument starting at `i` (which must point at '{'). */
export function readGroup(src: string, i: number): { text: string; end: number } | null {
  if (src[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { text: src.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

export function outline(files: { path: string; text: string }[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const f of files) {
    if (!f.path.endsWith('.tex')) continue;
    const src = blankComments(f.text);
    const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|frametitle)(\*?)\s*(?:\[[^\]]*\])?\s*(?=\{)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const g = readGroup(src, re.lastIndex);
      if (!g) continue;
      const title = g.text.replace(/\\label\{[^}]*\}/g, '').replace(/\\[a-zA-Z]+\*?\s*/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      const after = src.slice(g.end, g.end + 120);
      const label = /^\s*\\label\{([^}]+)\}/.exec(after)?.[1];
      items.push({ level: SECTION_LEVELS[m[1]], kind: m[1] + m[2], title: title || '(untitled)', file: f.path, line: lineAt(src, m.index), label });
    }
  }
  return items;
}

export interface LabelInfo {
  label: string;
  file: string;
  line: number;
  context: string;
}

export function labels(files: { path: string; text: string }[]): LabelInfo[] {
  const out: LabelInfo[] = [];
  for (const f of files) {
    if (!f.path.endsWith('.tex')) continue;
    const src = blankComments(f.text);
    const re = /\\label\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const line = lineAt(src, m.index);
      const ctxLine = f.text.split('\n')[line - 1]?.trim() ?? '';
      out.push({ label: m[1], file: f.path, line, context: ctxLine.slice(0, 120) });
    }
  }
  return out;
}

export interface UserMacro {
  name: string;
  args: number;
  kind: 'command' | 'environment';
  file: string;
}

export function userMacros(files: { path: string; text: string }[]): UserMacro[] {
  const out: UserMacro[] = [];
  for (const f of files) {
    if (!/\.(tex|sty|cls)$/.test(f.path)) continue;
    const src = stripComments(f.text);
    const cmd = /\\(?:new|renew|provide)command\*?\s*\{?\\([A-Za-z@]+)\}?\s*(?:\[(\d)\])?/g;
    let m: RegExpExecArray | null;
    while ((m = cmd.exec(src))) out.push({ name: m[1], args: Number(m[2] ?? 0), kind: 'command', file: f.path });
    const def = /\\def\s*\\([A-Za-z@]+)((?:#\d)*)/g;
    while ((m = def.exec(src))) out.push({ name: m[1], args: (m[2].match(/#/g) ?? []).length, kind: 'command', file: f.path });
    const math = /\\DeclareMathOperator\*?\s*\{\\([A-Za-z]+)\}/g;
    while ((m = math.exec(src))) out.push({ name: m[1], args: 0, kind: 'command', file: f.path });
    const env = /\\(?:new|renew)environment\s*\{([^}]+)\}\s*(?:\[(\d)\])?/g;
    while ((m = env.exec(src))) out.push({ name: m[1], args: Number(m[2] ?? 0), kind: 'environment', file: f.path });
    const thm = /\\newtheorem\*?\s*\{([^}]+)\}/g;
    while ((m = thm.exec(src))) out.push({ name: m[1], args: 0, kind: 'environment', file: f.path });
  }
  return out;
}

/** Packages loaded by a document (from its preamble). */
export function loadedPackages(src: string): Set<string> {
  const out = new Set<string>();
  const re = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  const clean = stripComments(src);
  while ((m = re.exec(clean))) for (const p of m[1].split(',')) out.add(p.trim());
  return out;
}

/**
 * Compute the edit that adds `\usepackage[options]{pkg}` to a preamble.
 * Returns null if the package is already loaded or the file has no preamble.
 * The line is inserted after the last \usepackage (or after \documentclass).
 */
export function packageInsertion(src: string, pkg: string, options?: string): { line: number; text: string } | null {
  if (loadedPackages(src).has(pkg)) return null;
  const clean = blankComments(src);
  const docStart = clean.search(/\\begin\s*\{document\}/);
  const pre = docStart >= 0 ? clean.slice(0, docStart) : clean;
  if (!/\\documentclass/.test(pre)) return null;
  let at = -1;
  const re = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\}[^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pre))) at = m.index + m[0].length;
  if (at < 0) {
    const dc = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]*\}[^\n]*/.exec(pre);
    if (!dc) return null;
    at = dc.index + dc[0].length;
  }
  // hyperref (and cleveref after it) should stay last: insert before it if present.
  const hyper = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{hyperref\}/.exec(pre);
  if (hyper && pkg !== 'cleveref' && hyper.index < at) {
    return { line: lineAt(src, hyper.index), text: `\\usepackage${options ? `[${options}]` : ''}{${pkg}}\n` };
  }
  return { line: lineAt(src, at) + 1, text: `\\usepackage${options ? `[${options}]` : ''}{${pkg}}\n` };
}

export function wordCount(src: string): number {
  const body = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(src)?.[1] ?? src;
  const text = stripComments(body)
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\begin\{(equation|align|gather|multline|tikzpicture|figure|table|lstlisting|verbatim)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
    .replace(/\\(?:label|ref|eqref|cite\w*|includegraphics|usepackage|input|include|bibliography\w*)\s*(?:\[[^\]]*\])?\{[^}]*\}/g, ' ')
    .replace(/\\[A-Za-z@]+\*?/g, ' ')
    .replace(/[{}[\]~\\&%#^_]/g, ' ');
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
