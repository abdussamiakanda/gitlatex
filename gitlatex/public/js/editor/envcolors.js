/**
 * Colouring matching \begin/\end pairs so nesting is visible at a glance.
 */

import { state } from "../core/state.js";

// ----- Environment pair colouring -----
// \begin{X} and its \end{X} share a colour, derived from the name, so the
// same environment always looks the same. Unmatched ones are flagged.
export const ENV_COLOR_COUNT = 12;

// Colours are handed out per document in order of first appearance, so the
// environments actually used in a file get distinct colours. Hashing the
// name instead left 6 of 16 common names sharing one colour.
export function envColorAssigner() {
  const seen = new Map();
  return function (name) {
    if (!seen.has(name)) seen.set(name, seen.size % ENV_COLOR_COUNT);
    return seen.get(name);
  };
}

export function refreshEnvDecorations() {
  if (!state.editor || !state.monacoApi) return;
  const model = state.editor.getModel();
  if (!model) return;
  if (!state.envDecorations) state.envDecorations = state.editor.createDecorationsCollection([]);
  const isTex = typeof model.getLanguageId === "function"
    ? model.getLanguageId() === "latex"
    : true;
  if (!isTex) {
    state.envDecorations.set([]);
    return;
  }

  const found = model.findMatches(
    "\\\\(begin|end)\\s*\\{([^}]*)\\}", false, true, false, null, true
  );
  const stack = [];
  const decorations = [];
  const unmatchedEnd = [];
  const colorFor = envColorAssigner();

  found.forEach(function (m) {
    const kind = m.matches[1];
    const name = (m.matches[2] || "").trim();
    if (kind === "begin") {
      stack.push({ name: name, range: m.range });
    } else {
      // Pop the nearest open environment with this name.
      let i = stack.length - 1;
      while (i >= 0 && stack[i].name !== name) i--;
      if (i >= 0) stack.splice(i, 1);
      else unmatchedEnd.push(m.range);
    }
    decorations.push({
      range: m.range,
      options: {
        inlineClassName: "tex-env tex-env-" + colorFor(name),
        hoverMessage: { value: "`" + name + "` environment" }
      }
    });
  });

  // Anything still open never got closed.
  stack.forEach(function (open) {
    decorations.push({
      range: open.range,
      options: {
        inlineClassName: "tex-env-unmatched",
        hoverMessage: { value: "Unclosed environment `" + open.name + "`" }
      }
    });
  });
  unmatchedEnd.forEach(function (range) {
    decorations.push({
      range: range,
      options: {
        inlineClassName: "tex-env-unmatched",
        hoverMessage: { value: "No matching `\\begin` for this `\\end`" }
      }
    });
  });

  state.envDecorations.set(decorations);
}
