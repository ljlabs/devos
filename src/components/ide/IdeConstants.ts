/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IdeConstants — shared theme and language mappings for IDE
 */

export const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  json: "json",
  html: "html",
  css: "css",
  scss: "scss",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  bat: "bat",
  cmd: "bat",
  sql: "sql",
  xml: "xml",
  csv: "plaintext",
  txt: "plaintext",
  log: "plaintext",
  env: "plaintext",
  gitignore: "plaintext",
  dockerfile: "dockerfile",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  r: "r",
  lua: "lua",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  ml: "ocaml",
};

export function getLanguageFromPath(filePath: string): string {
  const filename = filePath.split("/").pop() || "";
  if (filename.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXTENSION_LANGUAGE_MAP[ext] || "plaintext";
}

export const DEVOS_THEME = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "", foreground: "c9d1d9" },
    { token: "comment", foreground: "6e7681", fontStyle: "italic" },
    { token: "keyword", foreground: "ff7b72" },
    { token: "string", foreground: "a5d6ff" },
    { token: "number", foreground: "79c0ff" },
    { token: "type", foreground: "ffa657" },
    { token: "function", foreground: "d2a8ff" },
    { token: "variable", foreground: "ffa657" },
    { token: "operator", foreground: "ff7b72" },
  ],
  colors: {
    "editor.background": "#0B0B0C",
    "editor.foreground": "#c9d1d9",
    "editor.lineHighlightBackground": "#16161A",
    "editor.selectionBackground": "#1f6feb44",
    "editor.inactiveSelectionBackground": "#1f6feb22",
    "editorCursor.foreground": "#3fb950",
    "editorWhitespace.foreground": "#2d333b",
    "editorIndentGuide.background": "#21262d",
    "editorLineNumber.foreground": "#484f58",
    "editorLineNumber.activeForeground": "#c9d1d9",
    "editor.findMatchBackground": "#ffd33d44",
    "editor.findMatchHighlightBackground": "#ffd33d22",
    "editorBracketMatch.background": "#1f6feb33",
    "editorBracketMatch.border": "#1f6feb",
    "editorGutter.background": "#0B0B0C",
    "editorWidget.background": "#16161A",
    "editorWidget.border": "#21262d",
    "input.background": "#0d1117",
    "input.border": "#21262d",
    "dropdown.background": "#16161A",
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#30363d66",
    "scrollbarSlider.hoverBackground": "#30363daa",
    "scrollbarSlider.activeBackground": "#30363d",
  },
};
