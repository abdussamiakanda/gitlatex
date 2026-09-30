/**
 * Resizable two-pane layout. The first pane's size is kept in localStorage.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';

export function SplitPane({
  id,
  direction = 'horizontal',
  initial,
  min = 120,
  max = 2000,
  first,
  second,
  collapsed,
  className,
  sizeTarget = 'first',
}: {
  id: string;
  direction?: 'horizontal' | 'vertical';
  /** Initial size of the sized pane in px, or a fraction (0–1) of the container. */
  initial: number;
  min?: number;
  max?: number;
  first: ReactNode;
  second: ReactNode;
  /** Hide the sized pane entirely. */
  collapsed?: boolean;
  className?: string;
  /** Which pane has the fixed size. */
  sizeTarget?: 'first' | 'second';
}) {
  const key = `texbrowser.split.${id}`;
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(key));
    return saved > 0 ? saved : null;
  });
  const [dragging, setDragging] = useState(false);
  const horizontal = direction === 'horizontal';

  useEffect(() => {
    if (size !== null || !container.current) return;
    const total = horizontal ? container.current.clientWidth : container.current.clientHeight;
    setSize(initial <= 1 ? Math.round(total * initial) : initial);
  }, [size, initial, horizontal]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = container.current;
      if (!el) return;
      setDragging(true);
      const rect = el.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const pos = horizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
        const total = horizontal ? rect.width : rect.height;
        const raw = sizeTarget === 'first' ? pos : total - pos;
        const next = Math.max(min, Math.min(max, Math.min(raw, total - 80)));
        setSize(next);
      };
      const up = () => {
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setSize((s) => {
          if (s) localStorage.setItem(key, String(Math.round(s)));
          return s;
        });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [horizontal, key, max, min, sizeTarget],
  );

  const sized = { [horizontal ? 'width' : 'height']: size ?? undefined, flexShrink: 0 } as React.CSSProperties;
  const paneA = (
    <div className={clsx('relative min-h-0 min-w-0 overflow-hidden', sizeTarget === 'first' ? '' : 'flex-1')} style={sizeTarget === 'first' ? sized : undefined}>
      {first}
    </div>
  );
  const paneB = (
    <div className={clsx('relative min-h-0 min-w-0 overflow-hidden', sizeTarget === 'second' ? '' : 'flex-1')} style={sizeTarget === 'second' ? sized : undefined}>
      {second}
    </div>
  );

  return (
    <div ref={container} className={clsx('flex min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', className)}>
      {!(collapsed && sizeTarget === 'first') && paneA}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          data-dragging={dragging}
          onPointerDown={onPointerDown}
          onDoubleClick={() => {
            localStorage.removeItem(key);
            setSize(null);
          }}
          className={clsx('gutter z-10 shrink-0', horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize')}
        />
      )}
      {!(collapsed && sizeTarget === 'second') && paneB}
      {dragging && <div className={clsx('fixed inset-0 z-50', horizontal ? 'cursor-col-resize' : 'cursor-row-resize')} />}
    </div>
  );
}
