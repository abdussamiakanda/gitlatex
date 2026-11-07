import { describe, expect, it } from 'vitest';
import { childCandidates, childCommand, findChild, leaveChild, parentOf, rememberChild } from '../../src/lyx/children';

describe('childCommand', () => {
  it('reads a box that is only a child command', () => {
    expect(childCommand(' \\input{chapters/one} ')).toEqual({ cmd: 'input', file: 'chapters/one' });
    expect(childCommand('\\include{intro}')).toEqual({ cmd: 'include', file: 'intro' });
    expect(childCommand('\\input{a} more')).toBeNull();
  });
});

describe('childCandidates / findChild', () => {
  it('looks relative to the main file, adding .tex as TeX does', () => {
    expect(childCandidates({ cmd: 'input', file: 'ch/one' }, 'paper/main.tex', 'paper/main.tex')).toEqual(['paper/ch/one.tex', 'paper/ch/one']);
    expect(childCandidates({ cmd: 'include', file: 'one.tex' }, 'main.tex', 'main.tex')).toEqual(['one.tex.tex']);
    expect(childCandidates({ cmd: 'input', file: '../x' }, 'main.tex', 'main.tex')).toEqual([]);
  });
  it('resolves \\subfile from its own folder first', () => {
    const exists = (p: string) => p === 'ch/sec.tex';
    expect(findChild({ cmd: 'subfile', file: 'sec' }, 'ch/one.tex', 'main.tex', exists)).toBe('ch/sec.tex');
  });
});

describe('parentOf', () => {
  const files = [
    { path: 'main.tex', text: '\\documentclass{book}\n\\begin{document}\n% \\input{ch/one}\n\\input{ch/one}\n\\end{document}\n' },
    { path: 'ch/one.tex', text: 'One.\n' },
    { path: 'other.tex', text: '\\input{ch/one}\n' },
  ];
  it('finds the main file first, skipping commented-out commands', () => {
    expect(parentOf('ch/one.tex', files, 'main.tex')).toEqual({ parent: 'main.tex', line: 4 });
    expect(parentOf('main.tex', files, 'main.tex')).toBeNull();
  });
  it('prefers the document the child was opened from, until you go back', () => {
    rememberChild('other.tex', 'ch/one.tex');
    expect(parentOf('ch/one.tex', files, 'main.tex')).toEqual({ parent: 'other.tex', line: 1 });
    leaveChild('ch/one.tex', 'other.tex');
    expect(parentOf('ch/one.tex', files, 'main.tex')?.parent).toBe('main.tex');
  });
});
