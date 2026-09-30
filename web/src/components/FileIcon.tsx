import { BookMarked, File, FileCode, FileCog, FileImage, FileText, FileType, Folder, FolderOpen } from 'lucide-react';
import { clsx } from 'clsx';
import { extname, isImagePath } from '../utils/paths';

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const e = extname(path);
  const cls = clsx(className ?? 'size-4');
  if (e === 'tex' || e === 'ltx') return <FileText className={clsx(cls, 'text-accent')} />;
  if (e === 'bib') return <BookMarked className={clsx(cls, 'text-ok')} />;
  if (e === 'sty' || e === 'cls' || e === 'bst' || e === 'def' || e === 'cfg') return <FileCog className={clsx(cls, 'text-warn')} />;
  if (e === 'pdf') return <FileType className={clsx(cls, 'text-danger')} />;
  if (isImagePath(path)) return <FileImage className={clsx(cls, 'text-pink-400')} />;
  if (['lua', 'py', 'js', 'json', 'm', 'r'].includes(e)) return <FileCode className={clsx(cls, 'text-info')} />;
  return <File className={clsx(cls, 'text-muted')} />;
}

export function FolderIcon({ open, className }: { open: boolean; className?: string }) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon className={clsx(className ?? 'size-4', 'text-accent-2')} />;
}
