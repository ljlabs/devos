/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReadOnlyCodeDisplay — syntax-highlighted read-only code viewer
 * For mobile devices to enable text selection without Monaco editor overhead
 */

import React, { useMemo } from "react";
import { getLanguageFromPath } from "./IdeConstants";

interface ReadOnlyCodeDisplayProps {
  filePath: string;
  content: string;
}

// Simple syntax highlighting using regex — works without Monaco
function highlightCode(code: string, language: string): { line: string; tokens: Array<{ text: string; type: string }> }[] {
  const lines = code.split("\n");
  
  return lines.map((line) => {
    const tokens: Array<{ text: string; type: string }> = [];
    let remaining = line;
    
    // Very basic tokenization — keywords, strings, comments
    const patterns = [
      { regex: /^(\s+)/, type: "whitespace" },
      { regex: /^(\/\/.*?)$/, type: "comment" },
      { regex: /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/, type: "string" },
      { regex: /^(\b(?:function|const|let|var|if|else|for|while|return|class|import|export|from|async|await)\b)/, type: "keyword" },
      { regex: /^(\d+(?:\.\d+)?)/, type: "number" },
      { regex: /^([{}\[\]().,;:=])/, type: "punctuation" },
      { regex: /^([a-zA-Z_$][a-zA-Z0-9_$]*)/, type: "identifier" },
      { regex: /^(.)/, type: "text" },
    ];
    
    while (remaining.length > 0) {
      let matched = false;
      for (const { regex, type } of patterns) {
        const match = remaining.match(regex);
        if (match) {
          tokens.push({ text: match[1], type });
          remaining = remaining.slice(match[1].length);
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    
    return { line, tokens };
  });
}

const tokenColors: Record<string, string> = {
  keyword: "text-red-400",
  string: "text-green-400",
  comment: "text-gray-500",
  number: "text-yellow-400",
  punctuation: "text-white",
  identifier: "text-white",
  whitespace: "",
  text: "text-white",
};

export default function ReadOnlyCodeDisplay({ filePath, content }: ReadOnlyCodeDisplayProps) {
  const language = getLanguageFromPath(filePath);
  const highlightedLines = useMemo(() => highlightCode(content, language), [content, language]);

  return (
    <div className="flex-1 overflow-auto bg-[#0B0B0C] p-4 font-mono text-sm leading-relaxed">
      <div className="space-y-0 select-text">
        {highlightedLines.map((line, lineNum) => (
          <div key={lineNum} className="flex gap-4 hover:bg-white/5 px-2 py-0.5 transition-colors">
            {/* Line number */}
            <span className="text-slate-600 text-right w-8 flex-shrink-0 select-none pointer-events-none">{lineNum + 1}</span>
            
            {/* Code */}
            <span className="flex-1">
              {line.tokens.map((token, idx) => (
                <span
                  key={idx}
                  className={`${tokenColors[token.type] || "text-white"} whitespace-pre-wrap break-words`}
                >
                  {token.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
