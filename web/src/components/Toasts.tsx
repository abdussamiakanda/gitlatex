import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';
import { useStore, dismissToast } from '../state/store';
import { clsx } from './ui';

const ICONS = {
  success: <CheckCircle2 className="size-4 text-ok" />,
  info: <Info className="size-4 text-info" />,
  warning: <AlertTriangle className="size-4 text-warn" />,
  error: <XCircle className="size-4 text-danger" />,
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-8 right-4 z-[70] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={clsx('animate-pop pointer-events-auto flex gap-3 rounded-xl border bg-panel p-3 shadow-pop', t.kind === 'error' ? 'border-danger/40' : 'border-line')}>
          <div className="pt-0.5">{ICONS[t.kind]}</div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-fg">{t.title}</div>
            {t.message && <div className="mt-0.5 break-words text-xs leading-relaxed text-muted">{t.message}</div>}
            {t.action && (
              <button
                onClick={() => {
                  t.action?.run();
                  dismissToast(t.id);
                }}
                className="mt-1.5 text-xs font-medium text-accent hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="h-fit rounded p-0.5 text-faint hover:bg-hover hover:text-fg">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
