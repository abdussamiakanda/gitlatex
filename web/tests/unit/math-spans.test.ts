import { describe, expect, it } from 'vitest';
import { findMath } from '../../src/editor/math-spans';

describe('findMath', () => {
  it('finds every kind of formula, with offsets of the whole source', () => {
    const text = 'a $x^2$ b \\(y\\) c\n$$\n\\int f\n$$\n\\begin{align}a&=b\\label{e}\\end{align}';
    const spans = findMath(text);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['$x^2$', '\\(y\\)', '$$\n\\int f\n$$', '\\begin{align}a&=b\\label{e}\\end{align}']);
    expect(spans.map((s) => s.display)).toEqual([false, false, true, true]);
    expect(spans[3].tex).toBe('\\begin{aligned}a&=b\\end{aligned}');
  });

  it('skips comments, escaped dollars and math inside another formula; keeps empty ones', () => {
    expect(findMath('costs \\$5 % and $x$ here')).toEqual([]);
    expect(findMath('$ $ and \\[ \\]').map((s) => s.tex)).toEqual(['', '']);
    expect(findMath('\\begin{equation}$a$\\end{equation}')).toHaveLength(1);
  });

  it('does not pair a stray \\begin with the next environment\'s \\end', () => {
    const text = '\\begin{equation}\n\\begin{equation}\nx\n\\end{equation}';
    expect(findMath(text).map((s) => text.slice(s.start, s.end))).toEqual(['\\begin{equation}\nx\n\\end{equation}']);
  });
});
