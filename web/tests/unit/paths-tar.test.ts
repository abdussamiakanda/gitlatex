import { describe, expect, it } from 'vitest';
import { basename, dirname, extname, isTextPath, languageFor, normalisePath, relativePath } from '../../src/utils/paths';
import { parseTar } from '../../src/engine/tar';
// @ts-expect-error build-time JS module without types
import { createTar } from '../../scripts/lib/tar.mjs';

describe('paths', () => {
  it('normalises and rejects traversal', () => {
    expect(normalisePath('./a//b/./c.tex')).toBe('a/b/c.tex');
    expect(normalisePath('a\\b.tex')).toBe('a/b.tex');
    expect(normalisePath('../etc/passwd')).toBeNull();
    expect(normalisePath('')).toBeNull();
  });
  it('splits names', () => {
    expect(basename('a/b/c.tex')).toBe('c.tex');
    expect(dirname('a/b/c.tex')).toBe('a/b');
    expect(extname('fig.PNG')).toBe('png');
    expect(isTextPath('refs.bib')).toBe(true);
    expect(isTextPath('fig.png')).toBe(false);
    expect(languageFor('x.sty')).toBe('latex');
  });
  it('computes relative include paths', () => {
    expect(relativePath('main.tex', 'images/a.png')).toBe('images/a.png');
    expect(relativePath('chapters/one.tex', 'images/a.png')).toBe('../images/a.png');
  });
});

describe('tar', () => {
  it('round-trips files, including long paths', () => {
    const long = 'fonts/type1/public/' + 'x'.repeat(70) + '/' + 'y'.repeat(60) + '.pfb';
    const entries = [
      { path: 'tex/latex/pgf/pgf.sty', data: new TextEncoder().encode('\\ProvidesPackage{pgf}') },
      { path: long, data: new Uint8Array(1000).fill(7) },
      { path: 'empty.txt', data: new Uint8Array() },
    ];
    const back = parseTar(createTar(entries));
    expect(back.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    expect(back[1].data).toEqual(entries[1].data);
    expect(new TextDecoder().decode(back[0].data)).toBe('\\ProvidesPackage{pgf}');
  });
});
