import { describe, expect, it } from 'vitest';
import { scanSources, stripComments } from '../../src/engine/scan';
import { findMissing, unwrapLog } from '../../src/engine/missing';

describe('scanSources', () => {
  it('predicts classes, packages, libraries and styles', () => {
    const r = scanSources([
      String.raw`\documentclass[11pt]{IEEEtran}
% \usepackage{commented}
\usepackage[T1]{fontenc}\usepackage{amsmath, amssymb}
\RequirePackage{xcolor}
\usepackage[backend=bibtex,style=ieee]{biblatex}
\usetikzlibrary{arrows.meta, positioning}
\usepgfplotslibrary{fillbetween}
\bibliographystyle{unsrtnat}
\setmainfont{TeX Gyre Pagella}
\newfontfamily\code{inconsolata.otf}`,
    ]);
    for (const f of ['IEEEtran.cls', 'fontenc.sty', 'amsmath.sty', 'amssymb.sty', 'xcolor.sty', 'biblatex.sty', 'ieee.bbx', 'ieee.cbx',
      'tikzlibraryarrows.meta.code.tex', 'pgflibrarypositioning.code.tex', 'pgfplotslibraryfillbetween.code.tex', 'unsrtnat.bst', 'inconsolata.otf']) {
      expect(r.files.has(f), f).toBe(true);
    }
    expect(r.files.has('commented.sty')).toBe(false);
    expect(r.fonts.has('TeX Gyre Pagella')).toBe(true);
    expect(r.biblatexBackend).toBe('bibtex');
    expect(r.usesBibliography).toBe(true);
  });

  it('defaults biblatex to biber and handles babel languages', () => {
    const r = scanSources([String.raw`\usepackage{biblatex}\usepackage[ngerman,english]{babel}`]);
    expect(r.biblatexBackend).toBe('biber');
    expect(r.files.has('ngerman.ldf')).toBe(true);
  });

  it('fetches files probed with \\IfFileExists so the preferred branch is taken', () => {
    const r = scanSources([String.raw`\IfFileExists{newtxtext.sty}{\usepackage{newtxtext,newtxmath}}{\usepackage{mathptmx}}
\IfFileExists{figures/plot.pdf}{}{}`]);
    for (const f of ['newtxtext.sty', 'newtxmath.sty', 'mathptmx.sty']) expect(r.files).toContain(f);
    expect(r.files).not.toContain('figures/plot.pdf');
  });

  it('keeps escaped percent signs', () => {
    expect(stripComments('50\\% done % comment')).toBe('50\\% done ');
  });
});

describe('findMissing', () => {
  it('recognises the many ways TeX reports missing inputs', () => {
    const log = [
      "! LaTeX Error: File `tikz.sty' not found.",
      './main.tex:3: LaTeX Error: File `IEEEtran.cls\' not found.',
      "! I can't find file `chapter1'.",
      '! Font \\T1/cmr/m/n/10=ecrm1000 at 10pt not loadable: Metric (TFM) file not found.',
      '!pdfTeX error: pdflatex (file sfrm1000.pfb): cannot open Type 1 font file for reading',
      '!pdfTeX error: /bin/busytex (file tcrm1000): Font tcrm1000 at 600 not found',
      "! Package pgf Error: I did not find the tikz library 'arrows.meta'. I looked for files named tikzlibraryarrows.meta.code.tex",
      "! Package biblatex Error: File 'ieee.bbx' not found.",
      'I couldn\'t open style file IEEEtran.bst',
      "LaTeX Font Warning: Font shape `T1/lmr/m/n' undefined",
      'xdvipdfmx:warning: Could not find encoding file "cm-super-t1.enc".',
    ].join('\n');
    const { files } = findMissing(log);
    for (const f of ['tikz.sty', 'IEEEtran.cls', 'chapter1.tex', 'ecrm1000.tfm', 'sfrm1000.pfb', 'tcrm1000.pfb',
      'tikzlibraryarrows.meta.code.tex', 'ieee.bbx', 'IEEEtran.bst', 't1lmr.fd', 'cm-super-t1.enc']) {
      expect(files, f).toContain(f);
    }
  });

  it('reports fontspec fonts as fonts, not files', () => {
    const r = findMissing('! Package fontspec Error: The font "TeX Gyre Pagella" cannot be\n(fontspec)                found.');
    expect(r.fonts).toEqual(['TeX Gyre Pagella']);
  });

  it('re-joins file names split by TeX line wrapping', () => {
    const long = '! LaTeX Error: File `' + 'a'.repeat(60) + '.sty\' not found.';
    const wrapped = long.slice(0, 79) + '\n' + long.slice(79);
    expect(unwrapLog(wrapped)).toBe(long);
    expect(findMissing(wrapped).files).toContain('a'.repeat(60) + '.sty');
  });
});
