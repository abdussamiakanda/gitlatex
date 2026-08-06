/**
 * IntelliSense: LaTeX commands and environments, \ref/\cite keys, BibTeX fields.
 *
 * registerCompletions() runs once, as soon as Monaco has loaded. The command
 * lists are fetched from the JSON files in public/.
 */

import { state } from "../core/state.js";

export function registerCompletions(monaco) {
    // LaTeX IntelliSense: load commands/envs from JSON, then populate list for completion provider
    const kindMap = {
      Class: monaco.languages.CompletionItemKind.Class,
      Module: monaco.languages.CompletionItemKind.Module,
      Snippet: monaco.languages.CompletionItemKind.Snippet,
      Keyword: monaco.languages.CompletionItemKind.Keyword,
      Function: monaco.languages.CompletionItemKind.Function,
      Constant: monaco.languages.CompletionItemKind.Constant,
      Reference: monaco.languages.CompletionItemKind.Reference,
      File: monaco.languages.CompletionItemKind.File
    };
    let latexCommands = [];
    fetch("/latex-commands.json")
      .then(res => res.json())
      .then(data => {
        latexCommands = (data.commands || []).map(c => ({
          label: c.label,
          insertText: c.insertText,
          detail: c.detail,
          kind: kindMap[c.kind] ?? monaco.languages.CompletionItemKind.Keyword
        }));
        (data.environments || []).forEach(env => {
          latexCommands.push({
            label: env,
            insertText: `begin{${env}}\n$0\n\\end{${env}}`,
            detail: `Environment: ${env}`,
            kind: monaco.languages.CompletionItemKind.Snippet
          });
        });
      })
      .catch(() => { latexCommands = []; });
    monaco.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["\\", "{"],
      provideCompletionItems(model, position) {
        const line = model.getLineContent(position.lineNumber);
        const offset = position.column - 1;
        const textBefore = line.slice(0, offset);
        const backslash = textBefore.lastIndexOf("\\");
        if (backslash === -1) return { suggestions: [] };
        const prefix = textBefore.slice(backslash + 1).replace(/[^a-zA-Z*]/g, "");
        const range = { startLineNumber: position.lineNumber, startColumn: backslash + 2, endLineNumber: position.lineNumber, endColumn: position.column };
        const suggestions = latexCommands
          .filter(c => c.label.toLowerCase().startsWith(prefix.toLowerCase()))
          .map(c => ({
            ...c,
            range,
            filterText: "\\" + c.label,
            insertTextRules: c.insertText && c.insertText.includes("$") ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined
          }));
        return { suggestions };
      }
    });

    // \ref / \cite completion from the project's labels and .bib keys.
    // Inside \ref{...} or \cite{...} these replace the generic command list.
    monaco.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["{", ","],
      provideCompletionItems(model, position) {
        const textBefore = model.getLineContent(position.lineNumber)
          .slice(0, position.column - 1);
        // Nearest unclosed \cmd{ ... to the left, allowing multiple keys.
        const m = /\\([a-zA-Z]*(?:ref|cite)[a-zA-Z]*)\s*(?:\[[^\]]*\])?\{([^}]*)$/.exec(textBefore);
        if (!m) return { suggestions: [] };
        const isCite = /cite/i.test(m[1]);
        const typedAll = m[2];
        const lastSep = Math.max(typedAll.lastIndexOf(","), typedAll.lastIndexOf(" "));
        const typed = typedAll.slice(lastSep + 1);
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        };
        const source = isCite ? state.projectCitations : state.projectLabels;
        const suggestions = source.map(function (item) {
          const key = isCite ? item.key : item.label;
          const detail = isCite
            ? [item.year, item.author].filter(Boolean).join(" · ")
            : item.file + ":" + item.line;
          return {
            label: key,
            insertText: key,
            range,
            filterText: key,
            detail: detail,
            documentation: isCite ? (item.title || "") : ("Defined in " + item.file),
            kind: isCite
              ? monaco.languages.CompletionItemKind.Reference
              : monaco.languages.CompletionItemKind.Value
          };
        });
        // `true` = don't fall through to the generic command provider.
        return { suggestions, incomplete: false };
      }
    });

    // BibTeX IntelliSense for .bib files: entry types after @, fields when typing
    let bibEntryTypes = [];
    let bibFields = [];
    fetch("/bib-commands.json")
      .then(res => res.json())
      .then(data => {
        bibEntryTypes = (data.entryTypes || []).map(e => ({
          label: "@" + e.label,
          insertText: e.insertText,
          detail: e.detail,
          kind: monaco.languages.CompletionItemKind.Class
        }));
        bibFields = (data.fields || []).map(f => ({
          label: f.label,
          insertText: f.insertText,
          detail: f.detail,
          kind: monaco.languages.CompletionItemKind.Field
        }));
      })
      .catch(() => {});
    monaco.languages.registerCompletionItemProvider("bib", {
      triggerCharacters: ["@", "\n", " "],
      provideCompletionItems(model, position) {
        const line = model.getLineContent(position.lineNumber);
        const offset = position.column - 1;
        const textBefore = line.slice(0, offset);
        const atSign = textBefore.lastIndexOf("@");
        const suggestions = [];
        if (atSign !== -1) {
          const prefix = textBefore.slice(atSign + 1).replace(/[^a-zA-Z]/g, "");
          const range = { startLineNumber: position.lineNumber, startColumn: atSign + 2, endLineNumber: position.lineNumber, endColumn: position.column };
          bibEntryTypes
            .filter(e => e.label.toLowerCase().startsWith("@" + prefix.toLowerCase()))
            .forEach(e => {
              suggestions.push({
                ...e,
                range,
                filterText: e.label,
                insertTextRules: e.insertText && e.insertText.includes("$") ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined
              });
            });
        }
        const wordStart = textBefore.search(/[a-zA-Z][a-zA-Z0-9]*$/);
        const wordPrefix = wordStart === -1 ? "" : textBefore.slice(wordStart);
        if (wordPrefix.length >= 1 && suggestions.length === 0) {
          const range = wordStart === -1 ? { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column } : { startLineNumber: position.lineNumber, startColumn: wordStart + 1, endLineNumber: position.lineNumber, endColumn: position.column };
          bibFields
            .filter(f => f.label.toLowerCase().startsWith(wordPrefix.toLowerCase()))
            .forEach(f => {
              suggestions.push({
                ...f,
                range,
                filterText: f.label,
                insertTextRules: f.insertText && f.insertText.includes("$") ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined
              });
            });
        }
        return { suggestions };
      }
    });
}
