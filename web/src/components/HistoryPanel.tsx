/**
 * History: the project's Git commits, newest first. Expand a commit to see
 * the files it touched; click a file for its diff, from which the older
 * version can be restored into the working copy.
 */
import { useCallback, useEffect, useState } from 'react';
import { History, ChevronRight } from 'lucide-react';
import { useStore, toast } from '../state/store';
import * as server from '../storage/server';
import { timeAgo } from '../utils/misc';
import { Button, EmptyState, SectionTitle, Spinner, clsx } from './ui';
import { ChangeRow, showDiff } from './GitPanel';

export function HistoryPanel() {
  const hasGit = useStore((s) => s.project?.hasGit);
  const gitVersion = useStore((s) => s.gitVersion);
  const [commits, setCommits] = useState<server.Commit[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, server.ChangedFile[]>>({});

  const load = useCallback(async (skip: number) => {
    try {
      const page = await server.commits(skip);
      setCommits((prev) => (skip && prev ? [...prev, ...page.commits] : page.commits));
      setHasMore(page.hasMore);
      setError(null);
    } catch (err) {
      setCommits([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (hasGit) void load(0);
  }, [hasGit, gitVersion, load]);

  const toggle = async (c: server.Commit) => {
    if (open === c.hash) return setOpen(null);
    setOpen(c.hash);
    if (!files[c.hash]) {
      try {
        const res = await server.commitFiles(c.hash);
        setFiles((f) => ({ ...f, [c.hash]: res.files }));
      } catch (err) {
        toast({ kind: 'error', title: 'Could not load the commit', message: String(err) });
      }
    }
  };

  const diff = async (c: server.Commit, f: server.ChangedFile) => {
    try {
      const d = await server.commitFile(c.hash, f.path, f.oldPath);
      // "Restore" puts the version from before this commit back, i.e. undoes it for this file.
      showDiff(`${f.path} — ${c.short} ${c.message}`, d, f.status !== 'A');
    } catch (err) {
      toast({ kind: 'error', title: 'Could not load the diff', message: String(err) });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <SectionTitle>History</SectionTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {!hasGit ? (
          <EmptyState icon={<History className="size-8" />} title="No history yet">
            This project is not a Git repository. Initialize one from Source control to start recording versions.
          </EmptyState>
        ) : commits === null ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : !commits.length ? (
          <EmptyState icon={<History className="size-8" />} title="No commits yet">
            {error ?? 'Commit from Source control to record the first version.'}
          </EmptyState>
        ) : (
          <>
            {commits.map((c) => (
              <div key={c.hash} className="mb-0.5">
                <button onClick={() => void toggle(c)} className={clsx('flex w-full items-start gap-1.5 rounded-md px-1.5 py-1.5 text-left', open === c.hash ? 'bg-accent/10' : 'hover:bg-hover')}>
                  <ChevronRight className={clsx('mt-0.5 size-3.5 shrink-0 text-faint transition-transform', open === c.hash && 'rotate-90')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{c.message || '(no message)'}</span>
                    <span className="block truncate text-[11px] text-faint">
                      <code className={clsx(c.isHead && 'text-accent')}>{c.short}</code> · {c.author} · <span title={new Date(c.date).toLocaleString()}>{timeAgo(Date.parse(c.date))}</span>
                    </span>
                  </span>
                </button>
                {open === c.hash && (
                  <div className="pb-1 pl-4">
                    {!files[c.hash] ? <Spinner className="m-2 size-3" /> : files[c.hash].map((f) => <ChangeRow key={f.path} file={f} onClick={() => void diff(c, f)} />)}
                  </div>
                )}
              </div>
            ))}
            {hasMore && (
              <div className="p-2">
                <Button size="sm" variant="ghost" onClick={() => void load(commits.length)}>Load older commits</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
