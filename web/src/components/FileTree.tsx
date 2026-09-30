/**
 * Project explorer: folders, files, context menus, drag-to-move and
 * drag-and-drop upload from the operating system.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronRight, FilePlus2, FolderPlus, Upload, FolderUp, Star, Pencil, Trash2, Download, FileInput, Play } from 'lucide-react';
import { useStore } from '../state/store';
import {
  confirmDelete, openFile, promptNewFile, promptNewFolder, promptRename, setMainFile, uploadFiles, workspace,
} from '../state/actions';
import { pickFiles, readDataTransfer, downloadBytes, downloadText } from '../storage/local-disk';
import { addFiles } from '../state/actions';
import { basename, dirname, joinPath } from '../utils/paths';
import { KEEP } from '../state/workspace';
import { FileIcon, FolderIcon } from './FileIcon';
import { IconButton, SectionTitle, useMenu, EmptyState, type MenuItem } from './ui';

interface TreeNode {
  name: string;
  path: string;
  folder: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[], folders: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', folder: true, children: [] };
  const ensure = (dir: string): TreeNode => {
    if (!dir) return root;
    const parent = ensure(dirname(dir));
    let n = parent.children.find((c) => c.folder && c.path === dir);
    if (!n) {
      n = { name: basename(dir), path: dir, folder: true, children: [] };
      parent.children.push(n);
    }
    return n;
  };
  for (const f of folders) ensure(f);
  for (const p of paths) ensure(dirname(p)).children.push({ name: basename(p), path: p, folder: false, children: [] });
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

export function FileTree() {
  const treeVersion = useStore((s) => s.treeVersion);
  const activePath = useStore((s) => s.activePath);
  const mainFile = useStore((s) => s.project?.mainFile);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const menu = useMenu();

  const tree = useMemo(() => {
    const ws = workspace();
    return ws ? buildTree(ws.paths(), ws.folders()) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeVersion]);

  const toggle = (p: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const fileMenu = (path: string): (MenuItem | 'separator')[] => {
    const f = workspace()?.get(path);
    return [
      { label: 'Open', icon: <FileInput className="size-3.5" />, onSelect: () => openFile(path) },
      ...(path.endsWith('.tex') ? [{ label: 'Set as main document', icon: <Star className="size-3.5" />, disabled: path === mainFile, onSelect: () => setMainFile(path) }] : []),
      'separator' as const,
      { label: 'Rename / move…', icon: <Pencil className="size-3.5" />, onSelect: () => promptRename(path) },
      {
        label: 'Download',
        icon: <Download className="size-3.5" />,
        onSelect: () => (f?.kind === 'text' ? downloadText(path, f.text ?? '') : f?.data && downloadBytes(basename(path), f.data)),
      },
      'separator' as const,
      { label: 'Delete', icon: <Trash2 className="size-3.5" />, danger: true, onSelect: () => confirmDelete(path) },
    ];
  };

  const folderMenu = (dir: string): (MenuItem | 'separator')[] => [
    { label: 'New file…', icon: <FilePlus2 className="size-3.5" />, onSelect: () => promptNewFile(dir) },
    { label: 'New folder…', icon: <FolderPlus className="size-3.5" />, onSelect: () => promptNewFolder(dir) },
    { label: 'Upload files here…', icon: <Upload className="size-3.5" />, onSelect: async () => void uploadFiles(await pickFiles(), dir) },
    ...(dir
      ? [
          'separator' as const,
          { label: 'Rename / move…', icon: <Pencil className="size-3.5" />, onSelect: () => promptRename(dir) },
          { label: 'Delete folder', icon: <Trash2 className="size-3.5" />, danger: true, onSelect: () => confirmDelete(dir) },
        ]
      : []),
  ];

  const onDrop = async (e: React.DragEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const moving = e.dataTransfer.getData('application/x-texbrowser-path');
    if (moving) {
      const target = joinPath(dir, basename(moving));
      if (target !== moving && !target.startsWith(moving + '/')) {
        try {
          workspace()?.rename(moving, target);
        } catch (err) {
          console.warn(err);
        }
      }
      return;
    }
    if (e.dataTransfer.items.length) addFiles(await readDataTransfer(e.dataTransfer, dir), { open: true });
  };

  const dropProps = (dir: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(dir);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget((t) => (t === dir ? null : t));
    },
    onDrop: (e: React.DragEvent) => void onDrop(e, dir),
  });

  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) => {
      if (n.folder) {
        const open = !collapsed.has(n.path);
        return (
          <div key={n.path} {...dropProps(n.path)} className={clsx(dropTarget === n.path && 'rounded bg-accent/10 outline outline-1 outline-accent/50')}>
            <button
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-texbrowser-path', n.path)}
              onClick={() => toggle(n.path)}
              onContextMenu={(e) => menu.open(e, folderMenu(n.path))}
              className="focus-ring flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-[13px] text-fg hover:bg-hover"
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              <ChevronRight className={clsx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
              <FolderIcon open={open} className="size-4 shrink-0" />
              <span className="truncate">{n.name}</span>
            </button>
            {open && render(n.children.filter((c) => c.name !== KEEP), depth + 1)}
          </div>
        );
      }
      const active = n.path === activePath;
      return (
        <button
          key={n.path}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('application/x-texbrowser-path', n.path)}
          onClick={() => openFile(n.path)}
          onContextMenu={(e) => menu.open(e, fileMenu(n.path))}
          title={n.path}
          className={clsx(
            'focus-ring group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px]',
            active ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-hover hover:text-fg',
          )}
          style={{ paddingLeft: 24 + depth * 14 }}
        >
          <FileIcon path={n.path} className="size-4 shrink-0" />
          <span className="flex-1 truncate">{n.name}</span>
          {n.path === mainFile && (
            <span title="Main document — this file is compiled" className="flex items-center gap-0.5 text-[10px] font-semibold uppercase text-accent">
              <Play className="size-2.5 fill-current" />
            </span>
          )}
        </button>
      );
    });

  return (
    <div className="flex h-full flex-col" {...dropProps('')}>
      <SectionTitle
        actions={
          <>
            <IconButton size="sm" label="New file" onClick={() => promptNewFile('')}><FilePlus2 className="size-3.5" /></IconButton>
            <IconButton size="sm" label="New folder" onClick={() => promptNewFolder('')}><FolderPlus className="size-3.5" /></IconButton>
            <IconButton size="sm" label="Upload files (images, .bib, .tex, .sty, .zip)" onClick={async () => void uploadFiles(await pickFiles())}><Upload className="size-3.5" /></IconButton>
            <IconButton size="sm" label="Upload a folder" onClick={async () => void uploadFiles(await pickFiles({ directory: true }))}><FolderUp className="size-3.5" /></IconButton>
          </>
        }
      >
        Files
      </SectionTitle>
      <div
        className={clsx('min-h-0 flex-1 overflow-y-auto px-1.5 pb-4', dropTarget === '' && 'bg-accent/5')}
        onContextMenu={(e) => e.target === e.currentTarget && menu.open(e, folderMenu(''))}
        role="tree"
      >
        {tree.length ? render(tree, 0) : <EmptyState icon={<FilePlus2 className="size-8" />} title="Empty project">Create a file or drop some here.</EmptyState>}
        <div className="px-2 pt-3 text-[11px] leading-relaxed text-faint">Drop images, .bib or .tex files here. Right-click for more options.</div>
      </div>
      {menu.node}
    </div>
  );
}
