import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBibtexLog, parseTexLog, summarise, toProjectPath } from '../../src/latex/log-parser';
import { explain, passOptionsFix } from '../../src/latex/explain';
import type { Diagnostic } from '../../src/types';

const log = readFileSync(resolve(process.cwd(), 'tests/unit/fixtures/errors.log'), 'utf8');

describe('parseTexLog', () => {
  const diags = parseTexLog(log);

  it('finds file:line errors including ones in \\input files', () => {
    const errors = diags.filter((d) => d.severity === 'error');
    expect(errors.map((e) => [e.file, e.line])).toEqual([
      ['chapters/one.tex', 2],
      ['main.tex', 10],
      ['main.tex', 12],
    ]);
    expect(errors[0].message).toBe('Undefined control sequence.');
    expect(errors[1].context).toContain('\\undefinedcmd');
  });

  it('attributes warnings to the right file and line', () => {
    const ref = diags.find((d) => d.message.includes("Reference `sec:missing'"));
    expect(ref).toMatchObject({ severity: 'warning', file: 'main.tex', line: 5 });
    const cite = diags.find((d) => d.message.includes("Citation `nokey'"));
    expect(cite).toMatchObject({ severity: 'warning', file: 'main.tex', line: 5 });
  });

  it('reports overfull boxes as info', () => {
    const box = diags.find((d) => d.severity === 'info');
    expect(box).toMatchObject({ file: 'main.tex', line: 11 });
    expect(summarise(diags)).toMatchObject({ errors: 3, boxes: 1 });
  });

  it('maps paths relative to the main file directory', () => {
    expect(toProjectPath('./intro.tex', 'thesis')).toBe('thesis/intro.tex');
    expect(toProjectPath('/home/web_user/project/a/b.tex', 'x')).toBe('a/b.tex');
    expect(toProjectPath('/texlive/texmf-dist/tex/latex/base/article.cls', '')).toBeUndefined();
  });
});

describe('explain', () => {
  it('suggests the package for an undefined command', () => {
    const e = explain({ severity: 'error', message: 'Undefined control sequence.', context: 'l.7 \\includegraphics', source: 'latex' });
    expect(e?.title).toContain('\\includegraphics');
    expect(e?.fixes[0]).toMatchObject({ kind: 'addPackage', pkg: 'graphicx' });
  });

  it('offers to escape a stray ampersand', () => {
    const e = explain({ severity: 'error', message: 'Misplaced alignment tab character &.', file: 'main.tex', line: 12, source: 'latex' });
    expect(e?.fixes[0]).toMatchObject({ kind: 'replaceInLine', search: '&', replace: '\\&' });
  });

  it('suggests packages for unknown environments', () => {
    const e = explain({ severity: 'error', message: 'LaTeX Error: Environment align undefined.', source: 'latex' });
    expect(e?.fixes[0]).toMatchObject({ pkg: 'amsmath' });
  });
});

describe('parseBibtexLog', () => {
  it('extracts warnings and syntax errors', () => {
    const blg = [
      'Database file #1: refs.bib',
      'I was expecting a `,\' or a `}\'---line 5 of file refs.bib',
      ' :   title = {Oops}',
      'Warning--I didn\'t find a database entry for "missing"',
      "I couldn't open database file nothere.bib",
    ].join('\n');
    const d = parseBibtexLog(blg);
    expect(d.find((x) => x.severity === 'error' && x.line === 5)?.file).toBe('refs.bib');
    expect(d.some((x) => x.message.includes('database entry for "missing"'))).toBe(true);
    expect(d.some((x) => x.message.includes('nothere.bib'))).toBe(true);
  });
});

describe('passOptionsFix', () => {
  const doc = String.raw`%% header comment
\documentclass{article}
\usepackage{newtxtext}
% \usepackage[table]{xcolor}
\usepackage[dvipsnames,
  svgnames]{xcolor}
\begin{document}\end{document}`;

  it('passes the document’s own options before \\documentclass', () => {
    const fixed = passOptionsFix(doc, 'xcolor')!;
    expect(fixed.split('\n')[1]).toBe(String.raw`\PassOptionsToPackage{dvipsnames, svgnames}{xcolor}`);
    expect(fixed.split('\n')[2]).toBe(String.raw`\documentclass{article}`);
    expect(passOptionsFix(fixed, 'xcolor')).toBeNull();
  });

  it('does nothing without an options list', () => {
    expect(passOptionsFix(doc, 'newtxtext')).toBeNull();
  });

  it('offers the fix from the explanation', () => {
    const ex = explain({ severity: 'error', message: 'LaTeX Error: Option clash for package xcolor.', file: 'main.tex', line: 5 } as Diagnostic);
    expect(ex?.fixes).toContainEqual({ kind: 'passOptions', label: expect.any(String), pkg: 'xcolor' });
  });
});
