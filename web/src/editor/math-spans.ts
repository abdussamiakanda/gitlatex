/** Finding the formulas in LaTeX source. Pure: no Monaco, so it is unit-tested directly. */

export interface MathSpan {
  /** Offsets of the whole formula, delimiters included: text.slice(start, end). */
  start: number;
  end: number;
  /** What to hand KaTeX. */
  tex: string;
  display: boolean;
}

/** Replaces comments with spaces, keeping every offset the same. */
export function maskComments(text: string): string {
  return text.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, (m, pre: string, slashes: string) => pre + slashes + ' '.repeat(m.length - pre.length - slashes.length));
}

// In priority order: a later kind never matches inside an earlier one.
const KINDS: [RegExp, boolean][] = [
  [/\\begin\{(equation|align|gather|multline|flalign|displaymath|math|eqnarray)(\*?)\}([\s\S]*?)\\end\{\1\2\}/g, true],
  [/\\\[([\s\S]*?)\\\]/g, true],
  [/\$\$([\s\S]*?)\$\$/g, true],
  [/\\\(([\s\S]*?)\\\)/g, false],
  [/(?<![\\$])\$(?!\$)((?:\\.|[^$\\])+?)\$/g, false],
];

/** Every formula outside comments, in document order (empty ones too: tex is then ''). */
export function findMath(text: string): MathSpan[] {
  const src = maskComments(text);
  const spans: MathSpan[] = [];
  for (const [re, display] of KINDS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const start = m.index, end = start + m[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      const env = m.length > 3 ? m[1] : null;
      // a \begin typed above an existing one pairs with its \end: skip to the inner, real one
      if (env && m[3].includes(`\\begin{${env}${m[2]}}`)) {
        re.lastIndex = start + 1;
        continue;
      }
      let tex = (env ? m[3] : m[1]).replace(/\\label\{[^}]*\}/g, '');
      if (env && /^(align|flalign|eqnarray)$/.test(env)) tex = `\\begin{aligned}${tex}\\end{aligned}`;
      if (env === 'gather') tex = `\\begin{gathered}${tex}\\end{gathered}`;
      spans.push({ start, end, tex: tex.trim(), display });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
