/**
 * User snippets: the user's own prefixes that expand into LaTeX.
 *
 * Stored by the server in ~/.gitlatex/snippets.json, so every project and
 * every browser sees the same set. A snippet expands when it is picked from
 * the suggestion list, or when its exact prefix is typed and Tab is pressed.
 * Bodies use Monaco snippet syntax: $1, ${1:default}, ${1|a,b|}, $0.
 */

import { fetchJson } from "../core/api.js";
import { setConsole } from "../ui/consolepane.js";
import { showInputModal } from "../ui/modals.js";

let snippets = [];
let loadPromise = null;

export function getSnippets() {
  return snippets;
}

export function loadSnippets(force) {
  if (loadPromise && !force) return loadPromise;
  loadPromise = fetchJson("/snippets").then(function (data) {
    snippets = Array.isArray(data.snippets) ? data.snippets : [];
    return snippets;
  }).catch(function () {
    loadPromise = null;
    return snippets;
  });
  return loadPromise;
}

/** Replaces the saved list. Resolves to { snippets } or { error }. */
export async function saveSnippets(list) {
  const data = await fetchJson("/snippets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snippets: list })
  });
  if (!data.error) {
    snippets = data.snippets || [];
    loadPromise = Promise.resolve(snippets);
  }
  return data;
}

function inScope(snippet, languageId) {
  return snippet.scope === "all" || snippet.scope === languageId;
}

/** The text a prefix could have been typed as: back to whitespace or a bracket. */
function tokenBefore(textBefore) {
  return /[^\s{}()[\],;]*$/.exec(textBefore)[0];
}

/** Longest snippet whose prefix ends exactly at the cursor. */
function snippetAtCursor(model, position) {
  const textBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const token = tokenBefore(textBefore);
  let best = null;
  for (const s of snippets) {
    if (!inScope(s, model.getLanguageId())) continue;
    if (!token.endsWith(s.prefix)) continue;
    // "eq" should not fire inside "seq"; a prefix that starts with a
    // symbol (\, @, ;) may follow anything.
    const charBefore = textBefore.charAt(textBefore.length - s.prefix.length - 1);
    if (/\w/.test(s.prefix[0]) && /\w/.test(charBefore)) continue;
    if (!best || s.prefix.length > best.prefix.length) best = s;
  }
  return best;
}

/** Plain text -> snippet body, escaping characters Monaco would interpret. */
export function textToSnippetBody(text) {
  return text.replace(/[\\$}]/g, "\\$&");
}

export function registerSnippets(monaco, editor) {
  loadSnippets();

  ["latex", "bib"].forEach(function (languageId) {
    monaco.languages.registerCompletionItemProvider(languageId, {
      provideCompletionItems(model, position) {
        const textBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const token = tokenBefore(textBefore);
        if (!token) return { suggestions: [] };
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: position.column - token.length,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        };
        const suggestions = snippets
          .filter(s => inScope(s, languageId))
          .map(s => ({
            label: { label: s.prefix, description: s.description || "user snippet" },
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: s.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: s.prefix,
            // Ahead of the built-in command list when both match.
            sortText: "!" + s.prefix,
            detail: "User snippet",
            documentation: { value: "```latex\n" + s.body + "\n```" },
            range
          }));
        return { suggestions };
      }
    });
  });

  // Tab after an exact prefix expands it. Only when no suggestion list or
  // snippet placeholders already own Tab; otherwise Tab behaves as before.
  editor.addCommand(
    monaco.KeyCode.Tab,
    function () {
      const model = editor.getModel();
      const selection = editor.getSelection();
      const snippet = model && selection && selection.isEmpty() && snippetAtCursor(model, selection.getPosition());
      if (!snippet) {
        editor.trigger("keyboard", "tab", null);
        return;
      }
      editor.getContribution("snippetController2").insert(snippet.body, {
        overwriteBefore: snippet.prefix.length,
        overwriteAfter: 0
      });
    },
    "editorTextFocus && !editorReadonly && !suggestWidgetVisible && !inSnippetMode && !editorHasSelection && !editorTabMovesFocus"
  );

  editor.addAction({
    id: "gitlatex.snippets.saveSelection",
    label: "Save Selection as Snippet…",
    contextMenuGroupId: "1_modification",
    contextMenuOrder: 4,
    precondition: "editorHasSelection",
    run: async function (ed) {
      const text = ed.getModel().getValueInRange(ed.getSelection());
      if (!text.trim()) return;
      const prefix = await showInputModal({
        title: "New snippet",
        label: "Prefix (type it, then press Tab)",
        placeholder: "e.g. fig",
        submitLabel: "Save"
      });
      ed.focus();
      if (!prefix) return;
      await loadSnippets();
      const scope = ed.getModel().getLanguageId() === "bib" ? "bib" : "latex";
      const next = snippets.filter(s => !(s.prefix === prefix && s.scope === scope));
      next.push({ prefix, body: textToSnippetBody(text) + "$0", description: "", scope });
      const res = await saveSnippets(next);
      setConsole(res.error
        ? "Could not save snippet: " + res.error
        : "Saved snippet \"" + prefix + "\". Type it and press Tab to insert it.");
    }
  });
}

// ----- Settings: snippet manager -----

let editingIndex = null;  // null = form closed, -1 = new snippet

function setStatus(text, kind) {
  const el = document.getElementById("snippets-status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "settings-save-status" + (kind ? " " + kind : "");
  if (kind === "success") setTimeout(() => { if (el.textContent === text) setStatus(""); }, 2000);
}

export async function populateSnippetSettings() {
  await loadSnippets(true);
  renderSnippetList();
}

function renderSnippetList() {
  const list = document.getElementById("snippets-list");
  const empty = document.getElementById("snippets-empty");
  if (!list) return;
  list.innerHTML = "";
  empty?.classList.toggle("hidden", snippets.length > 0);
  snippets.forEach(function (s, i) {
    const row = document.createElement("div");
    row.className = "snippet-row";

    const prefix = document.createElement("code");
    prefix.className = "snippet-prefix";
    prefix.textContent = s.prefix;

    const desc = document.createElement("span");
    desc.className = "snippet-desc";
    desc.textContent = s.description || s.body.split("\n")[0];
    desc.title = s.body;

    const scope = document.createElement("span");
    scope.className = "snippet-scope";
    scope.textContent = s.scope === "all" ? "all" : s.scope === "bib" ? ".bib" : ".tex";

    const edit = iconButton("edit", "Edit snippet", () => openSnippetForm(i));
    const del = iconButton("delete", "Delete snippet", async function () {
      const res = await saveSnippets(snippets.filter((_, k) => k !== i));
      if (res.error) setStatus(res.error, "error");
      if (editingIndex === i) closeSnippetForm();
      renderSnippetList();
    });

    row.append(prefix, desc, scope, edit, del);
    list.appendChild(row);
  });
}

function iconButton(icon, label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-btn snippet-action";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = '<span class="material-icons" aria-hidden="true"></span>';
  b.firstChild.textContent = icon;
  b.addEventListener("click", onClick);
  return b;
}

export function openSnippetForm(index) {
  const form = document.getElementById("snippet-form");
  if (!form) return;
  editingIndex = index;
  const s = index >= 0 ? snippets[index] : { prefix: "", body: "", description: "", scope: "latex" };
  document.getElementById("snippet-prefix").value = s.prefix;
  document.getElementById("snippet-description").value = s.description || "";
  document.getElementById("snippet-scope").value = s.scope;
  document.getElementById("snippet-body").value = s.body;
  form.classList.remove("hidden");
  setStatus("");
  document.getElementById("snippet-prefix").focus();
}

export function closeSnippetForm() {
  editingIndex = null;
  document.getElementById("snippet-form")?.classList.add("hidden");
}

export async function submitSnippetForm() {
  if (editingIndex === null) return;
  const snippet = {
    prefix: document.getElementById("snippet-prefix").value.trim(),
    description: document.getElementById("snippet-description").value.trim(),
    scope: document.getElementById("snippet-scope").value,
    body: document.getElementById("snippet-body").value
  };
  if (!snippet.prefix || /\s/.test(snippet.prefix)) {
    setStatus("The prefix must be one word with no spaces.", "error");
    return;
  }
  if (!snippet.body.trim()) {
    setStatus("The snippet body is empty.", "error");
    return;
  }
  const next = snippets.slice();
  const clash = next.findIndex((s, i) => i !== editingIndex && s.prefix === snippet.prefix && s.scope === snippet.scope);
  if (clash !== -1) {
    setStatus("Another snippet already uses \"" + snippet.prefix + "\".", "error");
    return;
  }
  if (editingIndex >= 0) next[editingIndex] = snippet;
  else next.push(snippet);
  const res = await saveSnippets(next);
  if (res.error) {
    setStatus(res.error, "error");
    return;
  }
  closeSnippetForm();
  renderSnippetList();
  setStatus("Saved", "success");
}

/** Accepts our own export or a VS Code snippets file ({name: {prefix, body}}). */
export async function importSnippetsFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    setStatus("That file is not valid JSON.", "error");
    return;
  }
  let incoming = Array.isArray(data) ? data : Array.isArray(data.snippets) ? data.snippets : null;
  if (!incoming && data && typeof data === "object") {
    incoming = [];
    Object.keys(data).forEach(function (name) {
      const s = data[name] || {};
      const prefixes = Array.isArray(s.prefix) ? s.prefix : [s.prefix];
      prefixes.filter(Boolean).forEach(function (prefix) {
        incoming.push({ prefix, body: s.body, description: s.description || name, scope: "latex" });
      });
    });
  }
  // Imported snippets win over existing ones with the same prefix.
  const merged = snippets.slice();
  let count = 0;
  (incoming || []).forEach(function (s) {
    if (!s || !s.prefix || !s.body) return;
    const body = Array.isArray(s.body) ? s.body.join("\n") : String(s.body);
    const item = { prefix: String(s.prefix).trim(), body, description: s.description || "", scope: s.scope || "latex" };
    const at = merged.findIndex(m => m.prefix === item.prefix && m.scope === item.scope);
    if (at === -1) merged.push(item);
    else merged[at] = item;
    count++;
  });
  if (!count) {
    setStatus("No snippets found in that file.", "error");
    return;
  }
  const res = await saveSnippets(merged);
  if (res.error) {
    setStatus(res.error, "error");
    return;
  }
  renderSnippetList();
  setStatus("Imported " + count + " snippet" + (count === 1 ? "" : "s"), "success");
}

export function exportSnippets() {
  const blob = new Blob([JSON.stringify({ snippets }, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gitlatex-snippets.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
