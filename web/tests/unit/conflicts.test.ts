import { describe, expect, it } from 'vitest';
import { findConflicts, resolvedText } from '../../src/editor/conflict-blocks';

const doc = [
  'intro',
  '<<<<<<< HEAD',
  'our line',
  '=======',
  'their line 1',
  'their line 2',
  '>>>>>>> origin/main',
  'middle',
  '<<<<<<< HEAD',
  'ours with base',
  '||||||| merged common ancestors',
  'the base',
  '=======',
  'theirs with base',
  '>>>>>>> feature',
  'outro',
];

describe('merge conflict blocks', () => {
  const conflicts = findConflicts(doc);

  it('finds each block with its marker lines and labels', () => {
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]).toMatchObject({ start: 2, base: null, mid: 4, end: 7, currentLabel: 'HEAD', incomingLabel: 'origin/main' });
    expect(conflicts[1]).toMatchObject({ start: 9, base: 11, mid: 13, end: 15, incomingLabel: 'feature' });
  });

  it('resolves to current, incoming or both (diff3 base dropped)', () => {
    expect(resolvedText(doc, conflicts[0], 'current')).toEqual(['our line']);
    expect(resolvedText(doc, conflicts[0], 'incoming')).toEqual(['their line 1', 'their line 2']);
    expect(resolvedText(doc, conflicts[0], 'both')).toEqual(['our line', 'their line 1', 'their line 2']);
    expect(resolvedText(doc, conflicts[1], 'current')).toEqual(['ours with base']);
    expect(resolvedText(doc, conflicts[1], 'both')).toEqual(['ours with base', 'theirs with base']);
  });

  it('ignores an unterminated block and a stray separator', () => {
    expect(findConflicts(['<<<<<<< HEAD', 'x', '======='])).toEqual([]);
    expect(findConflicts(['=======', 'text', '>>>>>>> x'])).toEqual([]);
  });
});
