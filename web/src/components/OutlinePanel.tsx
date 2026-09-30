import { useMemo } from 'react';
import { ListTree, Hash } from 'lucide-react';
import { clsx } from 'clsx';
import { useStore } from '../state/store';
import { openFile, workspace } from '../state/actions';
import { outline, wordCount } from '../latex/analysis';
import { EmptyState, SectionTitle } from './ui';

/** Follow \input/\include from the main file so the outline is in document order. */
function documentOrder(files: { path: string; text: string }[], main: string): { path: string; text: string }[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const out: { path: string; text: string }[] = [];
  const seen = new Set<string>();
  const dir = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : '';
  const visit = (path: string) => {
    const f = byPath.get(path);
    if (!f || seen.has(path)) return;
    seen.add(path);
    out.push(f);
    const re = /\\(?:input|include|subfile)\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.text.replace(/(^|[^\\])%.*$/gm, '$1')))) {
      const name = m[1].trim();
      visit(byPath.has(dir + name) ? dir + name : dir + name + '.tex');
    }
  };
  visit(main);
  return out;
}

export function OutlinePanel() {
  const contentVersion = useStore((s) => s.contentVersion);
  const treeVersion = useStore((s) => s.treeVersion);
  const main = useStore((s) => s.project?.mainFile ?? '');
  const cursor = useStore((s) => s.cursor);
  const active = useStore((s) => s.activePath);

  const { items, words } = useMemo(() => {
    const ws = workspace();
    if (!ws) return { items: [], words: 0 };
    const files = documentOrder(ws.textFiles('.tex'), main);
    return { items: outline(files), words: files.reduce((n, f) => n + wordCount(f.text), 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentVersion, treeVersion, main]);

  const minLevel = Math.min(...items.map((i) => i.level), 9);
  const current = items.filter((i) => i.file === active && cursor && i.line <= cursor.line).pop();

  return (
    <div className="flex h-full flex-col">
      <SectionTitle>Outline</SectionTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {!items.length ? (
          <EmptyState icon={<ListTree className="size-8" />} title="No sections yet">
            Add <code>\section{'{…}'}</code> — or type <code>/section</code> in the editor.
          </EmptyState>
        ) : (
          items.map((it, i) => (
            <button
              key={i}
              onClick={() => openFile(it.file, it.line)}
              className={clsx(
                'focus-ring flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px]',
                it === current ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                it.level <= 2 && 'font-medium',
              )}
              style={{ paddingLeft: 8 + (it.level - minLevel) * 14 }}
              title={`${it.file}:${it.line}`}
            >
              <Hash className="size-3 shrink-0 text-faint" />
              <span className="truncate">{it.title}</span>
              {it.kind.endsWith('*') && <span className="text-[10px] text-faint">*</span>}
            </button>
          ))
        )}
      </div>
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">≈ {words.toLocaleString()} words in the document body</div>
    </div>
  );
}
