/** Shared application types. */
import type { TexEngine } from './engine/protocol';

export type FileKind = 'text' | 'binary';

/** A project: a folder in the gitlatex server's repos directory. `id` is the folder name. */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  mainFile: string;
  engine: TexEngine;
  template?: string;
  /** The folder is a Git repository. */
  hasGit?: boolean;
  /** URL of the repository's remote (origin, else the first one); null for local-only repositories. */
  remoteUrl?: string | null;
  openTabs?: string[];
  activePath?: string | null;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** Project-relative file path, when known. */
  file?: string;
  line?: number;
  /** Extra lines from the log that explain the problem. */
  context?: string;
  /** Raw log excerpt. */
  raw?: string;
  source: 'latex' | 'bibtex' | 'engine';
}

export type ThemeMode = 'dark' | 'light' | 'system';

/**
 * Where documents are compiled: `browser` runs TeX Live as WebAssembly in this
 * tab, `local` uses the TeX installation on the server's machine, `api` posts
 * the project to a remote Compiler API, `auto` picks local when it is installed
 * and the browser otherwise.
 */
export type CompilerMode = 'auto' | 'browser' | 'local' | 'api';

export interface Settings {
  theme: ThemeMode;
  compiler: CompilerMode;
  /** Write the PDF built in the browser into the project folder (as local builds do). */
  savePdf: boolean;
  /** Vim keybindings with VimTeX-style mappings. */
  vim: boolean;
  /** Underline unknown words (checked by the server's LaTeX-aware spell checker). */
  spellCheck: boolean;
  editorFontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  autoCompile: boolean;
  autoCompileDelay: number;
  bibtex: 'auto' | 'always' | 'never';
  haltOnError: boolean;
  useShelf: boolean;
  pdfDarkMode: boolean;
  pdfNative: boolean;
  beginnerMode: boolean;
  slashCommands: boolean;
  mathPreview: boolean;
  formatBar: boolean;
  engineUrl: string;
  shelfUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  compiler: 'auto',
  savePdf: true,
  vim: false,
  spellCheck: true,
  editorFontSize: 14,
  wordWrap: true,
  minimap: false,
  autoCompile: true,
  autoCompileDelay: 1500,
  bibtex: 'auto',
  haltOnError: false,
  useShelf: true,
  pdfDarkMode: false,
  pdfNative: false,
  beginnerMode: true,
  slashCommands: true,
  mathPreview: true,
  formatBar: true,
  engineUrl: '',
  shelfUrl: '',
};
