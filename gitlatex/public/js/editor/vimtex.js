/**
 * A VimTeX-flavoured layer on top of monaco-vim.
 *
 * Covers the parts of VimTeX people reach for daily:
 *
 *   text objects   ie/ae  environment     i$/a$  math       ic/ac  command
 *                  id/ad  delimiters      iP/aP  section
 *   motions        ]] [[  next/prev section      ]m [m  next/prev \begin
 *                  ]M [M  next/prev \end         ]n [n  next/prev math
 *                  %      also jumps between \begin and \end
 *   normal mode    dse cse tse   delete/change/toggle-star environment
 *                  dsc csc tsc   delete/change/toggle-star command
 *                  ds$ cs$ ts$   delete/change/toggle-display math
 *                  dsd tsd       delete / toggle \left\right delimiters
 *                  tsf           toggle \frac{a}{b} <-> a/b
 *                  \ll \lv \lt \le   compile, show in PDF, outline, errors
 *   insert mode    ]]            close the current environment
 *
 * Everything works on offsets into the whole document, with comments blanked
 * out first so a commented \begin never pairs with a real \end.
 */

const SECTION_LEVELS = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6
};
const SECTION_RE = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/g;
const MATH_ENVS = /^(equation|align|alignat|flalign|gather|multline|eqnarray|math|displaymath|split|aligned|gathered)\*?$/;
const OPEN_DELIMS = { "(": ")", "[": "]", "{": "}" };
const CLOSE_DELIMS = { ")": "(", "]": "[", "}": "{" };

// ----- Parsing helpers (all offsets are into the full model text) -----

/** Replaces comments with spaces, keeping every offset the same. */
export function maskComments(text) {
  return text.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, function (m, pre, slashes) {
    return pre + slashes + " ".repeat(m.length - pre.length - slashes.length);
  });
}

/** Every matched \begin{..}..\end{..} pair, in document order of \begin. */
export function findEnvPairs(text) {
  const re = /\\(begin|end)\s*\{([^}\n]*)\}/g;
  const stack = [];
  const pairs = [];
  let m;
  while ((m = re.exec(text))) {
    const tok = { name: m[2].trim(), start: m.index, end: m.index + m[0].length };
    if (m[1] === "begin") {
      stack.push(tok);
      continue;
    }
    // Pop to the matching \begin, dropping any unclosed ones in between.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === tok.name) {
        const open = stack[i];
        stack.length = i;
        pairs.push({ name: tok.name, beginStart: open.start, beginEnd: open.end, endStart: tok.start, endEnd: tok.end });
        break;
      }
    }
  }
  return pairs.sort((a, b) => a.beginStart - b.beginStart);
}

function innermost(zones, offset, startKey, endKey) {
  let best = null;
  for (const z of zones) {
    if (z[startKey] <= offset && offset < z[endKey]) {
      if (!best || z[endKey] - z[startKey] < best[endKey] - best[startKey]) best = z;
    }
  }
  return best;
}

export function enclosingEnv(text, offset, filter) {
  const pairs = findEnvPairs(text).filter(p => !filter || filter(p));
  return innermost(pairs, offset, "beginStart", "endEnd");
}

/** Math zones: $..$, $$..$$, \(..\), \[..\] and math environments. */
export function findMathZones(text) {
  const zones = [];
  const re = /\\\\|\\\$|\$\$|\$|\\\(|\\\)|\\\[|\\\]/g;
  let open = null;
  let m;
  while ((m = re.exec(text))) {
    const tok = m[0];
    if (tok === "\\\\" || tok === "\\$") continue;
    if (!open) {
      if (tok === "$" || tok === "$$" || tok === "\\(" || tok === "\\[") {
        open = { tok, start: m.index, end: m.index + tok.length };
      }
      continue;
    }
    const closer = { "$": "$", "$$": "$$", "\\(": "\\)", "\\[": "\\]" }[open.tok];
    if (tok === closer) {
      zones.push({ kind: open.tok, openStart: open.start, openEnd: open.end, closeStart: m.index, closeEnd: m.index + tok.length });
      open = null;
    }
  }
  findEnvPairs(text).forEach(function (p) {
    if (MATH_ENVS.test(p.name)) {
      zones.push({ kind: "env", env: p, openStart: p.beginStart, openEnd: p.beginEnd, closeStart: p.endStart, closeEnd: p.endEnd });
    }
  });
  return zones;
}

export function enclosingMath(text, offset) {
  return innermost(findMathZones(text), offset, "openStart", "closeEnd");
}

/** End offset of a balanced group starting at `start` (which holds the opener). */
function groupEnd(text, start) {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return -1;
}

/** Parses \name*[..]{..}.. at `start`; null if it is not a command. */
function parseCommandAt(text, start) {
  const m = /^\\([a-zA-Z@]+)(\*?)/.exec(text.slice(start, start + 80));
  if (!m) return null;
  const nameEnd = start + m[0].length;
  let pos = nameEnd;
  const args = [];
  while (text[pos] === "[" || text[pos] === "{") {
    const end = groupEnd(text, pos);
    if (end === -1) break;
    args.push({ type: text[pos], start: pos, end });
    pos = end;
  }
  return { name: m[1], starred: !!m[2], start, nameEnd, end: pos, args };
}

/** Innermost \command{...} whose name or arguments contain `offset`. */
export function enclosingCommand(text, offset) {
  const from = Math.max(0, offset - 4000);
  for (let i = Math.min(offset, text.length - 1); i >= from; i--) {
    if (text[i] !== "\\" || (i > 0 && text[i - 1] === "\\")) continue;
    const cmd = parseCommandAt(text, i);
    if (!cmd || cmd.name === "begin" || cmd.name === "end") continue;
    // Walking backwards, the first command that spans the cursor is the innermost.
    if (offset < cmd.end) return cmd;
  }
  return null;
}

/** Innermost bracket pair around `offset`, including \left/\right. */
export function enclosingDelims(text, offset) {
  const stack = [];
  const pairs = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      // \{ and \} are delimiters too; other escapes are skipped.
      if (text[i + 1] === "{" || text[i + 1] === "}") {
        if (text[i + 1] === "{") stack.push({ ch: "\\{", start: i, end: i + 2 });
        else closeAt("\\{", i, i + 2);
      }
      i++;
      continue;
    }
    if (OPEN_DELIMS[c]) stack.push({ ch: c, start: i, end: i + 1 });
    else if (CLOSE_DELIMS[c]) closeAt(c === ")" ? "(" : c === "]" ? "[" : "{", i, i + 1);
    if (i > offset && !stack.length) break;
  }
  function closeAt(openCh, start, end) {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].ch === openCh) {
        const o = stack[k];
        stack.length = k;
        pairs.push({ openStart: o.start, openEnd: o.end, closeStart: start, closeEnd: end });
        return;
      }
    }
  }
  const best = innermost(pairs, offset, "openStart", "closeEnd");
  if (!best) return null;
  // Grow over \left / \right (and \bigl etc.) so they count as part of the pair.
  const before = /\\(left|bigl|Bigl|biggl|Biggl|big|Big|bigg|Bigg)\s*$/.exec(text.slice(Math.max(0, best.openStart - 8), best.openStart));
  const after = /\\(right|bigr|Bigr|biggr|Biggr|big|Big|bigg|Bigg)\s*$/.exec(text.slice(Math.max(0, best.closeStart - 8), best.closeStart));
  if (before && after) {
    return {
      ...best,
      sized: true,
      outerStart: best.openStart - before[0].length,
      outerEnd: best.closeEnd,
      leftStart: best.openStart - before[0].length,
      rightStart: best.closeStart - after[0].length
    };
  }
  return { ...best, sized: false, outerStart: best.openStart, outerEnd: best.closeEnd };
}

/** Section headings as {level, start} where start is the line start. */
export function findSections(text) {
  const out = [];
  SECTION_RE.lastIndex = 0;
  let m;
  while ((m = SECTION_RE.exec(text))) {
    out.push({ level: SECTION_LEVELS[m[1]], start: text.lastIndexOf("\n", m.index) + 1, cmd: m.index });
  }
  return out;
}

function lineStart(text, offset) {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function lineEnd(text, offset) {
  const i = text.indexOf("\n", offset);
  return i === -1 ? text.length : i;
}

function onlySpaceBetween(text, a, b) {
  return /^[ \t]*$/.test(text.slice(a, b));
}

// ----- Editing helpers -----

function applyEdits(editor, monaco, edits, label) {
  const model = editor.getModel();
  const ops = edits
    .sort((a, b) => b.start - a.start)
    .map(e => {
      const s = model.getPositionAt(e.start);
      const t = model.getPositionAt(e.end);
      return { range: new monaco.Range(s.lineNumber, s.column, t.lineNumber, t.column), text: e.text, forceMoveMarkers: true };
    });
  editor.pushUndoStop();
  editor.executeEdits(label || "vimtex", ops);
  editor.pushUndoStop();
}

/** Deletes a \begin/\end token, taking its whole line if nothing else is on it. */
function tokenDeletion(text, start, end) {
  const ls = lineStart(text, start);
  const le = lineEnd(text, end);
  if (onlySpaceBetween(text, ls, start) && onlySpaceBetween(text, end, le)) {
    return { start: ls, end: Math.min(le + 1, text.length), text: "" };
  }
  return { start, end, text: "" };
}

function toggleStar(name) {
  return name.endsWith("*") ? name.slice(0, -1) : name + "*";
}

/**
 * Wires the VimTeX layer into monaco-vim. `hooks` provides the app-level
 * commands: compile, view, toc, errors, prompt(title, default) -> Promise.
 */
export function installVimtex(VimMode, monaco, hooks) {
  const Vim = VimMode.Vim;
  const Pos = VimMode.Pos;

  const docOf = cm => {
    const text = cm.editor.getModel().getValue();
    // % only starts a comment in TeX; elsewhere it may be an operator.
    return { text, masked: isTex() ? maskComments(text) : text };
  };
  const offsetOf = cm => cm.indexFromPos(cm.getCursor("head"));
  const isTex = () => /\.(tex|sty|cls|ltx|dtx)$/i.test(hooks.currentFile() || "");

  // A text object returns [start, end) offsets; this turns it into what
  // monaco-vim expects in normal (operator) and visual mode.
  function textObject(name, finder) {
    Vim.defineMotion(name, function (cm, head, motionArgs, vim) {
      const { text, masked } = docOf(cm);
      const r = finder(text, masked, offsetOf(cm), !!motionArgs.textObjectInner);
      if (!r || r.end <= r.start) return null;
      if (r.linewise) {
        const first = cm.posFromIndex(r.start).line;
        const last = cm.posFromIndex(r.end - 1).line;
        motionArgs.linewise = true;
        if (vim.visualMode && !vim.visualLine) {
          vim.visualLine = true;
          cm.dispatch("vim-mode-change", { mode: "visual", subMode: "linewise" });
        }
        return [new Pos(first, 0), new Pos(last, 0)];
      }
      const start = cm.posFromIndex(r.start);
      if (vim.visualMode) return [start, cm.posFromIndex(r.end - 1)];
      return [start, cm.posFromIndex(r.end)];
    });
  }

  function linewiseInner(text, a, b) {
    // Content between two tokens: whole lines when the tokens sit alone.
    const aEndLine = lineEnd(text, a);
    const bLineStart = lineStart(text, b);
    if (onlySpaceBetween(text, a, aEndLine) && onlySpaceBetween(text, bLineStart, b) && aEndLine + 1 < bLineStart) {
      return { start: aEndLine + 1, end: bLineStart, linewise: true };
    }
    return { start: a, end: b };
  }

  function linewiseOuter(text, a, b) {
    const ls = lineStart(text, a);
    const le = lineEnd(text, b);
    if (onlySpaceBetween(text, ls, a) && onlySpaceBetween(text, b, le)) {
      return { start: ls, end: Math.min(le + 1, text.length), linewise: true };
    }
    return { start: a, end: b };
  }

  textObject("vimtexEnv", function (text, masked, off, inner) {
    const env = enclosingEnv(masked, off);
    if (!env) return null;
    return inner ? linewiseInner(text, env.beginEnd, env.endStart) : linewiseOuter(text, env.beginStart, env.endEnd);
  });

  textObject("vimtexMath", function (text, masked, off, inner) {
    const z = enclosingMath(masked, off);
    if (!z) return null;
    if (!inner) return z.kind === "env" ? linewiseOuter(text, z.openStart, z.closeEnd) : { start: z.openStart, end: z.closeEnd };
    return z.kind === "env" || z.kind === "\\[" || z.kind === "$$"
      ? linewiseInner(text, z.openEnd, z.closeStart)
      : { start: z.openEnd, end: z.closeStart };
  });

  textObject("vimtexCommand", function (text, masked, off, inner) {
    const cmd = enclosingCommand(masked, off);
    if (!cmd) return null;
    if (!inner) return { start: cmd.start, end: cmd.end };
    const braces = cmd.args.filter(a => a.type === "{");
    const arg = braces.find(a => a.start <= off && off < a.end) || braces[0];
    return arg ? { start: arg.start + 1, end: arg.end - 1 } : null;
  });

  textObject("vimtexDelim", function (text, masked, off, inner) {
    const d = enclosingDelims(masked, off);
    if (!d) return null;
    return inner ? { start: d.openEnd, end: d.sized ? d.rightStart : d.closeStart } : { start: d.outerStart, end: d.outerEnd };
  });

  textObject("vimtexSection", function (text, masked, off, inner) {
    const secs = findSections(masked);
    let cur = null;
    for (const s of secs) if (s.start <= off) cur = s;
    if (!cur) return null;
    const next = secs.find(s => s.start > cur.start && s.level <= cur.level);
    const docEnd = masked.indexOf("\\end{document}", cur.start);
    let end = next ? next.start : docEnd !== -1 ? lineStart(text, docEnd) : text.length;
    const start = inner ? Math.min(lineEnd(text, cur.cmd) + 1, end) : cur.start;
    return { start, end, linewise: true };
  });

  [["e", "vimtexEnv"], ["$", "vimtexMath"], ["c", "vimtexCommand"], ["d", "vimtexDelim"], ["P", "vimtexSection"]]
    .forEach(function ([ch, motion]) {
      Vim.mapCommand("i" + ch, "motion", motion, { textObjectInner: true });
      Vim.mapCommand("a" + ch, "motion", motion, { textObjectInner: false });
    });

  // ----- Motions -----
  function jumpMotion(name, find) {
    Vim.defineMotion(name, function (cm, head, motionArgs) {
      const { masked } = docOf(cm);
      let off = cm.indexFromPos(head);
      for (let i = 0; i < (motionArgs.repeat || 1); i++) {
        const next = find(masked, off, motionArgs.forward);
        if (next === null || next === undefined) break;
        off = next;
      }
      return cm.posFromIndex(off);
    });
  }

  function nearest(offsets, off, forward) {
    if (forward) return offsets.find(o => o > off) ?? null;
    let best = null;
    for (const o of offsets) if (o < off) best = o;
    return best;
  }

  jumpMotion("vimtexSection", function (masked, off, forward) {
    return nearest(findSections(masked).map(s => s.start), off, forward);
  });
  jumpMotion("vimtexBegin", function (masked, off, forward) {
    return nearest(findEnvPairs(masked).map(p => p.beginStart), off, forward);
  });
  jumpMotion("vimtexEnd", function (masked, off, forward) {
    return nearest(findEnvPairs(masked).map(p => p.endStart).sort((a, b) => a - b), off, forward);
  });
  jumpMotion("vimtexMathJump", function (masked, off, forward) {
    return nearest(findMathZones(masked).map(z => z.openStart).sort((a, b) => a - b), off, forward);
  });

  [["]]", "vimtexSection", true], ["[[", "vimtexSection", false],
   ["]m", "vimtexBegin", true], ["[m", "vimtexBegin", false],
   ["]M", "vimtexEnd", true], ["[M", "vimtexEnd", false],
   ["]n", "vimtexMathJump", true], ["[n", "vimtexMathJump", false]]
    .forEach(function ([keys, motion, forward]) {
      Vim.mapCommand(keys, "motion", motion, { forward, toJumplist: true });
    });

  // % : \begin <-> \end, otherwise ordinary bracket matching.
  Vim.defineMotion("vimtexPercent", function (cm, head) {
    const { masked } = docOf(cm);
    const off = cm.indexFromPos(head);
    const le = lineEnd(masked, off);
    if (isTex()) {
      for (const p of findEnvPairs(masked)) {
        if (p.beginStart <= off && off < p.beginEnd) return cm.posFromIndex(p.endStart);
        if (p.endStart <= off && off < p.endEnd) return cm.posFromIndex(p.beginStart);
      }
    }
    // First bracket at or after the cursor on this line.
    for (let i = off; i < le; i++) {
      const c = masked[i];
      if (OPEN_DELIMS[c]) {
        let depth = 0;
        for (let j = i; j < masked.length; j++) {
          if (masked[j] === "\\") { j++; continue; }
          if (masked[j] === c) depth++;
          else if (masked[j] === OPEN_DELIMS[c] && --depth === 0) return cm.posFromIndex(j);
        }
        return head;
      }
      if (CLOSE_DELIMS[c]) {
        let depth = 0;
        for (let j = i; j >= 0; j--) {
          if (j > 0 && masked[j - 1] === "\\") continue;
          if (masked[j] === c) depth++;
          else if (masked[j] === CLOSE_DELIMS[c] && --depth === 0) return cm.posFromIndex(j);
        }
        return head;
      }
    }
    return head;
  });
  Vim.mapCommand("%", "motion", "vimtexPercent", { inclusive: true, toJumplist: true });

  // ----- Surround-style commands (ds*, cs*, ts*) -----
  function withDoc(fn) {
    return function (cm) {
      const editor = cm.editor;
      const { text, masked } = docOf(cm);
      return fn(editor, text, masked, offsetOf(cm));
    };
  }

  const commands = {
    dse: withDoc(function (editor, text, masked, off) {
      const env = enclosingEnv(masked, off);
      if (!env) return;
      applyEdits(editor, monaco, [
        tokenDeletion(text, env.endStart, env.endEnd),
        tokenDeletion(text, env.beginStart, env.beginEnd)
      ]);
    }),
    cse: withDoc(async function (editor, text, masked, off) {
      const env = enclosingEnv(masked, off);
      if (!env) return;
      const name = await hooks.prompt("Change surrounding environment", env.name);
      if (!name || name === env.name) return;
      rename(editor, env, name);
    }),
    tse: withDoc(function (editor, text, masked, off) {
      const env = enclosingEnv(masked, off);
      if (env) rename(editor, env, toggleStar(env.name));
    }),
    dsc: withDoc(function (editor, text, masked, off) {
      const cmd = enclosingCommand(masked, off);
      if (!cmd) return;
      const arg = cmd.args.filter(a => a.type === "{").pop();
      const inner = arg ? text.slice(arg.start + 1, arg.end - 1) : "";
      applyEdits(editor, monaco, [{ start: cmd.start, end: cmd.end, text: inner }]);
    }),
    csc: withDoc(async function (editor, text, masked, off) {
      const cmd = enclosingCommand(masked, off);
      if (!cmd) return;
      const name = await hooks.prompt("Change surrounding command", cmd.name);
      if (!name || name === cmd.name) return;
      applyEdits(editor, monaco, [{ start: cmd.start + 1, end: cmd.nameEnd - (cmd.starred ? 1 : 0), text: name.replace(/^\\/, "") }]);
    }),
    tsc: withDoc(function (editor, text, masked, off) {
      const cmd = enclosingCommand(masked, off);
      if (!cmd) return;
      applyEdits(editor, monaco, cmd.starred
        ? [{ start: cmd.nameEnd - 1, end: cmd.nameEnd, text: "" }]
        : [{ start: cmd.nameEnd, end: cmd.nameEnd, text: "*" }]);
    }),
    "ds$": withDoc(function (editor, text, masked, off) {
      const z = enclosingMath(masked, off);
      if (!z) return;
      if (z.kind === "env") {
        applyEdits(editor, monaco, [tokenDeletion(text, z.closeStart, z.closeEnd), tokenDeletion(text, z.openStart, z.openEnd)]);
      } else {
        applyEdits(editor, monaco, [{ start: z.closeStart, end: z.closeEnd, text: "" }, { start: z.openStart, end: z.openEnd, text: "" }]);
      }
    }),
    "cs$": withDoc(async function (editor, text, masked, off) {
      const z = enclosingMath(masked, off);
      if (!z) return;
      const current = z.kind === "env" ? z.env.name : z.kind;
      const target = await hooks.prompt("Change math to ($, \\[, \\(, or an environment name)", current);
      if (!target || target === current) return;
      const body = text.slice(z.openEnd, z.closeStart);
      applyEdits(editor, monaco, [{ start: z.openStart, end: z.closeEnd, text: wrapMath(target, body) }]);
    }),
    "ts$": withDoc(function (editor, text, masked, off) {
      const z = enclosingMath(masked, off);
      if (!z) return;
      const body = text.slice(z.openEnd, z.closeStart);
      // Inline -> \[ \]; any display form -> $ $.
      const target = z.kind === "$" || z.kind === "\\(" ? "\\[" : "$";
      const trimmed = target === "$" ? body.trim() : body;
      applyEdits(editor, monaco, [{ start: z.openStart, end: z.closeEnd, text: wrapMath(target, trimmed) }]);
    }),
    dsd: withDoc(function (editor, text, masked, off) {
      const d = enclosingDelims(masked, off);
      if (!d) return;
      applyEdits(editor, monaco, [
        { start: d.sized ? d.rightStart : d.closeStart, end: d.closeEnd, text: "" },
        { start: d.outerStart, end: d.openEnd, text: "" }
      ]);
    }),
    tsd: withDoc(function (editor, text, masked, off) {
      const d = enclosingDelims(masked, off);
      if (!d) return;
      if (d.sized) {
        applyEdits(editor, monaco, [
          { start: d.rightStart, end: d.closeStart, text: "" },
          { start: d.leftStart, end: d.openStart, text: "" }
        ]);
      } else {
        applyEdits(editor, monaco, [
          { start: d.closeStart, end: d.closeStart, text: "\\right" },
          { start: d.openStart, end: d.openStart, text: "\\left" }
        ]);
      }
    }),
    tsf: withDoc(function (editor, text, masked, off) {
      const cmd = enclosingCommand(masked, off);
      if (cmd && /^[dt]?frac$/.test(cmd.name) && cmd.args.length >= 2) {
        const [a, b] = cmd.args;
        const wrap = s => /^[\w.\\]+$/.test(s) ? s : "(" + s + ")";
        const num = text.slice(a.start + 1, a.end - 1);
        const den = text.slice(b.start + 1, b.end - 1);
        applyEdits(editor, monaco, [{ start: cmd.start, end: cmd.end, text: wrap(num) + "/" + wrap(den) }]);
        return;
      }
      // a/b around the cursor -> \frac{a}{b}
      const ls = lineStart(text, off);
      const le = lineEnd(text, off);
      const line = text.slice(ls, le);
      const re = /(\([^()]*\)|[\w.\\^]+)\s*\/\s*(\([^()]*\)|[\w.\\^]+)/g;
      let m;
      while ((m = re.exec(line))) {
        if (ls + m.index <= off && off <= ls + m.index + m[0].length) {
          const strip = s => s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1) : s;
          applyEdits(editor, monaco, [{ start: ls + m.index, end: ls + m.index + m[0].length, text: "\\frac{" + strip(m[1]) + "}{" + strip(m[2]) + "}" }]);
          return;
        }
      }
    }),
    "\\ll": () => hooks.compile(),
    "\\lv": cm => { const p = cm.editor.getPosition(); if (p) hooks.view(p.lineNumber, p.column); },
    "\\lt": () => hooks.toc(),
    "\\le": () => hooks.errors()
  };

  function rename(editor, env, name) {
    const nameIn = (start, end) => {
      const tok = editor.getModel().getValue().slice(start, end);
      const b = tok.indexOf("{") + 1;
      return { start: start + b, end: start + tok.lastIndexOf("}"), text: name };
    };
    applyEdits(editor, monaco, [nameIn(env.endStart, env.endEnd), nameIn(env.beginStart, env.beginEnd)]);
  }

  function wrapMath(target, body) {
    const t = target.trim();
    if (t === "$") return "$" + body + "$";
    if (t === "$$") return "$$" + body + "$$";
    if (t === "\\(" || t === "(") return "\\(" + body + "\\)";
    if (t === "\\[" || t === "[") {
      const inner = body.includes("\n") ? body : "\n  " + body.trim() + "\n";
      return "\\[" + inner + "\\]";
    }
    const inner = body.includes("\n") ? body : "\n  " + body.trim() + "\n";
    return "\\begin{" + t + "}" + inner + "\\end{" + t + "}";
  }

  // Insert-mode ]] closes the innermost environment still open at the cursor.
  function closeEnvironment(cm) {
    const editor = cm.editor;
    const { masked } = docOf(cm);
    const off = offsetOf(cm);
    const before = masked.slice(0, off - 1);
    const stack = [];
    const re = /\\(begin|end)\s*\{([^}\n]*)\}/g;
    let m;
    while ((m = re.exec(before))) {
      const name = m[2].trim();
      if (m[1] === "begin") stack.push(name);
      else {
        const i = stack.lastIndexOf(name);
        if (i !== -1) stack.length = i;
      }
    }
    const name = stack.pop();
    if (!name) return false;
    applyEdits(editor, monaco, [{ start: off - 1, end: off, text: "\\end{" + name + "}" }]);
    return true;
  }

  // ----- Key sequences -----
  // monaco-vim runs the first command that fully matches, so "d" would fire
  // before "dse" could. We sit in front of its key lookup, hold back keys
  // while they could still start one of our sequences, and replay them to
  // vim untouched when they turn out not to.
  const sequences = Object.keys(commands);
  const origFindKey = Vim.findKey;
  let pending = "";

  Vim.findKey = function (cm, key, origin) {
    const vim = cm.state && cm.state.vim;
    const plain = vim && !vim.visualMode && !vim.insertMode && isTex();

    if (vim && vim.insertMode && key === "]" && isTex()) {
      const pos = cm.getCursor("head");
      if (pos.ch > 0 && cm.getLine(pos.line)[pos.ch - 1] === "]") {
        return function () { if (!closeEnvironment(cm)) cm.editor.trigger("vimtex", "type", { text: "]" }); return true; };
      }
    }

    const fresh = vim && !vim.inputState.operator && !(vim.inputState.keyBuffer || "").length;
    if (!plain || origin === "mapping" || (!pending && !fresh)) {
      return origFindKey.call(this, cm, key, origin);
    }
    const keys = pending + key;
    if (commands[keys]) {
      pending = "";
      return function () {
        cm.dispatch("vim-command-done");
        commands[keys](cm);
        return true;
      };
    }
    if (sequences.some(s => s.startsWith(keys))) {
      pending = keys;
      return function () { return true; };
    }
    // Not ours after all: hand every held key to vim, in order. Our
    // sequences are plain characters, so the held keys split per character.
    const held = pending.split("").concat([key]);
    pending = "";
    if (held.length === 1) return origFindKey.call(this, cm, key, origin);
    const self = this;
    return function () {
      held.forEach(function (k) {
        const fn = origFindKey.call(self, cm, k, origin);
        if (typeof fn === "function") fn();
      });
      return true;
    };
  };

  return function uninstall() {
    Vim.findKey = origFindKey;
    pending = "";
  };
}
