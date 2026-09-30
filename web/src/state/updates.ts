/**
 * Version info and the PyPI update check (gitlatex/routes/system.py).
 *
 * Checked once when the app starts (the server caches PyPI's answer); a new
 * version puts a dot on every Settings button, a notice in Settings, and a
 * toast the first time that version is seen.
 */
import { getState, setState, toast, openDialog } from './store';

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  pypi?: string;
  command?: string;
  error?: string | null;
  disabled?: boolean;
}

const SEEN_KEY = 'gitlatex.updateSeen';

/** Ask the server whether a newer gitlatex is on PyPI. Never throws. */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  let info: UpdateInfo | null = null;
  try {
    const res = await fetch('/api/update-check' + (force ? '?force=1' : ''));
    info = res.ok ? ((await res.json()) as UpdateInfo) : null;
  } catch {
    info = null;
  }
  setState({ update: info });
  if (info?.updateAvailable && info.latest) announce(info);
  return info;
}

/** One toast per new version, so it informs without nagging. */
function announce(info: UpdateInfo) {
  try {
    if (localStorage.getItem(SEEN_KEY) === info.latest) return;
    localStorage.setItem(SEEN_KEY, info.latest!);
  } catch {
    /* ignore */
  }
  toast({
    kind: 'info',
    title: `GitLaTeX ${info.latest} is available`,
    message: `You are running ${info.current}. Update with: ${info.command ?? 'pip install --upgrade gitlatex'}`,
    action: { label: 'Details', run: () => openDialog({ type: 'settings', section: 'about' }) },
    timeout: 12000,
  });
}

export const updateAvailable = () => !!getState().update?.updateAvailable;
