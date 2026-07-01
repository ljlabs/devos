/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FileEditorPanel — Monaco editor with save/undo/redo logic
 * Shared between mobile and desktop IDE views.
 */

import React, { useCallback, useRef } from "react";
import { FileText, Save, Undo2, Redo2, X, Type } from "lucide-react";
import Editor from "@monaco-editor/react";
import { FileContent } from "../../types";
import { DEVOS_THEME, getLanguageFromPath } from "./IdeConstants";
import ReadOnlyCodeDisplay from "./ReadOnlyCodeDisplay";

interface FileEditorPanelProps {
  activeFile: FileContent | null;
  activeFilePath: string;
  editorContent: string;
  isDirty: boolean;
  isSaving: boolean;
  isLoading: boolean;
  isMobile?: boolean;
  onContentChange: (content: string) => void;
  onSave: () => Promise<void>;
  onCloseTab: () => void;
}

export default function FileEditorPanel({
  activeFile,
  activeFilePath,
  editorContent,
  isDirty,
  isSaving,
  isLoading,
  isMobile = false,
  onContentChange,
  onSave,
  onCloseTab,
}: FileEditorPanelProps) {
  const editorRef = useRef<any>(null);
  const [selectMode, setSelectMode] = React.useState(false);

  const handleEditorMount = useCallback((editor: any, monaco: any) => {
    editorRef.current = editor;
    monaco.editor.defineTheme("devos-dark", DEVOS_THEME);
    monaco.editor.setTheme("devos-dark");

    // Register keyboard shortcuts — let Monaco handle them natively
    editor.addAction({
      id: "devos-save",
      label: "Save",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSave(),
    });

    // Ctrl+Z / Cmd+Z undo
    editor.addAction({
      id: "devos-undo",
      label: "Undo",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: () => editor.trigger("keyboard", "undo"),
    });

    // Ctrl+Shift+Z / Cmd+Shift+Z redo
    editor.addAction({
      id: "devos-redo",
      label: "Redo",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ],
      run: () => editor.trigger("keyboard", "redo"),
    });
  }, [onSave]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600">
        <div className="w-4 h-4 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin mr-2" />
        Loading file...
      </div>
    );
  }

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-600 p-8">
        <span className="text-2xl">📝</span>
        <p className="text-center text-sm">
          No file selected.<br />
          <span className="text-slate-700">Open a file from the FILES tab to view its contents.</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center justify-between bg-[#0E0E11] h-10 border-b border-white/5 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} className="text-emerald-400 flex-shrink-0" />
          <span className="text-[11px] font-mono font-medium text-white truncate">
            {activeFilePath.split("/").pop()}
          </span>
          {isDirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Unsaved changes" />
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isMobile && (
            <button
              onClick={() => setSelectMode(!selectMode)}
              className={`p-1 transition-colors ${
                selectMode
                  ? "text-blue-400 hover:text-blue-300"
                  : "text-slate-500 hover:text-white"
              }`}
              title={selectMode ? "Switch to editor" : "Switch to select mode"}
            >
              <Type size={14} />
            </button>
          )}
          <button
            onClick={() => {
              editorRef.current?.focus();
              setTimeout(() => editorRef.current?.trigger("keyboard", "undo"), 0);
            }}
            className="p-1 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={() => {
              editorRef.current?.focus();
              setTimeout(() => editorRef.current?.trigger("keyboard", "redo"), 0);
            }}
            className="p-1 text-slate-500 hover:text-white active:text-emerald-400 transition-colors"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={14} />
          </button>
          <button
            onClick={onSave}
            disabled={!isDirty || isSaving}
            className={`p-1 transition-colors ${
              isDirty
                ? "text-emerald-400 hover:text-emerald-300 active:scale-95"
                : "text-slate-700"
            }`}
            title="Save (Ctrl+S)"
          >
            <Save size={14} />
          </button>
          <button
            onClick={onCloseTab}
            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        {isMobile && selectMode ? (
          <ReadOnlyCodeDisplay filePath={activeFilePath} content={editorContent} />
        ) : (
          <Editor
            height="100%"
            width="100%"
            language={getLanguageFromPath(activeFilePath)}
            value={editorContent}
            theme="devos-dark"
            onChange={(value) => onContentChange(value || "")}
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
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            }}
          />
        )}
      </div>
    </div>
  );
}
