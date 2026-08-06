/**
 * LaTeX and BibTeX syntax definitions, and the two editor colour themes.
 *
 * registerLanguages() runs once, as soon as Monaco has loaded.
 */

export function registerLanguages(monaco) {
    // Register LaTeX so completion provider and options apply
    monaco.languages.register({ id: "latex" });
    monaco.languages.setLanguageConfiguration("latex", {
      wordPattern: /\\[a-zA-Z*]*/,
      brackets: [["{", "}"], ["[", "]"], ["\\begin{", "\\end{"], ["\\left(", "\\right)"], ["\\left[", "\\right]"], ["\\left\\{", "\\right\\}"]],
      autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: "$", close: "$" }]
    });
    monaco.languages.setMonarchTokensProvider("latex", {
      tokenizer: {
        root: [
          [/%[^\n]*/, "comment"],
          // Split so the environment name can be coloured separately from
          // the \begin / \end command itself.
          [/(\\begin)(\s*\{)([^}]*)(\})/,
            ["keyword.env", "delimiter.bracket", "type.env", "delimiter.bracket"]],
          [/(\\end)(\s*\{)([^}]*)(\})/,
            ["keyword.env", "delimiter.bracket", "type.env", "delimiter.bracket"]],
          // Cross-references and citations: highlight the key, not just the command.
          [/(\\(?:label))(\s*\{)([^}]*)(\})/,
            ["keyword", "delimiter.bracket", "string.label", "delimiter.bracket"]],
          [/(\\(?:[a-zA-Z]*ref|cite[a-zA-Z]*)\*?)(\s*(?:\[[^\]]*\])?\s*\{)([^}]*)(\})/,
            ["keyword", "delimiter.bracket", "string.ref", "delimiter.bracket"]],
          [/(\\(?:usepackage|documentclass|include|input|bibliography|bibliographystyle))(\s*(?:\[[^\]]*\])?\s*\{)([^}]*)(\})/,
            ["keyword.strong", "delimiter.bracket", "string.package", "delimiter.bracket"]],
          [/\\(usepackage|documentclass|include|input|bibliography|bibliographystyle|usepackage)(\{[^}]*\})?/, "keyword"],
          [/\\(section|subsection|subsubsection|chapter|paragraph|subparagraph|part)\*?/, "keyword.strong"],
          [/\\(textbf|textit|texttt|textsf|textsc|emph|underline|textmd|textrm|textup|textnormal|textsl|textbf)\{/, "keyword", "@texArgBold"],
          [/\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def|let|newenvironment|renewenvironment)/, "keyword"],
          [/\\(caption|label|ref|pageref|eqref|autoref|cite|citep|citet|nocite|footnote|thanks|maketitle|tableofcontents|listoffigures|listoftables|appendix|addcontentsline|addtocontents|clearpage|newpage|pagebreak|linebreak|nolinebreak|newline|today|TeX|LaTeX|LaTeXe)/, "keyword"],
          [/\\(begin|end|item|hspace|vspace|hfill|vfill|centering|raggedright|raggedleft|noindent|indent|par|smallskip|medskip|bigskip)/, "keyword"],
          [/\\(title|author|date|address|email|institute|thanks|and)/, "keyword"],
          [/\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|varepsilon|vartheta|varpi|varrho|varsigma|varphi)/, "type"],
          [/\\(int|sum|prod|oint|coprod|bigcup|bigcap|bigvee|bigwedge|bigoplus|bigotimes|bigodot|biguplus|lim|log|ln|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|coth|det|dim|gcd|hom|inf|ker|lg|max|min|Pr|sup|exp|deg|mod|bmod|pmod|pm|mp|times|div|ast|star|circ|bullet|cdot|cap|cup|uplus|sqcap|sqcup|vee|wedge|setminus|wr|diamond|bigtriangleup|bigtriangledown|triangleleft|triangleright|lhd|rhd|unlhd|unrhd|oplus|ominus|otimes|oslash|odot|bigcirc|dagger|ddagger|amalg|leq|geq|neq|equiv|approx|cong|propto|sim|simeq|asymp|doteq|parallel|models|bot|mid|prec|succ|preceq|succeq|ll|gg|subset|supset|subseteq|supseteq|sqsubset|sqsupseteq|in|ni|notin|vdash|dashv|smile|frown|perp|bowtie|Join|propto|mapsto|to|gets|leftarrow|rightarrow|uparrow|downarrow|updownarrow|Leftarrow|Rightarrow|Uparrow|Downarrow|Updownarrow|longleftarrow|longrightarrow|longleftrightarrow|Longleftarrow|Longrightarrow|Longleftrightarrow|nearrow|searrow|swarrow|nwarrow|leftharpoonup|leftharpoondown|rightharpoonup|rightharpoondown|rightleftharpoons|leadsto|iff)/, "type"],
          [/\\[a-zA-Z@*]+/, "keyword"],
          [/\$\$/, { token: "delimiter.math", next: "@mathDisplay" }],
          [/\$/, { token: "delimiter.math", next: "@mathInline" }],
          [/[{}]/, "delimiter.bracket"]
        ],
        texArgBold: [
          [/[^}]+/, "string"],
          [/\}/, "delimiter.bracket", "@pop"]
        ],
        mathDisplay: [
          [/\$\$/, { token: "delimiter.math", next: "@pop" }],
          [/\\[a-zA-Z@*]+/, "type"],
          [/[{}]/, "delimiter.bracket"],
          [/[0-9]+/, "number"],
          [/[_^]/, "operator"],
          [/\w+/, "identifier"]
        ],
        mathInline: [
          [/\$/, { token: "delimiter.math", next: "@pop" }],
          [/\\[a-zA-Z@*]+/, "type"],
          [/[{}]/, "delimiter.bracket"],
          [/[0-9]+/, "number"],
          [/[_^]/, "operator"],
          [/\w+/, "identifier"]
        ]
      }
    });

    // === Editor color themes so LaTeX + BibTeX tokens are visible ===
    monaco.editor.defineTheme("gitlatex-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "keyword", foreground: "569cd6" },
        { token: "keyword.strong", foreground: "4ec9b0", fontStyle: "bold" },
        { token: "keyword.env", foreground: "c586c0", fontStyle: "bold" },
        { token: "type.env", foreground: "4ec9b0" },
        { token: "string.label", foreground: "dcdcaa" },
        { token: "string.ref", foreground: "d7ba7d" },
        { token: "string.package", foreground: "ce9178" },
        { token: "type", foreground: "c586c0" },
        { token: "string", foreground: "ce9178" },
        { token: "number", foreground: "b5cea8" },
        { token: "delimiter.bracket", foreground: "808080" },
        { token: "delimiter.math", foreground: "e8ab53", fontStyle: "bold" },
        { token: "operator", foreground: "d4d4d4" },
        { token: "identifier", foreground: "9cdcfe" }
      ],
      colors: {
        "editor.background": "#0d1117",
        "editor.foreground": "#e6edf3",
        "editorCursor.foreground": "#e6edf3",
        "editorLineNumber.foreground": "#484f58",
        "editorLineNumber.activeForeground": "#8b949e",
        // Spelling markers use Info severity; blue keeps them apart from
        // compile errors and warnings.
        "editorInfo.foreground": "#4a9eff"
      }
    });
    monaco.editor.defineTheme("gitlatex-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "keyword", foreground: "0000ff" },
        { token: "keyword.strong", foreground: "795e26", fontStyle: "bold" },
        { token: "keyword.env", foreground: "af00db", fontStyle: "bold" },
        { token: "type.env", foreground: "267f99" },
        { token: "string.label", foreground: "7a6a00" },
        { token: "string.ref", foreground: "8a5a00" },
        { token: "string.package", foreground: "a31515" },
        { token: "type", foreground: "af00db" },
        { token: "string", foreground: "a31515" },
        { token: "number", foreground: "098658" },
        { token: "delimiter.bracket", foreground: "808080" },
        { token: "delimiter.math", foreground: "d16969", fontStyle: "bold" },
        { token: "operator", foreground: "000000" },
        { token: "identifier", foreground: "001080" }
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#1f2328",
        "editorCursor.foreground": "#1f2328",
        "editorLineNumber.foreground": "#8c959f",
        "editorLineNumber.activeForeground": "#656d76",
        "editorInfo.foreground": "#1a73e8"
      }
    });

    // Register BibTeX for .bib files
    monaco.languages.register({ id: "bib" });
    monaco.languages.setLanguageConfiguration("bib", {
      wordPattern: /@[a-zA-Z]*|[a-zA-Z][a-zA-Z0-9]*/
    });
}
