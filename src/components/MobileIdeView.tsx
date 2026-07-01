/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft,
  RefreshCw,
  FolderOpen,
  FileText,
  Code,
  Save,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import Editor from "@monaco-editor/react";
import { IdePanel, FileEntry, FileContent } from "../types";
import FileExplorer from "./FileExplorer";
import TerminalDisplay from "./TerminalDisplay";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MobileIdeViewProps {
  panel: IdePanel;
  workspaceId?: string;
  threadTitle?: string;
  threadLogs?: any[];
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
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

function getLanguageFromPath(filePath: string): string {
  const filename = filePath.split("/").pop() || "";
  if (filename.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return EXTENSION_LANGUAGE_MAP[ext] || "plaintext";
}

// Monaco dark theme matching DevOS palette
const DEVOS_THEME = {
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MobileIdeView({
  panel,
  workspaceId,
  threadTitle,
  threadLogs = [],
  onBack,
}: MobileIdeViewProps) {
  // File explorer state
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [childEntries, setChildEntries] = useState<Record<string, FileEntry[]>>({});
  const [activeFile, setActiveFile] = useState<FileContent | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string>("");
  const [isLoadingTree, setIsLoadingTree] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Editor state
  const [editorContent, setEditorContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const editorRef = useRef<any>(null);

  // Fetch root directory
  const fetchDirectory = useCallback(
    async (relativePath?: string) => {
      if (!workspaceId) return;
      try {
        const url = relativePath
          ? `/api/workspaces/${workspaceId}/files?path=${encodeURIComponent(relativePath)}`
          : `/api/workspaces/${workspaceId}/files`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (relativePath) {
            setChildEntries((prev) => ({ ...prev, [relativePath]: data.entries }));
          } else {
            setRootEntries(data.entries);
          }
        }
      } catch (e) {
        console.error("Error fetching directory", e);
      }
    },
    [workspaceId]
  );

  // Fetch file content
  const fetchFileContent = useCallback(
    async (relativePath: string) => {
      if (!workspaceId) return;
      setIsLoadingFile(true);
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/files/read?path=${encodeURIComponent(relativePath)}`
        );
        if (res.ok) {
          const data: FileContent = await res.json();
          setActiveFile(data);
          setActiveFilePath(relativePath);
          setEditorContent(data.content);
          setIsDirty(false);
        }
      } catch (e) {
        console.error("Error fetching file", e);
      } finally {
        setIsLoadingFile(false);
      }
    },
    [workspaceId]
  );

  // Save file
  const handleSave = useCallback(async () => {
    if (!workspaceId || !activeFilePath) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/files/write`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: activeFilePath, content: editorContent }),
        }
      );
      if (res.ok) {
        const data: FileContent = await res.json();
        setActiveFile(data);
        setIsDirty(false);
      }
    } catch (e) {
      console.error("Error saving file", e);
    } finally {
      setIsSaving(false);
    }
  }, [workspaceId, activeFilePath, editorContent]);

  // Undo/Redo via Monaco editor instance
  const handleUndo = useCallback(() => {
    editorRef.current?.trigger("keyboard", "undo");
  }, []);

  const handleRedo = useCallback(() => {
    editorRef.current?.trigger("keyboard", "redo");
  }, []);

  // Close tab
  const handleCloseTab = useCallback(() => {
    setActiveFile(null);
    setActiveFilePath("");
    setEditorContent("");
    setIsDirty(false);
    editorRef.current = null;
  }, []);

  // Editor mount — register Ctrl+S save action
  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;

      // Define DevOS theme
      monaco.editor.defineTheme("devos-dark", DEVOS_THEME);
      monaco.editor.setTheme("devos-dark");

      // Ctrl+S / Cmd+S save
      editor.addAction({
        id: "devos-save",
        label: "Save",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        ],
        run: (e: any) => {
          e.preventDefault?.();
          handleSave();
        },
      });
    },
    [handleSave]
  );

  // Editor content change
  const handleEditorChange = useCallback((value: string | undefined) => {
    setEditorContent(value || "");
    setIsDirty(true);
  }, []);

  // Toggle folder expand/collapse
  const handleToggleFolder = useCallback(
    async (folderPath: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) {
          next.delete(folderPath);
        } else {
          next.add(folderPath);
          if (!childEntries[folderPath]) {
            fetchDirectory(folderPath);
          }
        }
        return next;
      });
    },
    [childEntries, fetchDirectory]
  );

  // File select handler
  const handleFileSelect = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "file") {
        fetchFileContent(entry.path);
      }
    },
    [fetchFileContent]
  );

  // Load root on mount
  useEffect(() => {
    if (workspaceId && panel === "files") {
      setRootEntries([]);
      setExpandedFolders(new Set());
      setChildEntries({});
      fetchDirectory();
    }
  }, [workspaceId, panel, fetchDirectory]);

  // Reset when switching to files panel
  useEffect(() => {
    if (panel === "files" && rootEntries.length === 0 && workspaceId) {
      fetchDirectory();
    }
  }, [panel, rootEntries.length, workspaceId, fetchDirectory]);

  // Get header info
  const getHeaderTitle = () => {
    switch (panel) {
      case "files": return "Explorer";
      case "editor": return activeFile ? activeFilePath.split("/").pop() || "Editor" : "Editor";
      case "terminal": return "Terminal";
      default: return "";
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0B0B0C]">
      {/* Panel header */}
      <div className="flex items-center gap-3 px-3 h-12 border-b border-white/5 bg-[#0E0E11]">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-xs font-mono font-bold tracking-widest text-slate-500 uppercase">
          {getHeaderTitle()}
        </span>
      </div>

      {/* FILES PANEL */}
      {panel === "files" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <FolderOpen size={14} className="text-slate-500" />
              <span className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase">
                Files
              </span>
            </div>
            <div className="flex gap-2">
              <button
                className="p-1 text-slate-500 hover:text-emerald-400 transition-colors"
                onClick={() => fetchDirectory()}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* File tree */}
          <div className="flex-1 overflow-y-auto py-1">
            {isLoadingTree && rootEntries.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-slate-600">
                <div className="w-4 h-4 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin mr-2" />
                Loading...
              </div>
            ) : (
              <FileExplorer
                workspaceId={workspaceId || ""}
                entries={rootEntries}
                activeFilePath={activeFilePath || undefined}
                onFileSelect={handleFileSelect}
                expandedFolders={expandedFolders}
                onToggleFolder={handleToggleFolder}
                childEntries={childEntries}
                isLoading={isLoadingTree}
              />
            )}
          </div>
        </div>
      )}

      {/* EDITOR PANEL */}
      {panel === "editor" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          {activeFile && (
            <div className="flex items-center bg-[#0E0E11] h-10 border-b border-white/5 overflow-x-auto">
              <div className="flex items-center px-4 h-full bg-[#0B0B0C] border-r border-white/5 border-t-2 border-emerald-400 gap-2">
                <FileText size={14} className="text-emerald-400" />
                <span className="text-[11px] font-mono font-medium text-emerald-400 whitespace-nowrap">
                  {activeFilePath.split("/").pop()}
                </span>
                {isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-1" title="Unsaved changes" />
                )}
              </div>
              <div className="ml-auto px-2 flex items-center gap-1">
                <button
                  onClick={handleUndo}
                  className="p-1.5 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
                  title="Undo"
                >
                  <Undo2 size={14} />
                </button>
                <button
                  onClick={handleRedo}
                  className="p-1.5 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
                  title="Redo"
                >
                  <Redo2 size={14} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                  className={`p-1.5 transition-colors ${
                    isDirty
                      ? "text-emerald-400 hover:text-emerald-300 active:scale-95"
                      : "text-slate-700"
                  }`}
                  title="Save (Ctrl+S)"
                >
                  <Save size={14} />
                </button>
                <button
                  onClick={handleCloseTab}
                  className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                  title="Close file"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Code content */}
          {isLoadingFile ? (
            <div className="flex-1 flex items-center justify-center text-slate-600">
              <div className="w-4 h-4 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin mr-2" />
              Loading file...
            </div>
          ) : activeFile ? (
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                language={getLanguageFromPath(activeFilePath)}
                value={activeFile.content}
                theme="devos-dark"
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontLigatures: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 8, bottom: 8 },
                  lineNumbers: "on",
                  renderLineHighlight: "line",
                  cursorBlinking: "smooth",
                  cursorSmoothCaretAnimation: "on",
                  smoothScrolling: true,
                  wordWrap: "on",
                  tabSize: 2,
                  automaticLayout: true,
                  scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                  },
                }}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-600 p-8">
              <Code size={48} className="text-slate-700" />
              <p className="text-center text-sm">
                No file selected.<br />
                <span className="text-slate-700">Open a file from the FILES tab to view its contents.</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* TERMINAL PANEL */}
      {panel === "terminal" && (
        <TerminalDisplay
          logs={threadLogs}
          threadTitle={threadTitle}
          onClose={onBack}
        />
      )}

      {/* Bottom padding for nav bar */}
      <div className="h-14 flex-shrink-0" />
    </div>
  );
}
