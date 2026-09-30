/**
 * Publish a local repository: create it on GitHub with the GitHub CLI when
 * that is installed and logged in (like VS Code's "Publish to GitHub"), or
 * push to the URL of an empty repository created anywhere.
 */
import { useEffect, useState } from 'react';
import { CloudUpload, ExternalLink, Lock, Globe } from 'lucide-react';
import { closeDialog, useStore } from '../state/store';
import { scmPublish } from '../state/actions';
import * as server from '../storage/server';
import { Button, Modal, Spinner, TextInput, clsx } from './ui';

export function PublishDialog() {
  const project = useStore((s) => s.project);
  const remotes = useStore((s) => s.scm?.remotes ?? []);
  const [gh, setGh] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'github' | 'url'>('url');
  const [name, setName] = useState(project?.name ?? '');
  const [priv, setPriv] = useState(true);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void server.scm
      .publishOptions()
      .then((o) => {
        setGh(o.gh);
        if (o.gh) setMode('github');
      })
      .catch(() => setGh(false));
  }, []);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'github') await scmPublish({ name: name.trim(), private: priv });
      else {
        if (!url.trim()) throw new Error('Paste the URL of an empty repository.');
        await scmPublish({ url: url.trim() });
      }
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const tab = (id: 'github' | 'url', label: string, disabled = false) => (
    <button
      key={id}
      disabled={disabled}
      onClick={() => setMode(id)}
      className={clsx('flex-1 rounded-md px-2 py-1 text-[12px] font-medium disabled:opacity-40', mode === id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
    >
      {label}
    </button>
  );

  return (
    <Modal
      title={remotes.length ? 'Publish to another remote' : 'Publish repository'}
      icon={<CloudUpload className="size-4 text-accent" />}
      onClose={closeDialog}
      footer={
        <>
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void publish()} icon={<CloudUpload className="size-3.5" />}>
            Publish
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-muted">
        This project’s commits are only on this machine. Publishing adds a remote named <code>origin</code> and pushes the current branch to it.
        {remotes.length ? ' The existing origin is replaced.' : ''}
      </p>

      <div className="mt-3 flex rounded-lg border border-line p-0.5">
        {tab('github', gh === false ? 'GitHub (needs gh)' : 'New GitHub repository', gh === false)}
        {tab('url', 'Repository URL')}
      </div>

      {gh === null && (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-faint">
          <Spinner className="size-3" /> Checking for the GitHub CLI…
        </div>
      )}

      {mode === 'github' && gh && (
        <div className="mt-3 space-y-3">
          <label className="block text-[13px] text-muted">
            Repository name
            <TextInput className="mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <div className="flex gap-2">
            {([
              [true, 'Private', <Lock key="l" className="size-3.5" />],
              [false, 'Public', <Globe key="g" className="size-3.5" />],
            ] as const).map(([value, label, icon]) => (
              <button
                key={label}
                onClick={() => setPriv(value)}
                className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-[13px]', priv === value ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:bg-hover')}
              >
                {icon} {label}
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-faint">Created with your logged-in GitHub CLI account (gh repo create).</p>
        </div>
      )}

      {mode === 'url' && (
        <div className="mt-3 space-y-2">
          <label className="block text-[13px] text-muted">
            Remote URL
            <TextInput
              className="mt-1"
              autoFocus
              placeholder="https://github.com/you/paper.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void publish()}
            />
          </label>
          <p className="text-[11.5px] text-faint">
            Create an <strong>empty</strong> repository first (no README or licence), then paste its URL.
            <a href="https://github.com/new" target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-accent hover:underline">
              New GitHub repository <ExternalLink className="size-3" />
            </a>
            {gh === false && <span className="block pt-1">For one-click publishing, install the GitHub CLI and run gh auth login.</span>}
          </p>
        </div>
      )}

      {error && <p className="mt-3 whitespace-pre-wrap text-xs text-danger">{error}</p>}
    </Modal>
  );
}
