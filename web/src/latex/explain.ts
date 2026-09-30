/**
 * Friendly explanations for TeX errors, with one-click quick fixes.
 *
 * TeX error messages were written for experts in 1982. For each common error
 * we produce a plain-language explanation and, where possible, a concrete fix
 * (add the missing package, escape a special character, …).
 */
import type { Diagnostic } from '../types';

export type QuickFix =
  | { kind: 'addPackage'; label: string; pkg: string; options?: string }
  | { kind: 'replaceInLine'; label: string; file: string; line: number; search: string; replace: string }
  | { kind: 'switchEngine'; label: string; engine: 'xetex' | 'pdftex' }
  | { kind: 'openFile'; label: string; file: string; line?: number }
  | { kind: 'passOptions'; label: string; pkg: string };

export interface Explanation {
  title: string;
  detail: string;
  fixes: QuickFix[];
}

/** Which package defines a command (without the backslash). */
export const COMMAND_PACKAGES: Record<string, string> = {
  includegraphics: 'graphicx', graphicspath: 'graphicx', rotatebox: 'graphicx', scalebox: 'graphicx', resizebox: 'graphicx',
  textcolor: 'xcolor', color: 'xcolor', colorbox: 'xcolor', definecolor: 'xcolor', rowcolor: 'xcolor', cellcolor: 'xcolor',
  href: 'hyperref', url: 'hyperref', hypersetup: 'hyperref', autoref: 'hyperref', nolinkurl: 'hyperref',
  toprule: 'booktabs', midrule: 'booktabs', bottomrule: 'booktabs', cmidrule: 'booktabs', addlinespace: 'booktabs',
  mathbb: 'amssymb', mathfrak: 'amssymb', varnothing: 'amssymb', leqslant: 'amssymb', geqslant: 'amssymb', therefore: 'amssymb',
  text: 'amsmath', eqref: 'amsmath', dfrac: 'amsmath', tfrac: 'amsmath', binom: 'amsmath', DeclareMathOperator: 'amsmath', operatorname: 'amsmath', boldsymbol: 'amsmath', xrightarrow: 'amsmath', intertext: 'amsmath', numberwithin: 'amsmath',
  mathscr: 'mathrsfs', bm: 'bm', SI: 'siunitx', si: 'siunitx', qty: 'siunitx', unit: 'siunitx', num: 'siunitx', ang: 'siunitx',
  multirow: 'multirow', multicolumn: 'array', lipsum: 'lipsum', blindtext: 'blindtext',
  cref: 'cleveref', Cref: 'cleveref', crefrange: 'cleveref', ce: 'mhchem', lstinputlisting: 'listings', lstset: 'listings',
  captionof: 'caption', captionsetup: 'caption', subcaption: 'subcaption', subcaptionbox: 'subcaption',
  citep: 'natbib', citet: 'natbib', citeauthor: 'natbib', citeyear: 'natbib', printbibliography: 'biblatex', addbibresource: 'biblatex', parencite: 'biblatex', textcite: 'biblatex', autocite: 'biblatex',
  tikz: 'tikz', usetikzlibrary: 'tikz', pgfplotsset: 'pgfplots', todo: 'todonotes', missingfigure: 'todonotes',
  pagestyle: 'fancyhdr', fancyhead: 'fancyhdr', fancyfoot: 'fancyhdr', fancyhf: 'fancyhdr', lhead: 'fancyhdr', rhead: 'fancyhdr', chead: 'fancyhdr', cfoot: 'fancyhdr',
  titleformat: 'titlesec', titlespacing: 'titlesec', setlist: 'enumitem', newgeometry: 'geometry', restoregeometry: 'geometry',
  singlespacing: 'setspace', onehalfspacing: 'setspace', doublespacing: 'setspace', setstretch: 'setspace',
  checkmark: 'amssymb', euro: 'eurosym', degree: 'gensymb', celsius: 'gensymb', ohm: 'gensymb', micro: 'gensymb',
  enquote: 'csquotes', hl: 'soul', ul: 'soul', st: 'soul', sout: 'ulem', uline: 'ulem', xspace: 'xspace',
  newtheorem: 'amsthm', theoremstyle: 'amsthm', qedhere: 'amsthm', mathlarger: 'relsize', cancel: 'cancel',
  FloatBarrier: 'placeins', afterpage: 'afterpage', newcolumntype: 'array', arraybackslash: 'array',
  setmainfont: 'fontspec', setsansfont: 'fontspec', setmonofont: 'fontspec', fontspec: 'fontspec', newfontfamily: 'fontspec',
  ding: 'pifont', faIcon: 'fontawesome5', lettrine: 'lettrine', marginnote: 'marginnote', epigraph: 'epigraph',
  DTMnow: 'datetime2', today: '', qrcode: 'qrcode', drawmatrix: 'drawmatrix', circled: 'tikz',
};

export const ENVIRONMENT_PACKAGES: Record<string, string> = {
  align: 'amsmath', 'align*': 'amsmath', gather: 'amsmath', 'gather*': 'amsmath', multline: 'amsmath', split: 'amsmath', cases: 'amsmath',
  pmatrix: 'amsmath', bmatrix: 'amsmath', vmatrix: 'amsmath', Bmatrix: 'amsmath', Vmatrix: 'amsmath', matrix: 'amsmath', aligned: 'amsmath', 'equation*': 'amsmath',
  proof: 'amsthm', tikzpicture: 'tikz', axis: 'pgfplots', lstlisting: 'listings', minted: 'minted', algorithm: 'algorithm', algorithmic: 'algpseudocode',
  subfigure: 'subcaption', multicols: 'multicol', longtable: 'longtable', tabularx: 'tabularx', landscape: 'pdflscape', wrapfigure: 'wrapfig',
  tcolorbox: 'tcolorbox', mdframed: 'mdframed', framed: 'framed', spacing: 'setspace', comment: 'comment', forest: 'forest', circuitikz: 'circuitikz',
  'tabular*': '', verbatim: '', Verbatim: 'fancyvrb', CJK: 'CJKutf8', dirtree: 'dirtree', quote: '', exercise: 'exsheets',
};

function undefinedCommandName(d: Diagnostic): string | null {
  // Context looks like: "l.12 Some text \mycommand" — the offending control sequence ends the line.
  const ctx = d.context ?? d.raw ?? '';
  const m = /l\.\d+\s.*?(\\[A-Za-z@]+)\s*$/m.exec(ctx) ?? /(\\[A-Za-z@]+)\s*$/m.exec(ctx.split('\n')[0] ?? '');
  return m ? m[1].slice(1) : null;
}

export function explain(d: Diagnostic): Explanation | null {
  const msg = d.message;
  const fixes: QuickFix[] = [];

  if (/Undefined control sequence/.test(msg)) {
    const cmd = undefinedCommandName(d);
    const pkg = cmd ? COMMAND_PACKAGES[cmd] : undefined;
    if (pkg) fixes.push({ kind: 'addPackage', label: `Add \\usepackage{${pkg}}`, pkg });
    return {
      title: cmd ? `Unknown command \\${cmd}` : 'Unknown command',
      detail: pkg
        ? `\\${cmd} is defined by the "${pkg}" package, which isn't loaded. Add it to the preamble (before \\begin{document}).`
        : `LaTeX doesn't know ${cmd ? `\\${cmd}` : 'this command'}. Check the spelling, or load the package that defines it. If you meant a literal backslash, write \\textbackslash.`,
      fixes,
    };
  }

  const envUndef = /Environment ([\w*]+) undefined/.exec(msg);
  if (envUndef) {
    const pkg = ENVIRONMENT_PACKAGES[envUndef[1]];
    if (pkg) fixes.push({ kind: 'addPackage', label: `Add \\usepackage{${pkg}}`, pkg });
    return {
      title: `Unknown environment "${envUndef[1]}"`,
      detail: pkg
        ? `The ${envUndef[1]} environment comes from the "${pkg}" package.`
        : 'The environment name is misspelled or its package is not loaded.',
      fixes,
    };
  }

  const fileNotFound = /File [`']([^'`]+)' not found/.exec(msg);
  if (fileNotFound) {
    const name = fileNotFound[1];
    const isPkg = /\.(sty|cls)$/.test(name);
    return {
      title: `Missing file ${name}`,
      detail: isPkg
        ? `The ${name.replace(/\.\w+$/, '')} ${name.endsWith('.cls') ? 'class' : 'package'} isn't available in this TeX distribution or on the package shelf. Check the name, or upload the .${name.split('.').pop()} file into your project.`
        : `"${name}" isn't in your project. Upload it (drag it onto the file tree) or fix the path — paths are relative to the main document.`,
      fixes,
    };
  }

  if (/Missing \$ inserted/.test(msg)) {
    return {
      title: 'Math symbol used outside math mode',
      detail: 'Characters like _ ^ and commands like \\alpha only work inside math. Wrap the formula in $…$, or escape underscores as \\_ in normal text.',
      fixes,
    };
  }

  if (/Misplaced alignment tab character &/.test(msg)) {
    if (d.file && d.line) fixes.push({ kind: 'replaceInLine', label: 'Escape & as \\&', file: d.file, line: d.line, search: '&', replace: '\\&' });
    return { title: 'Stray & character', detail: '& separates table columns. To print an ampersand in text, write \\&.', fixes };
  }

  if (/Illegal parameter number in definition|You can't use `macro parameter character #'/.test(msg)) {
    if (d.file && d.line) fixes.push({ kind: 'replaceInLine', label: 'Escape # as \\#', file: d.file, line: d.line, search: '#', replace: '\\#' });
    return { title: 'Stray # character', detail: '# is reserved for macro arguments. To print a hash sign, write \\#.', fixes };
  }

  if (/Missing \\begin\{document\}/.test(msg)) {
    return {
      title: 'Text before \\begin{document}',
      detail: 'Everything printable must come after \\begin{document}. Look for stray characters or a typo in the preamble.',
      fixes,
    };
  }

  const mismatch = /\\begin\{([^}]+)\} on input line (\d+) ended by \\end\{([^}]+)\}/.exec(msg);
  if (mismatch) {
    if (d.file) fixes.push({ kind: 'openFile', label: `Go to \\begin{${mismatch[1]}} (line ${mismatch[2]})`, file: d.file, line: Number(mismatch[2]) });
    return {
      title: 'Mismatched environments',
      detail: `\\begin{${mismatch[1]}} (line ${mismatch[2]}) is closed by \\end{${mismatch[3]}}. Environments must be closed in the reverse order they were opened.`,
      fixes,
    };
  }

  if (/Missing \} inserted|Extra \}, or forgotten|Too many \}'s|Missing \{ inserted|Extra alignment tab|Paragraph ended before .* was complete|Runaway argument|File ended while scanning/.test(msg)) {
    return {
      title: 'Unbalanced braces or incomplete command',
      detail: 'A { is missing its matching } (or vice versa), or a command argument was never closed. Check the braces near the reported line.',
      fixes,
    };
  }

  if (/There's no line here to end/.test(msg)) {
    return { title: 'Line break in the wrong place', detail: '\\\\ can only end a line that has content. Use a blank line to start a new paragraph, or \\vspace{…} for extra space.', fixes };
  }

  if (/Double (subscript|superscript)/.test(msg)) {
    return { title: 'Double sub/superscript', detail: 'Write x_{ij} instead of x_i_j, and group exponents with braces: x^{a^b}.', fixes };
  }

  if (/Can be used only in preamble/.test(msg)) {
    return { title: 'Preamble-only command in the document body', detail: '\\usepackage and similar commands must come before \\begin{document}.', fixes };
  }

  const unicode = /Unicode character (\S+) \(U\+([0-9A-F]+)\)/.exec(msg);
  if (unicode || /Invalid UTF-8 byte/.test(msg)) {
    fixes.push({ kind: 'switchEngine', label: 'Compile with XeLaTeX (native Unicode)', engine: 'xetex' });
    return {
      title: unicode ? `Unsupported character ${unicode[1]}` : 'Invalid character encoding',
      detail: 'pdfLaTeX only knows a subset of Unicode. Switch to XeLaTeX for full Unicode support, or replace the character with its LaTeX command.',
      fixes,
    };
  }

  const optionClash = /Option clash for package (\S+)/.exec(msg);
  if (optionClash) {
    const pkg = optionClash[1].replace(/\.$/, '');
    fixes.push({ kind: 'passOptions', label: `Pass your ${pkg} options before \\documentclass`, pkg });
    return {
      title: `Option clash for ${pkg}`,
      detail: `${pkg} was loaded twice with different options — usually another package loaded it first without yours (newtxtext does this with xcolor). Passing your options with \\PassOptionsToPackage before \\documentclass makes every load use them.`,
      fixes,
    };
  }

  if (/Missing number, treated as zero/.test(msg)) {
    return { title: 'A number was expected', detail: 'A command expecting a length or number got text — e.g. an empty \\vspace{}, or [ ] after \\\\ being read as an optional argument.', fixes };
  }

  if (/Dimension too large/.test(msg)) {
    return { title: 'Dimension too large', detail: 'A length exceeded TeX’s maximum (about 5.7 m). Often caused by scaling an image or plot with extreme values.', fixes };
  }

  if (/Font .* not (found|loadable)|cannot open .*font file/.test(msg)) {
    return { title: 'Font not available', detail: 'A font used by the document is not available. Try a different font package, or compile with XeLaTeX and a font from TeX Live.', fixes };
  }

  if (/Unknown graphics extension/.test(msg)) {
    return { title: 'Unsupported image format', detail: 'pdfLaTeX accepts PNG, JPG and PDF images. Convert SVG/EPS/WebP files to PNG or PDF first.', fixes };
  }

  if (/Emergency stop|Fatal error occurred/.test(msg)) {
    return { title: 'Compilation stopped', detail: 'TeX stopped after an earlier error. Fix the first error in the list — the rest often disappear.', fixes };
  }

  if (/Undefined (citation|reference)|Citation .* undefined|Reference .* undefined/.test(msg)) {
    return {
      title: /itation/.test(msg) ? 'Unknown citation key' : 'Unknown reference',
      detail: /itation/.test(msg)
        ? 'The key is not in any .bib file referenced by \\bibliography/\\addbibresource, or BibTeX has not run yet.'
        : 'No \\label with that name exists, or the document needs another pass (recompile).',
      fixes,
    };
  }

  if (/biber/i.test(msg)) {
    return { title: 'Biber is not available', detail: 'Use \\usepackage[backend=bibtex]{biblatex} — BibTeX runs in the browser.', fixes };
  }

  return null;
}

/**
 * Fix an option clash: find the document's own `\usepackage[opts]{pkg}` and add
 * `\PassOptionsToPackage{opts}{pkg}` before `\documentclass`, so whichever
 * package loads `pkg` first already uses those options. Returns null when there
 * is nothing to do.
 */
export function passOptionsFix(text: string, pkg: string): string | null {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const use = new RegExp(`^[^%\\n]*\\\\usepackage\\s*\\[([^\\]]*)\\]\\s*\\{[^}]*\\b${esc}\\b[^}]*\\}`, 'm').exec(text);
  const opts = use?.[1].replace(/\s+/g, ' ').trim();
  if (!opts) return null;
  const line = `\\PassOptionsToPackage{${opts}}{${pkg}}`;
  if (text.includes(line)) return null;
  const cls = /^[^%\n]*\\documentclass/m.exec(text);
  if (!cls) return null;
  return text.slice(0, cls.index) + line + '\n' + text.slice(cls.index);
}
