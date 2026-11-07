/**
 * The LyX-style editor's ☰ menu, at the start of its toolbar: what the toolbar
 * buttons and keys do not already show (find & replace, the command buffer,
 * the outline and code preview panes, bookmarks, child documents, document
 * settings, export).
 * Every entry is a LyX function (lfuns.ts), with its shortcut.
 */
import { Check, Menu as MenuIcon } from 'lucide-react';
import { useMenu, type MenuItem } from '../components/ui';
import { bookmarkList } from './bookmarks';
import { lfunNamed, type LfunContext } from './lfuns';

export function LyxMoreMenu({ ctx, onRun }: { ctx: LfunContext | null; onRun(line: string): void }) {
  const menu = useMenu();
  const open = (e: React.MouseEvent) => {
    if (!ctx) return;
    const item = (line: string, label?: string, keys?: string): MenuItem => {
      const [name, ...rest] = line.split(' ');
      // Names with a space (`dialog-toggle toc`) are whole names; others take the rest as argument.
      const lfun = lfunNamed(line) ?? lfunNamed(name)!;
      const arg = lfunNamed(line) ? '' : rest.join(' ');
      return {
        label: label ?? lfun.label,
        shortcut: keys ?? lfun.keys,
        icon: lfun.on?.(ctx, arg) ? <Check className="size-3.5" /> : undefined,
        disabled: !lfun.run(ctx, arg, true),
        onSelect: () => onRun(line),
      };
    };
    const marks = bookmarkList(ctx.view.state);
    const items: (MenuItem | 'separator')[] = [
      item('dialog-show findreplace'),
      item('command-execute', 'Command buffer…'),
      'separator',
      item('dialog-toggle toc'),
      item('dialog-toggle view-source'),
      'separator',
      ...(marks.length
        ? [
            ...marks.map((m) => item(`bookmark-goto ${m.n}`, `Bookmark ${m.n}: ${m.text || '(empty paragraph)'}`, `Alt+${m.n}`)),
            item('bookmark-clear'),
          ]
        : [{ label: 'No bookmarks (Ctrl+Shift+1…5 saves one)', disabled: true, onSelect: () => undefined }]),
      'separator',
      item('child-open', 'Open child document'),
      item('buffer-parent', 'Back to parent document'),
      'separator',
      item('dialog-show document', 'Document settings…'),
      item('buffer-export latex', 'Export as LaTeX (.tex)'),
      item('buffer-export text', 'Export as plain text (.txt)'),
    ];
    menu.open(e, items, true);
  };
  return (
    <>
      <button
        type="button"
        title="More: find, command buffer, outline, code preview, bookmarks, document settings, export"
        aria-label="More"
        aria-haspopup="menu"
        disabled={!ctx}
        // The editor keeps its selection: the menu acts on it.
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
        className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
      >
        <MenuIcon className="size-3.5" />
      </button>
      {menu.node}
    </>
  );
}
