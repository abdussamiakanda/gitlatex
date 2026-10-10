/**
 * Settings → About: version, links, the update notice and support.
 * Ported from the classic editor's "Technical info" and "Support" sections.
 */
import { useEffect, useState } from 'react';
import { ArrowUpCircle, Check, Coffee, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { useStore } from '../state/store';
import { checkForUpdate } from '../state/updates';
import { serverInfo } from '../state/actions';
import type { ServerInfo } from '../storage/server';
import { Button } from './ui';
import { COMPILER_API_REPO } from './EnginePanel';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-[13px]">
      <dt className="w-32 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-fg">{children}</dd>
    </div>
  );
}

const link = (href: string | undefined, text?: string) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {text ?? href.replace(/^https?:\/\//, '')} <ExternalLink className="size-3" />
    </a>
  ) : (
    '—'
  );

export function AboutSettings({ section }: { section: (title: string) => React.ReactNode }) {
  const update = useStore((s) => s.update);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void serverInfo().then(setInfo);
  }, []);

  const available = !!(update?.updateAvailable && update.latest);
  const command = update?.command ?? 'pip install --upgrade gitlatex';

  return (
    <>
      {section('About GitLaTeX')}
      <dl className="py-1">
        <Row label="Version">
          <span className="font-mono">{info?.version ?? update?.current ?? '—'}</span>
          {available ? (
            <span className="ml-2 rounded-full bg-accent-2/15 px-2 py-0.5 text-[11px] font-medium text-accent-2">update available</span>
          ) : update?.latest && !update.disabled ? (
            <span className="ml-2 text-[12px] text-muted">You are on the latest version.</span>
          ) : null}
        </Row>
        <Row label="GitHub">{link(info?.repository)}</Row>
        <Row label="PyPI">{link(info?.pypi, 'pypi.org/project/gitlatex')}</Row>
        <Row label="Compiler API">{link(COMPILER_API_REPO, 'github.com/abdussamiakanda/latex-fastapi')}</Row>
      </dl>

      {available && (
        <div className="my-2 flex gap-3 rounded-lg border border-accent-2/40 bg-accent-2/5 p-3" role="status">
          <ArrowUpCircle className="mt-0.5 size-5 shrink-0 text-accent-2" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-fg">Version {update!.latest} is available</div>
            <p className="mt-0.5 text-[12px] text-muted">You are running {update!.current}. Update, then restart GitLaTeX:</p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-panel-2 py-1 pl-3 pr-1">
              <code className="flex-1 font-mono text-[12.5px] text-fg">{command}</code>
              <Button
                size="sm"
                variant="ghost"
                icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                onClick={() => {
                  void navigator.clipboard?.writeText(command).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 py-1">
        <Button
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          loading={checking}
          onClick={async () => {
            setChecking(true);
            await checkForUpdate(true);
            setChecking(false);
          }}
        >
          Check for updates
        </Button>
        <span className="text-[12px] text-faint">
          {update?.disabled ? 'Update checks are disabled (GITLATEX_NO_UPDATE_CHECK).' : update?.error ? 'Could not reach PyPI to check for updates.' : ''}
        </span>
      </div>

      {section('Support')}
      <p className="py-1 text-[13px] text-muted">
        Built and maintained by <span className="font-medium text-fg">Md Abdus Sami Akanda &amp; Md Atiqur Rahman</span>. GitLaTeX is free and open source. If it saves you some time, you can keep
        the coffee flowing.
      </p>
      <a
        href="https://buymeacoffee.com/abdussamiakanda"
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring mt-2 inline-flex items-center gap-2 rounded-md bg-[#ffdd00] px-3 py-1.5 text-[13px] font-semibold text-[#1f2328] hover:brightness-95"
      >
        <Coffee className="size-4" /> Buy me a coffee
      </a>
    </>
  );
}
