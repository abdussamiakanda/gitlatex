/**
 * Log analyser: find the files a TeX run asked for but could not open.
 *
 * TeX, kpathsea, pdfTeX, XeTeX, xdvipdfmx, BibTeX and several popular packages
 * each report missing inputs in their own words. We normalise all of them to
 * plain file names (or font family names) that the package shelf can resolve.
 */

export interface MissingReport {
  /** File basenames that could not be found (with extension when known). */
  files: string[];
  /** Font family names that fontspec/XeTeX could not find. */
  fonts: string[];
}

type Rule = [RegExp, (m: RegExpExecArray) => string[]];

const withTexExt = (name: string) => (/\.[A-Za-z0-9]+$/.test(name) ? [name] : [`${name}.tex`, name]);

const FILE_RULES: Rule[] = [
  // ! LaTeX Error: File `tikz.sty' not found.
  [/LaTeX Error: File [`']([^'`]+)' not found/g, (m) => withTexExt(m[1])],
  // ! I can't find file `foo'.
  [/I can't find file [`']([^'`]+)'/g, (m) => withTexExt(m[1])],
  // ! Font \T1/cmr/m/n/10=ecrm1000 at 10pt not loadable: Metric (TFM) file not found.
  [/Font \\[^=\s]+=([^\s:]+?)(?: at [\d.]+pt)? not loadable: Metric \(TFM\) file/g, (m) =>
    m[1].includes('.') ? [m[1]] : [`${m[1]}.tfm`]],
  // !pdfTeX error: pdflatex (file sfrm1000.pfb): cannot open Type 1 font file for reading
  [/\(file ([^\s)]+)\): cannot open/g, (m) => [m[1]]],
  // !pdfTeX error: /bin/busytex (file ecrm1000): Font ecrm1000 at 600 not found
  [/\(file ([^\s)]+)\): Font \S+ at \d+ not found/g, (m) => [`${m[1]}.pfb`, `${m[1]}.tfm`]],
  // kpathsea: Running mktextfm ecrm1000
  [/Running mktextfm (\S+)/g, (m) => [`${m[1]}.tfm`]],
  // xdvipdfmx:warning: Could not locate a virtual/physical font for TFM "ecrm1000".
  [/Could not locate a virtual\/physical font for TFM "([^"]+)"/g, (m) => [`${m[1]}.pfb`, `${m[1]}.vf`]],
  // xdvipdfmx:warning: Could not find encoding file "cm-super-t1.enc".
  [/Could not find encoding file "([^"]+)"/g, (m) => [m[1]]],
  // ! Package pgf Error: I did not find the tikz library 'arrows.meta'.
  [/I did not find the (tikz|pgf) library '([^']+)'/g, (m) =>
    m[1] === 'tikz' ? [`tikzlibrary${m[2]}.code.tex`, `pgflibrary${m[2]}.code.tex`] : [`pgflibrary${m[2]}.code.tex`]],
  // ! Package biblatex Error: File 'ieee.bbx' not found.
  [/Package \w+ Error: File '([^']+)' not found/g, (m) => [m[1]]],
  // BibTeX: I couldn't open style file ieeetr.bst
  [/I couldn't open style file (\S+)/g, (m) => [m[1].endsWith('.bst') ? m[1] : `${m[1]}.bst`]],
  // LaTeX Font Warning: Font shape `T1/lmr/m/n' undefined → t1lmr.fd
  [/Font shape `([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/[^']*' undefined/g, (m) => [`${m[1].toLowerCase()}${m[2]}.fd`]],
  // ! Package babel Error: Unknown option `ngerman'. → ngerman.ldf
  [/Package babel Error: Unknown option [`']([^'`]+)'/g, (m) => [`${m[1]}.ldf`]],
  // LuaTeX: module 'luaotfload-main' not found
  [/module '([^']+)' not found/g, (m) => [`${m[1]}.lua`]],
];

const FONT_RULES: Rule[] = [
  // ! Package fontspec Error: The font "TeX Gyre Pagella" cannot be found.
  [/The font "([^"]+)" cannot be(?:\s|\(fontspec\))+found/g, (m) => [m[1]]],
  // ! Font \TU/TeXGyrePagella(0)/m/n/10="TeX Gyre Pagella:mode=node;" at 10pt not loadable: Metric (TFM) file or installed font not found.
  [/Font \\[^=]+="\[?([^":;\]]+)[^"]*"[^\n]*not loadable: Metric \(TFM\) file or installed font not found/g, (m) => [m[1]]],
];

function apply(rules: Rule[], log: string): string[] {
  const out = new Set<string>();
  for (const [re, fn] of rules) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(log))) for (const n of fn(m)) if (n && !n.includes('/')) out.add(n);
  }
  return [...out];
}

/**
 * TeX wraps log lines at 79 characters, which can split a file name in two.
 * Re-join lines that are exactly `max_print_line` long before matching.
 */
export function unwrapLog(log: string, width = 79): string {
  const lines = log.split(/\r?\n/);
  const out: string[] = [];
  let acc = '';
  for (const line of lines) {
    acc += line;
    if (line.length !== width) {
      out.push(acc);
      acc = '';
    }
  }
  if (acc) out.push(acc);
  return out.join('\n');
}

export function findMissing(log: string): MissingReport {
  const text = unwrapLog(log);
  const fonts = apply(FONT_RULES, text);
  // A fontspec font name is not a file: don't also report it as a missing .tfm.
  const fontSet = new Set(fonts.map((f) => f.toLowerCase()));
  const files = apply(FILE_RULES, text).filter((f) => !fontSet.has(f.replace(/\.tfm$/, '').toLowerCase()));
  return { files, fonts };
}
