/**
 * Last line of defence: a crash anywhere in the tree shows what failed and a
 * way back, instead of a blank page. Files on disk are never at risk here;
 * edits are written as you type.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
  where: string | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, where: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GitLaTeX crashed:', error, info.componentStack);
    this.setState({ where: info.componentStack?.trim().split('\n').slice(0, 6).join('\n') ?? null });
  }

  render() {
    const { error, where } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-xl border border-danger/40 bg-panel p-5 shadow-pop">
          <h1 className="text-sm font-semibold text-danger">Something went wrong in the editor</h1>
          <p className="mt-2 text-[13px] text-muted">Your files are safe: every edit is written to disk as you type. Reloading usually gets you going again.</p>
          <pre className="mt-3 max-h-60 overflow-auto rounded-md bg-panel-2 p-3 text-[11.5px] leading-relaxed text-fg">
            {String(error.stack ?? error.message)}
            {where && `\n\nIn:\n${where}`}
          </pre>
          <div className="mt-4 flex gap-2">
            <button className="focus-ring brand-gradient rounded-md px-3 py-1.5 text-[13px] font-medium text-accent-fg" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="focus-ring rounded-md border border-line px-3 py-1.5 text-[13px] text-fg hover:bg-hover" onClick={() => this.setState({ error: null, where: null })}>
              Try to continue
            </button>
          </div>
        </div>
      </div>
    );
  }
}
