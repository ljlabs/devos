/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from "react";

// ---------------------------------------------------------------------------
// Regex-based syntax highlighter
//
// Matches common tokens and wraps them in <span> elements with color classes.
// Intentionally simple — handles single-line comments, string literals, and
// common keywords. Does not need to handle JSX or multi-line constructs.
// ---------------------------------------------------------------------------

interface Token {
  type: string;
  text: string;
}

const KEYWORDS = new Set([
  "import", "export", "from", "const", "let", "var", "function", "return",
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "class", "extends", "new", "this", "super", "typeof", "instanceof", "in",
  "of", "async", "await", "try", "catch", "finally", "throw", "yield",
  "default", "delete", "void", "static", "get", "set",
  // TypeScript
  "type", "interface", "enum", "implements", "abstract", "declare", "namespace",
  "module", "as", "is", "keyof", "readonly", "private", "public", "protected",
  // Python
  "def", "class", "elif", "except", "lambda", "with", "as", "pass", "raise",
  "True", "False", "None", "self",
]);

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Single-line comment
    if (line[i] === "/" && line[i + 1] === "/") {
      tokens.push({ type: "comment", text: line.slice(i) });
      break;
    }

    // Hash comment (Python, shell)
    if (line[i] === "#") {
      tokens.push({ type: "comment", text: line.slice(i) });
      break;
    }

    // Double-quoted string
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        if (line[j] === "\\") j++; // skip escaped char
        j++;
      }
      tokens.push({ type: "string", text: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // Single-quoted string
    if (line[i] === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== "'") {
        if (line[j] === "\\") j++;
        j++;
      }
      tokens.push({ type: "string", text: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // Backtick template
    if (line[i] === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== "`") {
        if (line[j] === "\\") j++;
        j++;
      }
      tokens.push({ type: "string", text: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // Number
    if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>![]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[0-9._xXoObBeE]/.test(line[j])) j++;
      tokens.push({ type: "number", text: line.slice(i, j) });
      i = j;
      continue;
    }

    // Word (potential keyword or identifier)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);

      if (KEYWORDS.has(word)) {
        tokens.push({ type: "keyword", text: word });
      } else if (j < line.length && line[j] === "(") {
        tokens.push({ type: "function", text: word });
      } else {
        tokens.push({ type: "text", text: word });
      }
      i = j;
      continue;
    }

    // Operator
    if (/[=<>!+\-*/&|^~%?:]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[=<>!+\-*/&|^~%?:]/.test(line[j])) j++;
      tokens.push({ type: "operator", text: line.slice(i, j) });
      i = j;
      continue;
    }

    // JSX/HTML tags
    if (line[i] === "<" && i > 0 && (line[i - 1] === "=" || line[i - 1] === " ")) {
      let j = i + 1;
      while (j < line.length && line[j] !== ">" && line[j] !== " ") j++;
      tokens.push({ type: "tag", text: line.slice(i, j) });
      i = j;
      continue;
    }

    // Whitespace and other characters
    tokens.push({ type: "text", text: line[i] });
    i++;
  }

  return tokens;
}

// Map token type to Tailwind color class
function tokenClass(type: string): string {
  switch (type) {
    case "keyword":   return "text-rose-500 font-medium";
    case "string":    return "text-emerald-400";
    case "comment":   return "text-slate-500 italic";
    case "function":  return "text-blue-400";
    case "number":    return "text-amber-400";
    case "operator":  return "text-amber-300";
    case "tag":       return "text-rose-500";
    default:          return "text-slate-200";
  }
}

// ---------------------------------------------------------------------------
// HighlightedLine component
// ---------------------------------------------------------------------------

function HighlightedLine({ line }: { line: string }) {
  const tokens = useMemo(() => tokenizeLine(line), [line]);

  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={tokenClass(token.type)}>
          {token.text}
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// CodeDisplay component
// ---------------------------------------------------------------------------

interface CodeDisplayProps {
  content: string;
  truncated?: boolean;
  className?: string;
}

/**
 * Read-only code display with line numbers and basic syntax highlighting.
 * Optimized for mobile with monospace font and horizontal scroll.
 */
export default function CodeDisplay({ content, truncated, className = "" }: CodeDisplayProps) {
  const lines = useMemo(() => content.split("\n"), [content]);

  return (
    <div className={`flex flex-1 overflow-hidden font-mono text-sm leading-relaxed ${className}`}>
      {/* Line numbers gutter */}
      <div className="flex-shrink-0 bg-black/40 text-right pr-3 pl-3 select-none border-r border-white/5">
        {lines.map((_, i) => (
          <div key={i} className="text-slate-600 text-xs leading-relaxed">
            {i + 1}
          </div>
        ))}
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto p-3 whitespace-pre bg-[#0B0B0C]">
        {lines.map((line, i) => (
          <div key={i} className="leading-relaxed">
            <HighlightedLine line={line || " "} />
          </div>
        ))}

        {truncated && (
          <div className="text-amber-500/70 text-xs mt-4 py-2 border-t border-amber-500/20">
            ⚠ File content truncated (over 1MB)
          </div>
        )}
      </div>
    </div>
  );
}
