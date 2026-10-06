import { describe, expect, it } from 'vitest';
import { remoteLabel } from '../../src/utils/misc';

describe('remoteLabel', () => {
  it('shortens https and scp-style remotes', () => {
    expect(remoteLabel('https://github.com/owner/repo.git')).toBe('github.com/owner/repo');
    expect(remoteLabel('git@github.com:owner/repo.git')).toBe('github.com/owner/repo');
    expect(remoteLabel('ssh://git@gitlab.com/group/sub/repo')).toBe('gitlab.com/group/sub/repo');
  });

  it('never shows credentials', () => {
    expect(remoteLabel('https://user:ghp_secret@github.com/owner/repo.git')).toBe('github.com/owner/repo');
    expect(remoteLabel('https://ghp_secret@github.com/owner/repo')).toBe('github.com/owner/repo');
  });

  it('keeps local paths readable', () => {
    expect(remoteLabel('/srv/git/paper.git')).toBe('/srv/git/paper');
  });
});
