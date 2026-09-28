/**
 * SyncTeX: editor line -> PDF spot (Cmd/Ctrl+click, or "Show in PDF" in the
 * context menu) and PDF spot -> editor line (double-click the PDF).
 *
 * Positions come from the last local compile, so after editing a file the
 * mapping can be a few lines off until the next build.
 */

import { state } from "../core/state.js";
import { fetchJson } from "../core/api.js";
import { getMainFile } from "./mainfile.js";
import { loadFile } from "./session.js";
import { setConsole } from "../ui/consolepane.js";
import { getPdfPath, pdfUrlFor, revealPdfBoxes, showPdf } from "../ui/pdfviewer.js";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
let flashDecorations = null;
let flashTimer = null;

export async function syncToPdf(lineNumber, column = 0) {
  const file = state.currentFile;
  if (!file || !/\.tex$/i.test(file)) {
    setConsole("Show in PDF works from .tex files.");
    return;
  }
  const pdf = (getMainFile() || "main.tex").replace(/\.tex$/i, ".pdf");
  if (getPdfPath() !== pdf) {
    const drawn = await showPdf(pdfUrlFor(pdf), pdf);
    if (!drawn) {
      setConsole("Show in PDF: could not open " + pdf + " in the PDF viewer. Compile first.");
      return;
    }
  }
  const data = await fetchJson("/synctex/forward", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf, file, line: lineNumber, column })
  });
  if (data.error) {
    setConsole("Show in PDF: " + data.error);
    return;
  }
  if (!revealPdfBoxes(data.boxes)) setConsole("Show in PDF: that page is not in the viewer. Recompile.");
}

export async function syncFromPdf(pdf, page, x, y) {
  if (!pdf) {
    setConsole("Jump to source needs a PDF compiled from this project.");
    return;
  }
  const data = await fetchJson("/synctex/inverse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf, page, x, y })
  });
  if (data.error) {
    setConsole("Jump to source: " + data.error);
    return;
  }
  if (data.file !== state.currentFile) await loadFile(data.file);
  const editor = state.editor;
  // loadFile reports its own errors; only move if it actually opened the file.
  if (!editor || state.currentFile !== data.file) return;
  const model = editor.getModel();
  const line = Math.min(data.line, model ? model.getLineCount() : data.line);
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.focus();
  flashLine(line);
}

function flashLine(line) {
  const monaco = state.monacoApi;
  const editor = state.editor;
  if (!monaco || !editor) return;
  if (flashDecorations) flashDecorations.clear();
  flashDecorations = editor.createDecorationsCollection([{
    range: new monaco.Range(line, 1, line, 1),
    options: { isWholeLine: true, className: "synctex-line-flash" }
  }]);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => flashDecorations && flashDecorations.clear(), 1500);
}

/** Hooks Cmd/Ctrl+click and a context-menu entry onto the editor. */
export function registerSynctex(editor) {
  editor.onMouseDown((e) => {
    const modifier = IS_MAC ? e.event.metaKey : e.event.ctrlKey;
    if (!modifier || !e.event.leftButton || !e.target.position) return;
    syncToPdf(e.target.position.lineNumber, e.target.position.column);
  });
  editor.addAction({
    id: "gitlatex.synctex.showInPdf",
    label: "Show in PDF",
    contextMenuGroupId: "navigation",
    contextMenuOrder: 0,
    run: (ed) => {
      const pos = ed.getPosition();
      if (pos) syncToPdf(pos.lineNumber, pos.column);
    }
  });
}
