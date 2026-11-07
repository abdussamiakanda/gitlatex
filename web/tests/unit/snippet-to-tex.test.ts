import { describe, expect, it } from 'vitest';
import { snippetToTex } from '../../src/editor/bridge';

describe('snippetToTex', () => {
  it('fills placeholders with their defaults and selects the first', () => {
    expect(snippetToTex('\\subsection{${1:Title}}\n$0')).toEqual({ tex: '\\subsection{Title}\n', select: 'Title' });
    expect(snippetToTex('\\textbf{${1:text}}$0')).toEqual({ tex: '\\textbf{text}', select: 'text' });
  });

  it('leaves out a label made of placeholders', () => {
    expect(snippetToTex('\\section{${1:Title}}\\label{sec:${2:label}}\n$0')).toEqual({ tex: '\\section{Title}\n', select: 'Title' });
  });

  it('reads snippet escapes, so a LaTeX line break stays one', () => {
    expect(snippetToTex('a \\\\\\\\ b \\$5').tex).toBe('a \\\\ b $5');
  });

  it('takes the first option of a choice, and skips placeholders hidden in [options]', () => {
    expect(snippetToTex('\\textcolor{${1|red,blue|}}{${2:text}}$0')).toEqual({ tex: '\\textcolor{red}{text}', select: 'text' });
    expect(snippetToTex('\\begin{enumerate}[label=${1:(a)}]\n\\item ${2:First}\n\\end{enumerate}').select).toBe('First');
  });

  it('fills a repeated tab stop with its placeholder, and does not select a mirrored one', () => {
    expect(snippetToTex('\\begin{${1|block,alertblock|}}{${2:Title}}\n\t${3:Content}\n\\end{$1}\n$0')).toEqual({
      tex: '\\begin{block}{Title}\n\tContent\n\\end{block}\n',
      select: 'Title',
    });
  });

  it('keeps plain text as it is', () => {
    expect(snippetToTex('\\maketitle\n')).toEqual({ tex: '\\maketitle\n', select: undefined });
  });
});
