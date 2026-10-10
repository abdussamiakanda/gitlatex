/**
 * Small UI primitives shared by the whole app.
 */
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export { clsx };

/**
 * `danger` is a solid red button (the main action of a destructive dialog);
 * `danger-subtle` is red text with a faint red border, for a destructive action
 * that sits beside others.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-subtle' | 'subtle';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  loading,
  icon,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'focus-ring inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'brand-gradient text-accent-fg shadow-sm hover:brightness-110',
        variant === 'secondary' && 'border border-line bg-panel-2 text-fg hover:bg-hover',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-fg',
        variant === 'subtle' && 'bg-hover/60 text-fg hover:bg-hover',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        variant === 'danger-subtle' && 'border border-danger/35 text-danger hover:border-danger/60 hover:bg-danger/10',
        className,
      )}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  size = 'md',
  danger,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' | 'lg'; /** Destructive: turns red on hover. */ danger?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={rest.title ?? label}
      className={clsx(
        'focus-ring inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'size-6' : size === 'lg' ? 'size-10' : 'size-8',
        active ? 'bg-accent/15 text-accent' : danger ? 'text-muted hover:bg-danger/10 hover:text-danger' : 'text-muted hover:bg-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className ?? 'size-4')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Toggle({ checked, onChange, label, description, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; className?: string }) {
  return (
    <label className={clsx('flex cursor-pointer items-start justify-between gap-4', className ?? 'py-2')}>
      <span>
        <span className="block text-[13px] text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        // Flex layout (not absolute positioning): the knob's position must not depend on
        // how the browser aligns a button's content, which differs between platforms.
        className={clsx(
          'focus-ring mt-0.5 inline-flex h-5 w-9 shrink-0 items-center justify-start rounded-full p-0.5 transition-colors',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span className={clsx('pointer-events-none block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'focus-ring h-8 w-full rounded-md border border-line bg-panel-2 px-2.5 text-[13px] text-fg placeholder:text-faint',
        props.className,
      )}
    />
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
  icon,
  bodyClassName = 'max-h-[70vh] overflow-y-auto px-4 py-4',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  icon?: ReactNode;
  bodyClassName?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[8vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={clsx('animate-pop w-full overflow-hidden rounded-xl border border-line bg-panel shadow-pop', width)}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {icon}
          <h2 className="flex-1 text-sm font-semibold text-fg">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className={bodyClassName}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-panel-2/50 px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A dropdown / context menu rendered in a portal at a screen position. */
export function Menu({ items, x, y, onClose }: { items: (MenuItem | 'separator')[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} role="menu" style={{ left: pos.x, top: pos.y }} className="animate-pop fixed z-[60] min-w-48 rounded-lg border border-line bg-panel p-1 shadow-pop">
      {items.map((it, i) =>
        it === 'separator' ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={clsx(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] disabled:opacity-40',
              it.danger ? 'text-danger hover:bg-danger/10' : 'text-fg hover:bg-hover',
            )}
          >
            <span className="flex size-4 items-center justify-center text-muted">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="text-[11px] text-faint">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Hook: open a Menu at the mouse position / below an element. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | 'separator')[] } | null>(null);
  const open = (e: React.MouseEvent, items: (MenuItem | 'separator')[], below = false) => {
    e.preventDefault();
    e.stopPropagation();
    if (below) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left, y: r.bottom + 4, items });
    } else setMenu({ x: e.clientX, y: e.clientY, items });
  };
  /** Open at a screen position (for menus whose items load asynchronously). */
  const openAt = (x: number, y: number, items: (MenuItem | 'separator')[]) => setMenu({ x, y, items });
  const node = menu ? <Menu {...menu} onClose={() => setMenu(null)} /> : null;
  return { open, openAt, node };
}

export function ProgressBar({ value, total, className }: { value?: number; total?: number; className?: string }) {
  const pct = value !== undefined && total ? Math.min(100, (value / total) * 100) : null;
  return (
    <div className={clsx('h-1 w-full overflow-hidden rounded-full bg-line', className)}>
      {pct === null ? (
        <div className="progress-indeterminate h-full w-full" />
      ) : (
        <div className="brand-gradient h-full transition-[width] duration-200" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-faint">{icon}</div>
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-3">
      <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</span>
      {actions}
    </div>
  );
}
