/**
 * Which files open in the editor, and which open in the preview pane.
 */

export const VIEWABLE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];
export function isViewableFile(path) {
  if (!path) return false;
  return VIEWABLE_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));
}

export const EDITABLE_EXTENSIONS = [".tex", ".bib", ".txt", ".md", ".sty", ".cls", ".dtx", ".ins", ".json", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".csv", ".log", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".sh", ".bat", ".py", ".r", ".rmd"];
/** Extensions that must never open in editor (binary / vector art), even if they might match an editable suffix (e.g. .eps ends with .ps) */
export const NON_EDITABLE_EXTENSIONS = [".eps", ".ps"];
export function isEditableFile(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  if (NON_EDITABLE_EXTENSIONS.some(ext => lower.endsWith(ext))) return false;
  return EDITABLE_EXTENSIONS.some(ext => lower.endsWith(ext));
}
