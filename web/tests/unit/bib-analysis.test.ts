import { describe, expect, it } from 'vitest';
import { formatEntry, parseBib } from '../../src/latex/bib';
import { labels, loadedPackages, outline, packageInsertion, userMacros, wordCount } from '../../src/latex/analysis';

describe('parseBib', () => {
  it('parses braces, quotes, nesting and bare values', () => {
    const entries = parseBib(`
@comment{ignored}
@Article{smith2020,
  author = {Smith, John and Doe, Jane},
  title = "A {Nested} Title",
  journal = {J. of {\\LaTeX}},
  year = 2020,
}
@book{knuth, title={The {\\TeX}book}, year={1984}}`, 'refs.bib');
    expect(entries.map((e) => e.key)).toEqual(['smith2020', 'knuth']);
    expect(entries[0]).toMatchObject({ type: 'article', line: 3, file: 'refs.bib' });
    expect(entries[0].fields.title).toBe('A Nested Title');
    expect(entries[0].fields.year).toBe('2020');
    expect(formatEntry(entries[0])).toContain('Smith, Doe (2020)');
  });

  it('survives malformed input', () => {
    expect(() => parseBib('@article{broken, title = {unterminated')).not.toThrow();
  });
});

describe('analysis', () => {
  const files = [
    {
      path: 'main.tex',
      text: String.raw`\documentclass{article}
\usepackage{amsmath}
\newcommand{\R}{\mathbb{R}}
\newcommand\vect[1]{\mathbf{#1}}
\newenvironment{note}{}{}
\begin{document}
\section{Intro}\label{sec:intro}
% \section{Commented}
Some words here $x^2$ and \textbf{bold}.
\subsection*{Details}
\end{document}`,
    },
  ];

  it('builds an outline with labels', () => {
    expect(outline(files)).toEqual([
      expect.objectContaining({ kind: 'section', title: 'Intro', line: 7, label: 'sec:intro' }),
      expect.objectContaining({ kind: 'subsection*', title: 'Details', line: 10 }),
    ]);
  });

  it('collects labels and macros', () => {
    expect(labels(files).map((l) => l.label)).toEqual(['sec:intro']);
    const macros = userMacros(files);
    expect(macros).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'R', args: 0 }),
      expect.objectContaining({ name: 'vect', args: 1 }),
      expect.objectContaining({ name: 'note', kind: 'environment' }),
    ]));
  });

  it('inserts packages after the last \\usepackage, before hyperref', () => {
    const src = files[0].text;
    expect(packageInsertion(src, 'amsmath')).toBeNull();
    expect(packageInsertion(src, 'booktabs')).toEqual({ line: 3, text: '\\usepackage{booktabs}\n' });
    const withHyper = '\\documentclass{article}\n\\usepackage{a}\n\\usepackage{hyperref}\n\\begin{document}\\end{document}';
    expect(packageInsertion(withHyper, 'graphicx')).toEqual({ line: 3, text: '\\usepackage{graphicx}\n' });
    expect(packageInsertion('no preamble here', 'x')).toBeNull();
    expect(loadedPackages(src).has('amsmath')).toBe(true);
  });

  it('counts words in the body only', () => {
    expect(wordCount(files[0].text)).toBe(7); // Intro Some words here and bold Details
  });
});
