/**
 * Source control, modelled on VS Code's: branch, a commit box whose button
 * does the next sensible thing (Commit, Commit merge, Sync, Publish), and the
 * Merge Changes / Staged Changes / Changes lists with per-file actions.
 * Everything runs against the real repository through gitlatex/routes/scm.py.
 */
import { useEffect, useState } from 'react';
import {
  ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, ChevronRight, CloudUpload, FileText, FolderGit2, GitBranch, GitMerge, Minus, MoreHorizontal, Plus, RefreshCw, RotateCcw, Undo2,
} from 'lucide-react';
import { useStore, openDialog, toast } from '../state/store';
import {
  gitInit, openFile, openPublishDialog, promptCreateBranch, refreshScm, restoreFileContent, scmAbort, scmCheckout, scmCommit, scmDiscard, scmFetch, scmMarkResolved, scmPull, scmPush, scmResolve, scmStage, scmSync,
  scmUnstage, workspace,
} from '../state/actions';
import * as server from '../storage/server';
import { modKey } from '../utils/misc';
import { Button, EmptyState, IconButton, SectionTitle, Spinner, clsx, useMenu, type MenuItem } from './ui';
import { FileIcon } from './FileIcon';

const STATUS_STYLE: Record<string, string> = {
  A: 'text-emerald-500',
  M: 'text-amber-500',
  D: 'text-danger',
  R: 'text-sky-500',
  T: 'text-amber-500',
  '?': 'text-emerald-500',
  U: 'text-danger',
};

const STATUS_TITLE: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', T: 'Type changed', '?': 'Untracked', U: 'Conflict' };

/** A file row in the History panel (commits). */
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

type Section = 'conflicts' | 'staged' | 'changes';

function ScmRow({ file, section, busy, sides }: { file: server.ScmFile; section: Section; busy: boolean; sides?: server.ScmStatus['sides'] }) {
  const name = file.path.split('/').pop()!;
  const dir = file.path.slice(0, -name.length).replace(/\/$/, '');
  const letter = file.status === '?' ? 'U' : file.status;
  const canOpen = !!workspace()?.get(file.path) && workspace()?.get(file.path)?.kind === 'text';

  const open = () => {
    if (section === 'conflicts') {
      if (canOpen) openFile(file.path);
      else toast({ kind: 'info', title: `${name} is not a text file`, message: 'Take the current or the incoming version with the buttons on its row.' });
      return;
    }
    void server.scm
      .diff(file.path, section === 'staged')
      .then((d) =>
        showDiff(
          section === 'staged' ? `${file.path} (Index) — HEAD ↔ staged` : `${file.path} (Working Tree) — ${file.status === '?' ? 'new file' : 'staged ↔ working copy'}`,
          d,
          section === 'changes' && file.status !== '?',
        ),
      )
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not load the diff', message: String(err) }));
  };

  const act = (label: string, icon: React.ReactNode, run: () => void, danger = false) => (
    <IconButton
      size="sm"
      danger={danger}
      label={label}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      {icon}
    </IconButton>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      title={`${file.path} · ${file.label ?? STATUS_TITLE[file.status] ?? file.status}`}
      className="group flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover"
    >
      <FileIcon path={file.path} />
      <span className={clsx('min-w-0 truncate', file.status === 'D' ? 'text-muted line-through' : 'text-fg')}>{name}</span>
      {dir && <span className="min-w-0 truncate text-[11px] text-faint">{dir}</span>}
      <span className="ml-auto hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
        {canOpen && section !== 'conflicts' && act('Open file', <FileText className="size-3.5" />, () => openFile(file.path))}
        {section === 'conflicts' && (
          <>
            {act(`Take ${sides?.current ?? 'current'} for the whole file`, <span className="text-[10px] font-semibold">Cur</span>, () => void scmResolve(file.path, 'current'))}
            {act(`Take ${sides?.incoming ?? 'incoming'} for the whole file`, <span className="text-[10px] font-semibold">Inc</span>, () => void scmResolve(file.path, 'incoming'))}
            {act('Mark resolved (stage)', <Check className="size-3.5" />, () => void scmMarkResolved(file.path))}
          </>
        )}
        {section === 'changes' && act('Discard changes', <Undo2 className="size-3.5" />, () => scmDiscard([file]), true)}
        {section === 'changes' && act('Stage changes', <Plus className="size-3.5" />, () => void scmStage([file.path]))}
        {section === 'staged' && act('Unstage changes', <Minus className="size-3.5" />, () => void scmUnstage([file.path]))}
      </span>
      <span className={clsx('w-3 shrink-0 text-center text-[11px] font-semibold', STATUS_STYLE[file.status])}>{letter}</span>
    </div>
  );
}

function FileSection({
  title,
  section,
  files,
  busy,
  actions,
  sides,
}: {
  title: string;
  section: Section;
  files: server.ScmFile[];
  busy: boolean;
  actions?: React.ReactNode;
  sides?: server.ScmStatus['sides'];
}) {
  const [open, setOpen] = useState(true);
  if (!files.length) return null;
  return (
    <div className="mt-2">
      <div className="group flex h-6 cursor-pointer select-none items-center gap-1 rounded px-1 text-[11px] font-semibold uppercase tracking-wider text-muted hover:bg-hover" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="flex-1 truncate">{title}</span>
        <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
        <span className="rounded-full bg-panel-2 px-1.5 text-[10px] tabular-nums">{files.length}</span>
      </div>
      {open && files.map((f) => <ScmRow key={`${section}:${f.path}`} file={f} section={section} busy={busy} sides={sides} />)}
    </div>
  );
}

export function GitPanel() {
  const project = useStore((s) => s.project);
  const st = useStore((s) => s.scm);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const moreMenu = useMenu();
  const branchMenu = useMenu();

  useEffect(() => {
    void refreshScm();
  }, [project?.id, project?.hasGit]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
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
          Track versions of this project with Git, then publish it to GitHub, GitLab or any remote.
          <div className="mt-3">
            <Button size="sm" variant="primary" icon={<GitBranch className="size-3.5" />} onClick={() => void gitInit()}>
              Initialize repository
            </Button>
          </div>
        </EmptyState>
      </div>
    );
  }

  if (!st) {
    return (
      <div className="flex h-full flex-col">
        <SectionTitle>Source control</SectionTitle>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </div>
    );
  }

  const conflicts = st.conflicts;
  const hasChanges = st.staged.length + st.changes.length > 0;
  const merging = !!st.inProgress;
  const abortLabel = st.inProgress === 'autostash' ? 'pull' : st.inProgress;
  const noRemote = st.remotes.length === 0;
  const branchLabel = st.detached ? 'detached HEAD' : (st.branch ?? '…');
  const branchShown = st.inProgress === 'rebase' ? `${branchLabel} (rebasing)` : branchLabel;

  const commit = () => void run('commit', async () => (await scmCommit(message.trim())) && setMessage(''));

  // The primary button does the next sensible thing, like VS Code's.
  let primary: { label: string; icon: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string };
  if (conflicts.length) primary = { label: `Resolve ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} to commit`, icon: <GitMerge className="size-3.5" />, disabled: true };
  else if (merging && st.inProgress !== 'autostash') primary = { label: st.inProgress === 'rebase' ? 'Continue rebase' : 'Commit merge', icon: <Check className="size-3.5" />, onClick: commit };
  else if (hasChanges) primary = { label: st.staged.length ? 'Commit' : 'Commit all', icon: <Check className="size-3.5" />, onClick: commit, title: st.staged.length ? 'Commit the staged changes' : 'Nothing is staged: commit every change' };
  else if (!st.hasCommits) primary = { label: 'Commit', icon: <Check className="size-3.5" />, disabled: true };
  else if (noRemote || !st.upstream) primary = { label: 'Publish branch', icon: <CloudUpload className="size-3.5" />, onClick: noRemote ? openPublishDialog : () => void run('push', scmPush) };
  else if (st.ahead || st.behind) primary = { label: `Sync changes ${st.behind}↓ ${st.ahead}↑`, icon: <RefreshCw className="size-3.5" />, onClick: () => void run('sync', scmSync) };
  else primary = { label: 'Commit', icon: <Check className="size-3.5" />, disabled: true };

  const moreItems = (): (MenuItem | 'separator')[] => {
    const remote = !noRemote;
    const items: (MenuItem | 'separator')[] = [
      { label: 'Pull', icon: <ArrowDownToLine className="size-3.5" />, disabled: !remote || !st.upstream, onSelect: () => void run('pull', scmPull) },
      { label: 'Push', icon: <ArrowUpFromLine className="size-3.5" />, disabled: !remote || !st.hasCommits, onSelect: () => void run('push', scmPush) },
      { label: 'Sync', icon: <RefreshCw className="size-3.5" />, disabled: !remote || !st.upstream, onSelect: () => void run('sync', scmSync) },
      { label: 'Fetch', icon: <RefreshCw className="size-3.5" />, disabled: !remote, onSelect: () => void run('fetch', scmFetch) },
      'separator',
      { label: 'Stage all changes', icon: <Plus className="size-3.5" />, disabled: !st.changes.length, onSelect: () => void scmStage() },
      { label: 'Unstage all changes', icon: <Minus className="size-3.5" />, disabled: !st.staged.length, onSelect: () => void scmUnstage() },
      { label: 'Discard all changes…', icon: <Undo2 className="size-3.5" />, danger: true, disabled: !st.changes.length, onSelect: () => scmDiscard(st.changes) },
      'separator',
      { label: 'Create branch…', icon: <GitBranch className="size-3.5" />, disabled: !st.hasCommits, onSelect: promptCreateBranch },
      { label: noRemote ? 'Publish to a remote…' : 'Change remote (publish)…', icon: <CloudUpload className="size-3.5" />, disabled: !st.hasCommits, onSelect: openPublishDialog },
    ];
    if (merging) items.push('separator', { label: `Abort ${abortLabel}`, icon: <RotateCcw className="size-3.5" />, danger: true, onSelect: scmAbort });
    return items;
  };

  const openBranchMenu = async (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    let list: { local: string[]; remote: string[] } = { local: [], remote: [] };
    try {
      list = await server.scm.branches();
    } catch {
      /* show what we can */
    }
    const localNames = new Set(list.local);
    const remoteOnly = list.remote.filter((r) => !localNames.has(r.slice(r.indexOf('/') + 1)));
    const items: (MenuItem | 'separator')[] = [
      { label: 'Create new branch…', icon: <Plus className="size-3.5" />, disabled: !st.hasCommits, onSelect: promptCreateBranch },
      'separator',
      ...list.local.map<MenuItem>((b) => ({
        label: b,
        icon: b === st.branch ? <Check className="size-3.5 text-accent" /> : <GitBranch className="size-3.5" />,
        disabled: b === st.branch,
        onSelect: () => void run('checkout', () => scmCheckout(b)),
      })),
      ...(remoteOnly.length ? (['separator'] as const) : []),
      ...remoteOnly.map<MenuItem>((b) => ({ label: b, icon: <CloudUpload className="size-3.5" />, onSelect: () => void run('checkout', () => scmCheckout(b)) })),
    ];
    const r = target.getBoundingClientRect();
    branchMenu.openAt(r.left, r.bottom + 4, items);
  };

  return (
    <div className="flex h-full flex-col">
      <SectionTitle
        actions={
          <>
            <IconButton size="sm" label={`Commit (${modKey}+Enter)`} disabled={!!primary.disabled || !hasChanges || !!busy} onClick={commit}>
              <Check className="size-3.5" />
            </IconButton>
            <IconButton size="sm" label="Refresh" onClick={() => void refreshScm()}>
              <RefreshCw className={clsx('size-3.5', busy && 'animate-spin')} />
            </IconButton>
            <IconButton size="sm" label="More actions" onClick={(e) => moreMenu.open(e, moreItems(), true)}>
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </>
        }
      >
        Source control
      </SectionTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 text-[13px]">
        <button
          onClick={(e) => void openBranchMenu(e)}
          className="focus-ring mb-2 flex w-full items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-left hover:bg-hover"
          title="Switch or create a branch"
        >
          <GitBranch className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-medium text-fg">{branchShown}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted">
            {noRemote ? 'no remote' : !st.upstream ? 'not published' : st.ahead || st.behind ? `${st.behind}↓ ${st.ahead}↑` : st.upstream}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        </button>

        {merging && (
          <div className="mb-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-[12px] text-fg">
            <div className="flex items-center gap-1.5 font-medium">
              <GitMerge className="size-3.5 text-warn" />{' '}
              {st.inProgress === 'rebase'
                ? 'Putting your commits on top of the remote’s'
                : st.inProgress === 'autostash'
                  ? 'Pulled, but your unsaved edits conflict'
                  : st.inProgress === 'cherry-pick'
                    ? 'Cherry-picking'
                    : 'Merging'}
            </div>
            <p className="mt-1 text-muted">
              {conflicts.length
                ? `Open each file under Merge Changes and pick a version for every conflict (“${st.sides.current}” or “${st.sides.incoming}”), or take a whole file with its buttons.`
                : st.inProgress === 'rebase'
                  ? 'This step is resolved. Continue the rebase; the next commit may stop again.'
                  : 'All conflicts are resolved. Commit to finish, or abort to go back.'}
            </p>
            <button className="mt-1 text-[12px] text-danger hover:underline" onClick={scmAbort}>
              Abort {abortLabel}
            </button>
          </div>
        )}

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={merging && !conflicts.length ? 'Message (leave empty for the merge message)' : `Message (${modKey}+Enter to commit on “${branchLabel}”)`}
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (!primary.disabled && (hasChanges || merging)) commit();
            }
          }}
          className="focus-ring w-full resize-y rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[13px] text-fg placeholder:text-faint"
        />
        <Button
          size="sm"
          variant="primary"
          className="mt-1.5 w-full"
          icon={primary.icon}
          disabled={!!primary.disabled || !!busy}
          loading={!!busy && busy !== 'checkout'}
          onClick={primary.onClick}
          title={primary.title}
        >
          {primary.label}
        </Button>

        <FileSection
          title="Merge changes"
          section="conflicts"
          files={conflicts}
          busy={!!busy}
          sides={st.sides}
        />
        <FileSection
          title="Staged changes"
          section="staged"
          files={st.staged}
          busy={!!busy}
          actions={
            <IconButton size="sm" label="Unstage all changes" onClick={() => void scmUnstage()}>
              <Minus className="size-3.5" />
            </IconButton>
          }
        />
        <FileSection
          title="Changes"
          section="changes"
          files={st.changes}
          busy={!!busy}
          actions={
            <>
              <IconButton size="sm" danger label="Discard all changes" onClick={() => scmDiscard(st.changes)}>
                <Undo2 className="size-3.5" />
              </IconButton>
              <IconButton size="sm" label="Stage all changes" onClick={() => void scmStage()}>
                <Plus className="size-3.5" />
              </IconButton>
            </>
          }
        />
        {!hasChanges && !conflicts.length && <p className="px-2 pt-3 text-xs text-faint">{st.hasCommits ? 'No changes.' : 'No files yet.'}</p>}
      </div>
      {moreMenu.node}
      {branchMenu.node}
    </div>
  );
}
