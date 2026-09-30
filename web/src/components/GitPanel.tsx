/**
 * Source control: the project's Git status, its uncommitted changes (click one
 * for a diff), and commit / push / pull. Everything runs through the gitlatex
 * server against the real repository on disk.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, GitBranch, GitCommitHorizontal, RefreshCw, FolderGit2 } from 'lucide-react';
import { useStore, openDialog, toast } from '../state/store';
import { gitCommit, gitInit, gitPull, gitPush, restoreFileContent } from '../state/actions';
import * as server from '../storage/server';
import { Button, EmptyState, IconButton, SectionTitle, Spinner, clsx } from './ui';
import { FileIcon } from './FileIcon';

const STATUS_STYLE: Record<server.ChangedFile['status'], string> = {
  A: 'text-emerald-500',
  M: 'text-amber-500',
  D: 'text-danger',
  R: 'text-sky-500',
};

export function ChangeRow({ file, onClick }: { file: server.ChangedFile; onClick: () => void }) {
  const name = file.path.split('/').pop()!;
  const dir = file.path.slice(0, -name.length).replace(/\/$/, '');
  return (
    <button onClick={onClick} className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-hover" title={file.path}>
      <FileIcon path={file.path} />
      <span className={clsx('truncate', file.status === 'D' ? 'text-muted line-through' : 'text-fg')}>{name}</span>
      {dir && <span className="truncate text-[11px] text-faint">{dir}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
        {file.insertions > 0 && <span className="text-emerald-500">+{file.insertions}</span>}
        {file.deletions > 0 && <span className="text-danger">−{file.deletions}</span>}
        <span className={clsx('w-3 text-center font-semibold', STATUS_STYLE[file.status])}>{file.status}</span>
      </span>
    </button>
  );
}

/** Open a side-by-side diff; `restore` puts the left-hand text back into the file. */
export function showDiff(title: string, diff: server.FileDiff, restore?: boolean) {
  if (diff.binary) {
    toast({ kind: 'info', title: 'Binary file', message: `${diff.path} cannot be shown as a text diff.` });
    return;
  }
  openDialog({
    type: 'diff',
    title,
    path: diff.path,
    original: diff.before,
    modified: diff.after,
    onRestore: restore ? () => restoreFileContent(diff.path, diff.before) : undefined,
  });
}

export function GitPanel() {
  const project = useStore((s) => s.project);
  const gitVersion = useStore((s) => s.gitVersion);
  const contentVersion = useStore((s) => s.contentVersion);
  const treeVersion = useStore((s) => s.treeVersion);
  const [status, setStatus] = useState<server.GitStatus | null>(null);
  const [remote, setRemote] = useState<server.RemoteStatus | null>(null);
  const [changes, setChanges] = useState<server.ChangedFile[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!project?.hasGit) return;
    try {
      const st = await server.gitStatus();
      setStatus(st);
      setChanges(st.hasCommits ? await server.workingFiles() : [...st.untracked, ...st.modified].map((path) => ({ path, oldPath: null, status: 'A' as const, insertions: 0, deletions: 0 })));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [project?.hasGit]);

  // Local status is cheap: refresh whenever files change (after they are saved).
  useEffect(() => {
    const t = setTimeout(() => void reload(), 900);
    return () => clearTimeout(t);
  }, [reload, gitVersion, contentVersion, treeVersion]);

  // Remote status fetches from origin, so only on open and after Git actions.
  useEffect(() => {
    if (!project?.hasGit) return;
    let live = true;
    server
      .remoteStatus()
      .then((r) => live && setRemote(r))
      .catch(() => live && setRemote(null));
    return () => {
      live = false;
    };
  }, [project?.hasGit, gitVersion]);

  const run = async (label: string, fn: () => Promise<boolean | void>) => {
    setBusy(label);
    try {
      if ((await fn()) !== false && label !== 'Pull') setMessage('');
    } finally {
      setBusy(null);
    }
  };

  if (!project) return null;

  if (!project.hasGit) {
    return (
      <div className="flex h-full flex-col">
        <SectionTitle>Source control</SectionTitle>
        <EmptyState icon={<FolderGit2 className="size-8" />} title="Not a Git repository">
          Track versions of this project with Git, then push it to GitHub, GitLab or any remote.
          <div className="mt-3">
            <Button size="sm" variant="primary" icon={<GitBranch className="size-3.5" />} onClick={() => void gitInit()}>
              Initialize repository
            </Button>
          </div>
        </EmptyState>
      </div>
    );
  }

  const hasRemote = remote?.hasRemote ?? true;
  const behind = remote?.behind ?? status?.behind ?? 0;
  const ahead = remote?.ahead ?? status?.ahead ?? 0;

  return (
    <div className="flex h-full flex-col">
      <SectionTitle actions={<IconButton size="sm" label="Refresh" onClick={() => void reload()}><RefreshCw className="size-3.5" /></IconButton>}>Source control</SectionTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 text-[13px]">
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-2">
          <GitBranch className="size-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-fg">{status?.detached ? 'Detached HEAD' : (status?.current ?? '…')}</div>
            <div className="truncate text-[11px] text-muted">
              {!hasRemote ? 'No remote configured' : remote?.tracking ? `Tracking ${remote.tracking}` : remote ? 'No upstream branch' : 'Checking the remote…'}
            </div>
          </div>
          {hasRemote && (ahead > 0 || behind > 0) && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted" title={`${behind} to pull, ${ahead} to push`}>
              ↓{behind} ↑{ahead}
            </span>
          )}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message"
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              void run('Commit', () => gitCommit(message.trim()));
            }
          }}
          className="focus-ring w-full resize-y rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[13px] text-fg placeholder:text-faint"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" icon={<GitCommitHorizontal className="size-3.5" />} loading={busy === 'Commit'} disabled={!!busy || !changes.length} onClick={() => void run('Commit', () => gitCommit(message.trim()))}>
            Commit
          </Button>
          {hasRemote && (
            <>
              <Button size="sm" icon={<ArrowUpFromLine className="size-3.5" />} loading={busy === 'Push'} disabled={!!busy} onClick={() => void run('Push', () => gitPush(message.trim()))} title="Commit any changes, then push">
                {changes.length ? 'Commit & push' : 'Push'}
              </Button>
              <Button size="sm" icon={<ArrowDownToLine className="size-3.5" />} loading={busy === 'Pull'} disabled={!!busy} onClick={() => void run('Pull', gitPull)}>
                Pull{behind ? ` (${behind})` : ''}
              </Button>
            </>
          )}
        </div>

        <div className="mb-1 mt-5 flex items-center text-[11px] font-semibold uppercase tracking-wider text-muted">
          Changes
          <span className="ml-1.5 rounded-full bg-panel-2 px-1.5 text-[10px] tabular-nums">{changes.length}</span>
          {!status && !error && <Spinner className="ml-auto size-3" />}
        </div>
        {error && <p className="px-2 text-xs text-danger">{error}</p>}
        {status && !changes.length && <p className="px-2 py-1 text-xs text-faint">No uncommitted changes.</p>}
        {changes.map((f) => (
          <ChangeRow
            key={f.path}
            file={f}
            onClick={() =>
              void server
                .workingFile(f.path)
                .then((d) => showDiff(`${f.path} — last commit ↔ working copy`, d, f.status !== 'A'))
                .catch((err: unknown) => toast({ kind: 'error', title: 'Could not load the diff', message: String(err) }))
            }
          />
        ))}
      </div>
    </div>
  );
}
