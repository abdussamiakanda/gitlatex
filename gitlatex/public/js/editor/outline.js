/**
 * Document outline built from the section commands in the open file.
 */

import { state } from "../core/state.js";
import { refreshEnvDecorations } from "./envcolors.js";

// ----- Document outline (sections of the open file) -----
export const OUTLINE_LEVELS = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5
};

export function parseOutline(text) {
  const items = [];
  const lines = (text || "").split("\n");
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/;
  lines.forEach(function (line, i) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("%")) return; // commented out
    const m = re.exec(line);
    if (!m) return;
    // Balance braces so titles containing {...} survive intact.
    let depth = 0, title = "";
    for (let k = m.index + m[0].length - 1; k < line.length; k++) {
      const ch = line[k];
      if (ch === "{") { depth++; if (depth === 1) continue; }
      else if (ch === "}") { depth--; if (depth === 0) break; }
      if (depth > 0) title += ch;
    }
    items.push({
      level: OUTLINE_LEVELS[m[1]],
      kind: m[1],
      title: title.replace(/\\[a-zA-Z]+\s*/g, "").replace(/[{}]/g, "").trim() || "(untitled)",
      line: i + 1
    });
  });
  return items;
}

export function renderOutline() {
  const box = document.getElementById("outline-tree");
  if (!box) return;
  const isTex = state.currentFile && /\.(tex|sty|cls)$/i.test(state.currentFile);
  if (!isTex || !state.editor) {
    box.innerHTML = '<div class="outline-empty">Open a .tex file to see its outline.</div>';
    return;
  }
  const items = parseOutline(state.editor.getValue());
  if (!items.length) {
    box.innerHTML = '<div class="outline-empty">No sections found.</div>';
    return;
  }
  const minLevel = Math.min.apply(null, items.map(i => i.level));
  box.innerHTML = "";
  items.forEach(function (it) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "outline-item";
    row.style.paddingLeft = (8 + (it.level - minLevel) * 12) + "px";
    row.textContent = it.title;
    row.title = "\\" + it.kind + " - line " + it.line;
    row.dataset.line = String(it.line);
    row.addEventListener("click", function () {
      if (!state.editor) return;
      state.editor.revealLineInCenter(it.line);
      state.editor.setPosition({ lineNumber: it.line, column: 1 });
      state.editor.focus();
      highlightOutlineFor(it.line);
    });
    box.appendChild(row);
  });
  if (state.editor.getPosition) highlightOutlineFor(state.editor.getPosition().lineNumber);
}

// Marks the section the cursor currently sits in.
export function highlightOutlineFor(line) {
  const box = document.getElementById("outline-tree");
  if (!box) return;
  const rows = Array.from(box.querySelectorAll(".outline-item"));
  let active = null;
  rows.forEach(function (r) {
    r.classList.remove("active");
    if (Number(r.dataset.line) <= line) active = r;
  });
  if (active) active.classList.add("active");
}
export function scheduleOutlineRefresh() {
  clearTimeout(state.outlineTimer);
  state.outlineTimer = setTimeout(function () {
    renderOutline();
    refreshEnvDecorations();
  }, 300);
}

export function toggleOutlineSection() {
  const section = document.getElementById("outline-section");
  const header = document.getElementById("outline-header");
  if (!section) return;
  const collapsed = section.classList.toggle("collapsed");
  if (header) header.setAttribute("aria-expanded", collapsed ? "false" : "true");
}
