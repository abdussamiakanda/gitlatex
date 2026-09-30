/**
 * Static pre-scan of LaTeX sources.
 *
 * Before the first TeX run we predict which files the document will need so
 * the right TeX Live collections and shelf bundles are mounted up front. This
 * turns "run → fail → fetch → rerun" cycles into a single run for the vast
 * majority of documents. Anything the scan misses is still caught afterwards
 * by the log analyser (missing.ts).
 */

export interface ScanResult {
  /** File basenames TeX will look up (x.sty, y.cls, tikzlibraryz.code.tex, s.bst, …). */
  files: Set<string>;
  /** Font family names requested through fontspec (\setmainfont{…}, \fontspec{…}). */
  fonts: Set<string>;
  /** Whether the sources reference a bibliography. */
  usesBibliography: boolean;
  /** biblatex backend if biblatex is loaded (default biber). */
  biblatexBackend: string | null;
}

/** Remove TeX comments (unescaped % to end of line). */
export function stripComments(src: string): string {
  return src.replace(/(^|[^\\])%.*$/gm, '$1');
}

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !/[\\#]/.test(x));

/** Parse `key=value` pairs out of an optional argument such as `[backend=biber,style=ieee]`. */
function keyvals(opt: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!opt) return out;
  for (const part of opt.split(',')) {
    const [k, v] = part.split('=').map((s) => s?.trim());
    if (k) out.set(k, v ?? '');
  }
  return out;
}

export function scanSources(texts: string[]): ScanResult {
  const files = new Set<string>();
  const fonts = new Set<string>();
  let usesBibliography = false;
  let biblatexBackend: string | null = null;

  for (const raw of texts) {
    const src = stripComments(raw);
    let m: RegExpExecArray | null;

    const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((m = cls.exec(src))) for (const n of list(m[1])) files.add(`${n}.cls`);

    const loadClass = /\\LoadClass(?:WithOptions)?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((m = loadClass.exec(src))) for (const n of list(m[1])) files.add(`${n}.cls`);

    const pkg = /\\(?:usepackage|RequirePackage(?:WithOptions)?)\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g;
    while ((m = pkg.exec(src))) {
      for (const n of list(m[2])) {
        files.add(`${n}.sty`);
        if (n === 'biblatex') {
          const kv = keyvals(m[1]);
          biblatexBackend = kv.get('backend') || 'biber';
          const style = kv.get('style');
          const bibstyle = kv.get('bibstyle') ?? style;
          const citestyle = kv.get('citestyle') ?? style;
          if (bibstyle) files.add(`${bibstyle}.bbx`);
          if (citestyle) files.add(`${citestyle}.cbx`);
          usesBibliography = true;
        }
        if (n === 'babel' || n === 'polyglossia') {
          for (const lang of list(m[1] ?? '')) if (!lang.includes('=')) files.add(`${lang}.ldf`);
        }
      }
    }

    const tikz = /\\usetikzlibrary\s*\{([^}]+)\}/g;
    while ((m = tikz.exec(src))) {
      for (const n of list(m[1])) {
        files.add(`tikzlibrary${n}.code.tex`);
        files.add(`pgflibrary${n}.code.tex`);
      }
    }
    const pgflib = /\\usepgflibrary\s*\{([^}]+)\}/g;
    while ((m = pgflib.exec(src))) for (const n of list(m[1])) files.add(`pgflibrary${n}.code.tex`);
    const pgfplotslib = /\\usepgfplotslibrary\s*\{([^}]+)\}/g;
    while ((m = pgfplotslib.exec(src))) for (const n of list(m[1])) files.add(`pgfplotslibrary${n}.code.tex`);
    const tcb = /\\tcbuselibrary\s*\{([^}]+)\}/g;
    while ((m = tcb.exec(src))) for (const n of list(m[1])) files.add(`tcb${n}.code.tex`);
    // Files probed with \IfFileExists (e.g. "use newtx if installed, else mathptmx"): a full
    // TeX Live has them, so fetch them when the shelf does instead of silently taking the fallback.
    const probe = /\\IfFileExists\s*\{\s*([\w.-]+\.(?:sty|cls|def|cfg|fd|bst|tex))\s*\}/g;
    while ((m = probe.exec(src))) files.add(m[1]);

    const bst = /\\bibliographystyle\s*\{([^}]+)\}/g;
    while ((m = bst.exec(src))) {
      for (const n of list(m[1])) files.add(`${n}.bst`);
      usesBibliography = true;
    }
    if (/\\(bibliography|printbibliography|addbibresource)\b/.test(src)) usesBibliography = true;

    const fontCmd = /\\(?:set(?:main|sans|mono|math)font|newfontfamily\s*\\\w+|fontspec)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((m = fontCmd.exec(src))) {
      const name = m[1].trim();
      if (/\.(otf|ttf|ttc)$/i.test(name)) files.add(name);
      else if (name) fonts.add(name);
    }
  }
  return { files, fonts, usesBibliography, biblatexBackend };
}
