/**
 * The floating "/" command menu (Notion-style). Keyboard handling lives in
 * EditorPane (Monaco owns focus); this component only renders.
 */
import { useEffect, useMemo, useRef } from 'react';
import katex from 'katex';
import { clsx } from 'clsx';
import type { SlashCommand } from './slash-commands';
import { MaterialIcon } from '../components/MaterialIcon';

export function MathPreview({ tex, display = true, className }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
    } catch {
      return '';
    }
  }, [tex, display]);
  return <div className={clsx('katex-preview', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function SlashMenu({
  items,
  selected,
  query,
  x,
  y,
  flipUp,
  maxHeight,
  onHover,
  onSelect,
}: {
  items: SlashCommand[];
  selected: number;
  query: string;
  x: number;
  y: number;
  flipUp: boolean;
  maxHeight?: number;
  onHover: (i: number) => void;
  onSelect: (cmd: SlashCommand) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const active = items[selected];
  let lastCategory = '';

  return (
    <div
      className="animate-pop absolute z-40 flex w-[min(560px,calc(100%-16px))] overflow-hidden rounded-xl border border-line bg-panel shadow-pop"
      style={{ left: x, top: flipUp ? undefined : y, bottom: flipUp ? y : undefined, maxHeight: maxHeight ? maxHeight + 2 : undefined }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={listRef} className="max-h-80 w-64 shrink-0 overflow-y-auto border-r border-line p-1" style={{ maxHeight }} role="listbox" aria-label="Insert block">
        {items.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted">No blocks match “{query}”</div>}
        {items.map((cmd, i) => {
          const header = !query && cmd.category !== lastCategory;
          lastCategory = cmd.category;
          return (
            <div key={cmd.id}>
              {header && <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{cmd.category}</div>}
              <button
                data-index={i}
                role="option"
                aria-selected={i === selected}
                onMouseEnter={() => onHover(i)}
                onClick={() => onSelect(cmd)}
                className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', i === selected ? 'bg-accent/15' : 'hover:bg-hover')}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 font-mono text-[11px] font-semibold text-fg">
                  <MaterialIcon name={cmd.icon} size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-fg">{cmd.title}</span>
                  <span className="block truncate text-[11px] text-muted">{cmd.description}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="hidden min-w-0 flex-1 flex-col gap-3 p-3 sm:flex">
        {active && (
          <>
            <div>
              <div className="text-sm font-semibold text-fg">{active.title}</div>
              <div className="mt-0.5 text-xs text-muted">{active.description}</div>
            </div>
            {active.preview && (
              <div className="rounded-lg border border-line bg-panel-2 px-3 py-4 text-center">
                <MathPreview tex={active.preview} />
              </div>
            )}
            {active.snippet && (
              <pre className="max-h-40 overflow-hidden rounded-lg border border-line bg-bg/60 p-2 font-mono text-[10.5px] leading-relaxed text-muted">
                {active.snippet.replace(/\$\{\d+\|([^,|]*)[^}]*\}/g, '$1').replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, '').replace(/\\\\\\\\/g, '\\\\')}
              </pre>
            )}
            {active.wizard && <div className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">Opens an interactive helper.</div>}
            {active.packages?.length ? (
              <div className="text-[11px] text-faint">
                Adds {active.packages.map((p) => `\\usepackage{${p.name}}`).join(', ')} to your preamble if needed.
              </div>
            ) : null}
            <div className="mt-auto flex gap-3 text-[10px] text-faint">
              <span>↑↓ navigate</span>
              <span>↵ insert</span>
              <span>esc close</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
