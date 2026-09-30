import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyncTex, resolveInputs } from '../../src/latex/synctex';

const text = readFileSync(resolve(process.cwd(), 'tests/unit/fixtures/sample.synctex'), 'utf8');

describe('SyncTex', () => {
  const s = SyncTex.parse(text);

  it('maps inputs to project paths', () => {
    expect(s.inputs.get(1)).toBe('main.tex');
    expect(s.inputs.get(10)).toBe('chapters/one.tex');
    expect(s.inputs.has(2)).toBe(false); // article.cls is a TeX Live file
  });

  it('forward search finds the line on page 1 in PDF points', () => {
    const rects = s.forward('main.tex', 5);
    expect(rects).toHaveLength(1);
    const r = rects[0];
    expect(r.page).toBe(1);
    // Letter paper is 612×792 bp; text lives inside the margins.
    expect(r.x).toBeGreaterThan(50);
    expect(r.x + r.w).toBeLessThan(612);
    expect(r.y).toBeGreaterThan(50);
    expect(r.y).toBeLessThan(400);
  });

  it('inverse search round-trips a forward result', () => {
    const r = s.forward('chapters/one.tex', 2)[0];
    const hit = s.inverse(r.page, r.x + 5, r.y + r.h / 2);
    expect(hit).toEqual({ file: 'chapters/one.tex', line: 2 });
  });

  it('falls back to the nearest line with output', () => {
    const rects = s.forward('main.tex', 3); // \begin{document} produces nothing itself
    expect(rects.length).toBeGreaterThan(0);
  });
});

describe('SyncTeX input paths from any compiler', () => {
  const files = ['main.tex', 'chapters/one.tex', 'figures/plot.tex', 'refs.bib'];
  const resolveAll = (inputs: string[], mainFile = 'main.tex') =>
    [...resolveInputs(new Map(inputs.map((p, i) => [i + 1, p])), mainFile.includes('/') ? mainFile.slice(0, mainFile.lastIndexOf('/')) : '', { mainFile, files }).entries()];

  it('maps the in-browser engine paths', () => {
    expect(resolveAll(['/home/web_user/project/./main.tex', '/home/web_user/project/./chapters/one.tex'])).toEqual([
      [1, 'main.tex'],
      [2, 'chapters/one.tex'],
    ]);
  });

  it('maps a local Windows TeX (backslashes, drive letter, any case)', () => {
    expect(
      resolveAll(['C:\\Users\\me\\repos\\Paper\\./main.tex', 'C:\\Users\\me\\repos\\Paper\\./Chapters\\One.tex', 'C:\\texlive\\2024\\texmf-dist\\tex\\latex\\base\\article.cls']),
    ).toEqual([
      [1, 'main.tex'],
      [2, 'chapters/one.tex'],
    ]);
  });

  it('maps a local macOS/Linux TeX and a Compiler API temp folder', () => {
    expect(resolveAll(['/Users/me/repos/paper/./main.tex', '/Users/me/repos/paper/./chapters/one.tex'])).toEqual([
      [1, 'main.tex'],
      [2, 'chapters/one.tex'],
    ]);
    expect(resolveAll(['/tmp/tmpa8f3/./main.tex', '/tmp/tmpa8f3/./figures/plot.tex', '/usr/share/texlive/texmf-dist/tex/latex/base/size10.clo'])).toEqual([
      [1, 'main.tex'],
      [2, 'figures/plot.tex'],
    ]);
  });

  it('handles a main file in a subfolder and relative inputs', () => {
    const r = [...resolveInputs(new Map([[1, '/srv/x/./thesis/main.tex'], [2, './intro.tex'], [3, '/srv/x/./thesis/intro.tex']]), 'thesis', { mainFile: 'thesis/main.tex', files: ['thesis/main.tex', 'thesis/intro.tex'] }).entries()];
    expect(r).toEqual([
      [1, 'thesis/main.tex'],
      [2, 'thesis/intro.tex'],
      [3, 'thesis/intro.tex'],
    ]);
  });

  it('falls back to the longest matching project file when the main file is not listed', () => {
    expect(resolveAll(['/elsewhere/build/chapters/one.tex'])).toEqual([[1, 'chapters/one.tex']]);
    expect(resolveAll(['/usr/share/texlive/texmf-dist/tex/latex/amsmath/amsmath.sty'])).toEqual([]);
  });
});
